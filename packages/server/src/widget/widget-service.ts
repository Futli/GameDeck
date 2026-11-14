import {
  PLAYER_COLOR_HEX,
  accrueWidgetRolls,
  generateSkin,
  referralCodeSchema,
  rerollWidgetDie,
  rollWidgetDice,
  SKIN_KINDS,
  spendWidgetRoll,
  WIDGET_MAX_STORED_ROLLS,
  WIDGET_ROLL_INTERVAL_SEC,
  type Rng,
  type WidgetDice,
  type WidgetRollBank,
} from '@gamedeck/shared';
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { matchPlayers, players, widgetPlayers } from '../db/schema.js';
import { changeCoins, type Tx } from '../db/wallet.js';
import type { PlayerService } from '../players/player-service.js';
import type { SkinService } from '../skins/skin-service.js';
import { buildWidgetHtml, type WidgetRollAnswer, type WidgetState } from './build.js';
import { cupFromSkin, defaultCup, feltMat, matFromSkin } from './mat.js';
import { BOT_TEXTS, prizeText, type BotLang } from './texts.js';

/**
 * Ответ на бросок вместе с тем, куда ведёт «Подробнее» в окне приза: параметр startapp
 * для Mini App («luck» — страница «Кубика удачи», «luck-<id скина>» — она же с выпавшим скином).
 * Ссылку из него делает бот: адрес Mini App знает он, а не сервис бросков.
 */
export type WidgetRollResult = WidgetRollAnswer & { details?: string };

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

type WidgetRow = typeof widgetPlayers.$inferSelect;

/** Можно ли применить переброс к последнему броску: есть что перебрасывать, есть чем и ещё не применяли. */
const canReroll = (row: Pick<WidgetRow, 'modifiers' | 'lastDice' | 'lastRollModified'>) =>
  row.modifiers > 0 && row.lastDice !== null && !row.lastRollModified;

/** Что сказать игроку, нажавшему «Переброс»: как им пользоваться или почему сейчас нельзя. */
function rerollHint(row: Pick<WidgetRow, 'lastDice' | 'lastRollModified'>, lang: BotLang): string {
  const hint = BOT_TEXTS[lang].rerollHint;
  if (row.lastDice === null) return hint.noRoll;
  return row.lastRollModified ? hint.used : hint.ready;
}

/**
 * Длинный код первых ссылок на бота: ref_ и id игрока без дефисов. Такие ссылки уже разосланы,
 * поэтому бот их по-прежнему понимает, а новые выдаёт с коротким кодом.
 */
function playerIdFromLegacyCode(param: string): string | null {
  const match = /^ref_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(param);
  return match ? match.slice(1).join('-') : null;
}

/** Игрок уже играл за столом: есть хоть одна записанная партия. */
const playedMatch = (playerId: typeof widgetPlayers.playerId | string) =>
  sql`exists (select 1 from ${matchPlayers} where ${matchPlayers.playerId} = ${playerId})`;

/** Чей виджет надо обновить: игрок, его последнее сообщение с виджетом и язык этого виджета. */
export interface WidgetMessage {
  playerId: string;
  chatId: number;
  messageId: number;
  lang: BotLang;
}

/** Отправленный виджет и версия его HTML (null — отправлен до того, как версии начали записывать). */
export interface SentWidget extends WidgetMessage {
  version: string | null;
}

const sentWidgetColumns = {
  playerId: widgetPlayers.playerId,
  chatId: widgetPlayers.chatId,
  messageId: widgetPlayers.messageId,
  lang: widgetPlayers.lang,
  version: widgetPlayers.widgetVersion,
};

function sentWidget(row: {
  playerId: string;
  chatId: number | null;
  messageId: number | null;
  lang: string | null;
  version: string | null;
}): SentWidget | null {
  if (row.chatId === null || row.messageId === null) return null;
  return { ...row, chatId: row.chatId, messageId: row.messageId, lang: row.lang === 'en' ? 'en' : 'ru' };
}

/**
 * Броски в виджете с настоящим профилем игрока: запас бросков лежит в базе,
 * монеты начисляются через changeCoins, выпавший скин попадает в инвентарь.
 */
export class WidgetService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly skins: SkinService,
    private readonly rng: Rng,
    readonly intervalSec: number = WIDGET_ROLL_INTERVAL_SEC,
  ) {}

  /** Состояние для chat_data на момент now (unix, секунды). Подсказка к перебросу — на языке lang. */
  async state(playerId: string, now: number, lang: BotLang = 'ru'): Promise<WidgetState> {
    const [row] = await this.db.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId));
    const bank = accrueWidgetRolls(this.bankOf(row), now, this.intervalSec);
    const me = await this.players.me(playerId);
    const dice = parseDice(row?.lastDice ?? null);
    return {
      r: bank.rolls,
      n: bank.nextAt ?? 0,
      t: this.intervalSec,
      b: me?.coins ?? 0,
      a: row?.bonusRolls ?? 0,
      m: row?.modifiers ?? 0,
      u: row && canReroll(row) ? 1 : 0,
      ...(row && row.modifiers > 0 ? { h: rerollHint(row, lang) } : {}),
      ...(dice ? { d: dice } : {}),
    };
  }

  /**
   * HTML виджета со скинами, надетыми на игроке, на языке lang. Один и тот же для чата с ботом
   * и для главной Mini App. Надетый сгенерированный коврик рисуется тем же генератором, что и на столе;
   * без него — сукно. Тесты держат любой коврик в 4 КБ виджета, но если генератор когда-нибудь
   * выйдет за лимит, игрок получит виджет с сукном, а не ошибку: onFallback узнает, какой скин не влез.
   */
  async html(playerId: string, lang: BotLang, onFallback?: (error: unknown, mat: unknown) => void): Promise<string> {
    const equipped = await this.skins.equipped(playerId);
    const dice = await this.players.diceStyle(playerId);
    const red = PLAYER_COLOR_HEX.red;
    const cup = equipped.cup ? cupFromSkin(generateSkin(equipped.cup).render(), red.main) : defaultCup(red);
    try {
      const mat = equipped.mat ? matFromSkin(generateSkin(equipped.mat).render(), red.main) : feltMat();
      return buildWidgetHtml({ mat, dice, cup }, lang);
    } catch (error) {
      onFallback?.(error, equipped.mat);
      return buildWidgetHtml({ mat: feltMat(), dice, cup }, lang);
    }
  }

  /**
   * Ответ на запрос виджета: «r» — бросок, «m0»–«m2» — переброс кубика с этим номером.
   * Что-то другое — FAILED: виджет покажет общий текст ошибки. Так отвечают и бот, и Mini App.
   */
  async answer(
    playerId: string,
    data: string,
    now: number,
    lang: BotLang,
  ): Promise<WidgetRollResult | { e: 'FAILED' }> {
    const reroll = /^m([0-2])$/.exec(data);
    if (data === 'r') return this.roll(playerId, now, lang);
    if (reroll) return this.reroll(playerId, Number(reroll[1]), now, lang);
    return { e: 'FAILED' };
  }

  /**
   * Бросок по запросу виджета. Всё в одной транзакции со строкой игрока под замком:
   * два одновременных нажатия не потратят один и тот же бросок и не начислят монеты дважды.
   */
  async roll(playerId: string, now: number, lang: BotLang = 'ru'): Promise<WidgetRollResult> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockRow(tx, playerId);

      // Сначала тратится бросок по таймеру (так раньше пойдёт отсчёт следующего), потом бонусные.
      const accrued = accrueWidgetRolls(this.bankOf(row), now, this.intervalSec);
      const spent = spendWidgetRoll(accrued, now, this.intervalSec);
      if (!spent && row.bonusRolls < 1) return { e: 'NO_ROLLS' as const, x: BOT_TEXTS[lang].noRolls };
      const bank = spent ?? accrued;
      const bonusRolls = spent ? row.bonusRolls : row.bonusRolls - 1;

      const roll = rollWidgetDice(this.rng);
      const coins = await changeCoins(tx, playerId, roll.coins, 'widget_roll', roll.dice.join(','));
      // Сверх монет: скин за тройку или переброс за стрит. О них виджет рассказывает в окне приза.
      const t = BOT_TEXTS[lang];
      let prize: { extra: string; popup: string; details: string } | null = null;
      if (roll.skin) {
        const kind = SKIN_KINDS[Math.floor(this.rng() * SKIN_KINDS.length)]!;
        const skin = await this.skins.mint(playerId, kind, roll.skin, { source: 'reward', tx });
        const rarity = t.rarity[roll.skin];
        prize = {
          extra: t.skinWon(rarity, skin.name),
          popup: t.skinPopup(rarity, skin.name, skin.serial),
          details: `luck-${skin.id}`,
        };
      } else if (roll.modifier) {
        prize = { extra: t.rerollWon, popup: t.rerollPopup, details: 'luck' };
      }
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
        x: prizeText(lang, roll.outcome, roll.coins, prize?.extra ?? null),
        ...(prize ? { z: prize.popup, details: prize.details } : {}),
      };
    });
  }

  /**
   * Потратить модификатор: перебросить один кубик последнего броска (dieIndex — 0, 1 или 2).
   * На один бросок — один модификатор. Правила выигрыша — rerollWidgetDie в shared.
   */
  async reroll(playerId: string, dieIndex: number, now: number, lang: BotLang = 'ru'): Promise<WidgetRollAnswer> {
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
        x: reroll.gain > 0 ? prizeText(lang, reroll.outcome, reroll.gain, null) : BOT_TEXTS[lang].prizeUnchanged,
      };
    });
  }

  /** Последнее отправленное игроку сообщение с виджетом: бот удаляет его, когда присылает новый. */
  async lastMessage(playerId: string): Promise<SentWidget | null> {
    const [row] = await this.db
      .select(sentWidgetColumns)
      .from(widgetPlayers)
      .where(eq(widgetPlayers.playerId, playerId));
    return row ? sentWidget(row) : null;
  }

  /**
   * Запомнить сообщение с виджетом, его язык и версию HTML, чтобы потом обновлять его состояние
   * и узнать, что после выката он устарел.
   */
  async rememberMessage(
    playerId: string,
    chatId: number,
    messageId: number,
    lang: BotLang = 'ru',
    version: string | null = null,
  ): Promise<void> {
    const set = { chatId, messageId, lang, widgetVersion: version };
    await this.db
      .insert(widgetPlayers)
      .values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS, ...set })
      .onConflictDoUpdate({ target: widgetPlayers.playerId, set });
  }

  /** Виджеты, отправленные с другой версией HTML: после выката бот заменяет их свежими. */
  async outdatedMessages(version: string): Promise<SentWidget[]> {
    const rows = await this.db
      .select(sentWidgetColumns)
      .from(widgetPlayers)
      .where(and(isNotNull(widgetPlayers.messageId), sql`${widgetPlayers.widgetVersion} is distinct from ${version}`));
    return rows.map(sentWidget).filter((row) => row !== null);
  }

  /** Отметить, что устаревший виджет игрока уже обработан для этой версии, чтобы не трогать его снова. */
  async markWidgetVersion(playerId: string, version: string): Promise<void> {
    await this.db.update(widgetPlayers).set({ widgetVersion: version }).where(eq(widgetPlayers.playerId, playerId));
  }

  /** Какую версию кнопок под полем ввода игрок уже получил; 0 — никакую. */
  async keyboardVersion(playerId: string): Promise<number> {
    const [row] = await this.db
      .select({ version: widgetPlayers.keyboardVersion })
      .from(widgetPlayers)
      .where(eq(widgetPlayers.playerId, playerId));
    return row?.version ?? 0;
  }

  async rememberKeyboard(playerId: string, version: number): Promise<void> {
    await this.db
      .insert(widgetPlayers)
      .values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS, keyboardVersion: version })
      .onConflictDoUpdate({ target: widgetPlayers.playerId, set: { keyboardVersion: version } });
  }

  /**
   * Запомнить, кто пригласил игрока, по параметру ссылки на бота (`/start ref_<код>`).
   * Непонятный код и несуществующий пригласивший молча пропускаются: человек, пришедший
   * по битой ссылке, всё равно должен получить виджет.
   */
  async setReferrer(playerId: string, startParam: string): Promise<boolean> {
    const code = referralCodeSchema.safeParse(startParam.replace(/^ref_/, ''));
    const referrerId = code.success
      ? await this.players.playerIdByReferralCode(code.data)
      : playerIdFromLegacyCode(startParam);
    return referrerId ? this.setReferrerId(playerId, referrerId) : false;
  }

  /**
   * Запомнить, кто пригласил игрока: по реферальной ссылке на бота или по приглашению в комнату.
   * Работает один раз и только для новичка: кто уже бросал в виджете или сыграл партию,
   * чужим рефералом не становится. Себя пригласить нельзя.
   */
  async setReferrerId(playerId: string, referrerId: string): Promise<boolean> {
    if (referrerId === playerId) return false;
    const [referrer] = await this.db.select({ id: players.id }).from(players).where(eq(players.id, referrerId));
    if (!referrer) return false;
    const [played] = await this.db
      .select({ yes: playedMatch(playerId) })
      .from(players)
      .where(eq(players.id, playerId));
    if (!played || played.yes) return false;

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
   * Выдать награду за приглашение. Вызывается после броска в виджете и после партии за столом:
   * если приглашённый уже сыграл (бросил в виджете или закончил партию), он и пригласивший
   * получают по REFERRAL_BONUS_ROLLS бонусных бросков. Награда за игру, а не за переход
   * по ссылке: так она идёт за живого игрока.
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
            sql`(${widgetPlayers.lastDice} is not null or ${playedMatch(widgetPlayers.playerId)})`,
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
        ? {
            playerId: referrerId,
            chatId: referrer.chatId,
            messageId: referrer.messageId,
            lang: referrer.lang === 'en' ? 'en' : 'ru',
          }
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
}
