import {
  accrueWidgetRolls,
  rerollWidgetDie,
  rollWidgetDice,
  spendWidgetRoll,
  WIDGET_MAX_STORED_ROLLS,
  WIDGET_ROLL_INTERVAL_SEC,
  type Rng,
  type WidgetDice,
  type WidgetRollBank,
  type WidgetRollOutcome,
  type WidgetSkinRarity,
} from '@gamedeck/shared';
import { and, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { items, playerItems, players, widgetPlayers } from '../db/schema.js';
import { changeCoins, type Tx } from '../db/wallet.js';
import type { PlayerService } from '../players/player-service.js';
import type { WidgetRollAnswer, WidgetState } from './build.js';

const RARITY_TEXT: Record<WidgetSkinRarity, string> = { common: 'обычный', rare: 'редкий', epic: 'эпический' };
/** Какие предметы выпадают скином: только то, что видно на столе. */
const SKIN_KINDS = ['mat', 'dice'];

/** Сколько бонусных бросков получают и друг, и пригласивший после первого броска друга. */
export const REFERRAL_BONUS_ROLLS = 3;
/** За сколько друзей в сутки пригласивший получает награду. Друг свою получает всегда. */
export const REFERRAL_DAILY_LIMIT = 10;
const DAY_SEC = 24 * 60 * 60;

const toUnix = (date: Date | null) => (date ? Math.floor(date.getTime() / 1000) : null);
const fromUnix = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000));

function parseDice(text: string | null): WidgetDice | null {
  const dice = text?.split(',').map(Number);
  return dice?.length === 3 ? (dice as unknown as WidgetDice) : null;
}

const OUTCOME_TEXT: Record<WidgetRollOutcome, string> = {
  plain: '',
  pair: 'Пара, ×2! ',
  straight: 'Стрит! ',
  triple: 'Тройка, ×5! ',
};

/** Фраза под кубиками: событие, монеты и то, что выпало сверх них. */
const prizeText = (outcome: WidgetRollOutcome, coins: number, extra: string | null) =>
  `${OUTCOME_TEXT[outcome]}+${coins} монет${extra ? `. ${extra}` : ''}`;

type WidgetRow = typeof widgetPlayers.$inferSelect;

/** Можно ли применить переброс к последнему броску: есть что перебрасывать, есть чем и ещё не применяли. */
const canReroll = (row: Pick<WidgetRow, 'modifiers' | 'lastDice' | 'lastRollModified'>) =>
  row.modifiers > 0 && row.lastDice !== null && !row.lastRollModified;

/** Код в реферальной ссылке: id игрока без дефисов (в параметре start допустимы только буквы, цифры, _ и -). */
export const referralCode = (playerId: string) => `ref_${playerId.replaceAll('-', '')}`;

function playerIdFromReferralCode(code: string): string | null {
  const match = /^ref_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(code);
  return match ? match.slice(1).join('-') : null;
}

/** Чей виджет надо обновить: игрок и его последнее сообщение с виджетом. */
export interface WidgetMessage {
  playerId: string;
  chatId: number;
  messageId: number;
}

/**
 * Броски в виджете с настоящим профилем игрока: запас бросков лежит в базе,
 * монеты начисляются через changeCoins, выпавший скин попадает в инвентарь.
 */
export class WidgetService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly rng: Rng,
    readonly intervalSec: number = WIDGET_ROLL_INTERVAL_SEC,
  ) {}

  /** Состояние для chat_data на момент now (unix, секунды). */
  async state(playerId: string, now: number): Promise<WidgetState> {
    const [row] = await this.db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId));
    const bank = accrueWidgetRolls(this.bankOf(row), now, this.intervalSec);
    const me = await this.players.me(playerId);
    const dice = parseDice(row?.lastDice ?? null);
    return {
      r: bank.rolls,
      n: bank.nextAt ?? 0,
      t: this.intervalSec,
      b: me?.coins ?? 0,
      w: me?.wins ?? 0,
      l: (me?.gamesPlayed ?? 0) - (me?.wins ?? 0),
      c: me?.coinsWon ?? 0,
      a: row?.bonusRolls ?? 0,
      m: row?.modifiers ?? 0,
      u: row && canReroll(row) ? 1 : 0,
      ...(dice ? { d: dice } : {}),
    };
  }

  /**
   * Бросок по запросу виджета. Всё в одной транзакции со строкой игрока под замком:
   * два одновременных нажатия не потратят один и тот же бросок и не начислят монеты дважды.
   */
  async roll(playerId: string, now: number): Promise<WidgetRollAnswer> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockRow(tx, playerId);

      // Сначала тратится бросок по таймеру (так раньше пойдёт отсчёт следующего), потом бонусные.
      const accrued = accrueWidgetRolls(this.bankOf(row), now, this.intervalSec);
      const spent = spendWidgetRoll(accrued, now, this.intervalSec);
      if (!spent && row.bonusRolls < 1) return { e: 'NO_ROLLS' as const };
      const bank = spent ?? accrued;
      const bonusRolls = spent ? row.bonusRolls : row.bonusRolls - 1;

      const roll = rollWidgetDice(this.rng);
      const coins = await changeCoins(tx, playerId, roll.coins, 'widget_roll', roll.dice.join(','));
      const extra = roll.skin ? await this.grantSkin(tx, playerId, roll.skin) : roll.modifier ? 'Выпал переброс' : null;
      const modifiers = row.modifiers + (roll.modifier ? 1 : 0);

      await tx
        .update(widgetPlayers)
        .set({
          rolls: bank.rolls,
          nextAt: fromUnix(bank.nextAt),
          bonusRolls,
          lastDice: roll.dice.join(','),
          lastRollModified: false,
          modifiers,
          updatedAt: new Date(),
        })
        .where(eq(widgetPlayers.playerId, playerId));

      return {
        d: roll.dice,
        o: roll.outcome,
        c: roll.coins,
        r: bank.rolls,
        n: bank.nextAt ?? 0,
        b: coins,
        a: bonusRolls,
        m: modifiers,
        u: modifiers > 0 ? 1 : 0,
        x: prizeText(roll.outcome, roll.coins, extra),
      };
    });
  }

  /**
   * Потратить модификатор: перебросить один кубик последнего броска (dieIndex — 0, 1 или 2).
   * На один бросок — один модификатор. Правила выигрыша — rerollWidgetDie в shared.
   */
  async reroll(playerId: string, dieIndex: number, now: number): Promise<WidgetRollAnswer> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockRow(tx, playerId);
      const last = parseDice(row.lastDice);
      if (!last || !canReroll(row)) return { e: 'NO_MOD' as const };

      const reroll = rerollWidgetDie(last, dieIndex, this.rng);
      const dice = reroll.dice.join(',');
      let coins: number;
      if (reroll.gain > 0) {
        coins = await changeCoins(tx, playerId, reroll.gain, 'widget_roll', `reroll:${dice}`);
      } else {
        const [player] = await tx.select({ coins: players.coins }).from(players).where(eq(players.id, playerId));
        coins = player!.coins;
      }

      const modifiers = row.modifiers - 1;
      await tx
        .update(widgetPlayers)
        .set({ modifiers, lastDice: dice, lastRollModified: true, updatedAt: new Date() })
        .where(eq(widgetPlayers.playerId, playerId));

      const bank = accrueWidgetRolls(this.bankOf(row), now, this.intervalSec);
      return {
        d: reroll.dice,
        o: reroll.outcome,
        c: reroll.gain,
        r: bank.rolls,
        n: bank.nextAt ?? 0,
        b: coins,
        a: row.bonusRolls,
        m: modifiers,
        u: 0,
        x: reroll.gain > 0 ? prizeText(reroll.outcome, reroll.gain, null) : 'Приз остался прежним',
      };
    });
  }

  /** Запомнить сообщение с виджетом, чтобы потом обновлять его состояние. */
  async rememberMessage(playerId: string, chatId: number, messageId: number): Promise<void> {
    await this.db
      .insert(widgetPlayers)
      .values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS, chatId, messageId })
      .onConflictDoUpdate({ target: widgetPlayers.playerId, set: { chatId, messageId } });
  }

  /**
   * Запомнить, кто пригласил игрока. Работает один раз и только до первого броска:
   * тот, кто уже играет в виджете, чужим рефералом не становится. Себя пригласить нельзя.
   * Непонятный код и несуществующий пригласивший молча пропускаются: человек, пришедший
   * по битой ссылке, всё равно должен получить виджет.
   */
  async setReferrer(playerId: string, code: string): Promise<boolean> {
    const referrerId = playerIdFromReferralCode(code);
    if (!referrerId || referrerId === playerId) return false;
    const [referrer] = await this.db.select({ id: players.id }).from(players).where(eq(players.id, referrerId));
    if (!referrer) return false;

    await this.db.insert(widgetPlayers).values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS }).onConflictDoNothing();
    const updated = await this.db
      .update(widgetPlayers)
      .set({ referredBy: referrerId })
      .where(
        and(eq(widgetPlayers.playerId, playerId), isNull(widgetPlayers.referredBy), isNull(widgetPlayers.lastDice)),
      )
      .returning({ playerId: widgetPlayers.playerId });
    return updated.length > 0;
  }

  /**
   * Выдать награду за приглашение. Вызывается после броска: если это был первый бросок
   * приглашённого, он и пригласивший получают по REFERRAL_BONUS_ROLLS бонусных бросков.
   * Награда за бросок, а не за переход по ссылке: так она идёт за живого игрока.
   * Возвращает виджет пригласившего, чтобы бот его обновил; null — награждать некого.
   */
  async claimReferral(playerId: string, now: number): Promise<WidgetMessage | null> {
    return this.db.transaction(async (tx) => {
      // Условие «награда ещё не выдана» стоит в самом UPDATE: повторный вызов ничего не начислит.
      const [friend] = await tx
        .update(widgetPlayers)
        .set({
          referralRewardedAt: fromUnix(now),
          bonusRolls: sql`${widgetPlayers.bonusRolls} + ${REFERRAL_BONUS_ROLLS}`,
        })
        .where(
          and(
            eq(widgetPlayers.playerId, playerId),
            sql`${widgetPlayers.referredBy} is not null`,
            isNull(widgetPlayers.referralRewardedAt),
            sql`${widgetPlayers.lastDice} is not null`,
          ),
        )
        .returning({ referredBy: widgetPlayers.referredBy });
      const referrerId = friend?.referredBy;
      if (!referrerId) return null;

      // Потолок на сутки: ферма из фальшивых аккаунтов не даст пригласившему бесконечных бросков.
      const [recent] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(widgetPlayers)
        .where(
          and(
            eq(widgetPlayers.referredBy, referrerId),
            gte(widgetPlayers.referralRewardedAt, fromUnix(now - DAY_SEC)!),
          ),
        );
      // В счётчик уже входит только что награждённый друг.
      if ((recent?.count ?? 0) > REFERRAL_DAILY_LIMIT) return null;

      await tx
        .insert(widgetPlayers)
        .values({ playerId: referrerId, rolls: WIDGET_MAX_STORED_ROLLS, bonusRolls: REFERRAL_BONUS_ROLLS })
        .onConflictDoUpdate({
          target: widgetPlayers.playerId,
          set: { bonusRolls: sql`${widgetPlayers.bonusRolls} + ${REFERRAL_BONUS_ROLLS}` },
        });
      const [referrer] = await tx.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, referrerId));
      return referrer?.chatId != null && referrer.messageId != null
        ? { playerId: referrerId, chatId: referrer.chatId, messageId: referrer.messageId }
        : null;
    });
  }

  /** Строка игрока под замком до конца транзакции; создаётся, если её ещё нет. */
  private async lockRow(tx: Tx, playerId: string): Promise<WidgetRow> {
    await tx.insert(widgetPlayers).values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS }).onConflictDoNothing();
    const [row] = await tx.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId)).for('update');
    return row!;
  }

  private bankOf(row: { rolls: number; nextAt: Date | null } | undefined): WidgetRollBank {
    // Игрок, который ещё не бросал, начинает с полным запасом.
    return row ? { rolls: row.rolls, nextAt: toUnix(row.nextAt) } : { rolls: WIDGET_MAX_STORED_ROLLS, nextAt: null };
  }

  /**
   * Выдать случайный предмет нужной редкости из тех, которых у игрока ещё нет.
   * Возвращает фразу для виджета. Предмет остаётся в инвентаре, надеть его можно в Mini App.
   */
  private async grantSkin(tx: Tx, playerId: string, rarity: WidgetSkinRarity): Promise<string> {
    const owned = tx.select({ itemId: playerItems.itemId }).from(playerItems).where(eq(playerItems.playerId, playerId));
    const candidates = await tx
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(
        and(
          eq(items.rarity, rarity),
          eq(items.isActive, true),
          inArray(items.kind, SKIN_KINDS),
          notInArray(items.id, owned),
        ),
      )
      .orderBy(items.id);
    const item = candidates[Math.floor(this.rng() * candidates.length)];
    if (!item) return `Все скины редкости «${RARITY_TEXT[rarity]}» уже ваши`;

    await tx.insert(playerItems).values({ playerId, itemId: item.id, source: 'reward' });
    return `Выпал ${RARITY_TEXT[rarity]} скин «${item.name}»`;
  }
}
