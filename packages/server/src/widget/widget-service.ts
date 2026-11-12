import {
  accrueWidgetRolls,
  rollWidgetDice,
  spendWidgetRoll,
  WIDGET_MAX_STORED_ROLLS,
  WIDGET_ROLL_INTERVAL_SEC,
  type Rng,
  type WidgetDice,
  type WidgetRollBank,
  type WidgetSkinRarity,
} from '@gamedeck/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { items, playerItems, widgetPlayers } from '../db/schema.js';
import { changeCoins, type Tx } from '../db/wallet.js';
import type { PlayerService } from '../players/player-service.js';
import type { WidgetRollAnswer, WidgetState } from './build.js';

const RARITY_TEXT: Record<WidgetSkinRarity, string> = { common: 'обычный', rare: 'редкий', epic: 'эпический' };
/** Какие предметы выпадают скином: только то, что видно на столе. */
const SKIN_KINDS = ['mat', 'dice'];

const toUnix = (date: Date | null) => (date ? Math.floor(date.getTime() / 1000) : null);
const fromUnix = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000));

function parseDice(text: string | null): WidgetDice | null {
  const dice = text?.split(',').map(Number);
  return dice?.length === 3 ? (dice as unknown as WidgetDice) : null;
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
      ...(dice ? { d: dice } : {}),
    };
  }

  /**
   * Бросок по запросу виджета. Всё в одной транзакции со строкой игрока под замком:
   * два одновременных нажатия не потратят один и тот же бросок и не начислят монеты дважды.
   */
  async roll(playerId: string, now: number): Promise<WidgetRollAnswer> {
    return this.db.transaction(async (tx) => {
      await tx.insert(widgetPlayers).values({ playerId, rolls: WIDGET_MAX_STORED_ROLLS }).onConflictDoNothing();
      const [row] = await tx.select().from(widgetPlayers).where(eq(widgetPlayers.playerId, playerId)).for('update');

      const bank = spendWidgetRoll(accrueWidgetRolls(this.bankOf(row), now, this.intervalSec), now, this.intervalSec);
      if (!bank) return { e: 'NO_ROLLS' as const };

      const roll = rollWidgetDice(this.rng);
      const coins = await changeCoins(tx, playerId, roll.coins, 'widget_roll', roll.dice.join(','));
      const extra = roll.skin
        ? await this.grantSkin(tx, playerId, roll.skin)
        : roll.modifier
          ? 'Выпал модификатор'
          : null;

      await tx
        .update(widgetPlayers)
        .set({
          rolls: bank.rolls,
          nextAt: fromUnix(bank.nextAt),
          lastDice: roll.dice.join(','),
          modifiers: sql`${widgetPlayers.modifiers} + ${roll.modifier ? 1 : 0}`,
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
        ...(extra ? { x: extra } : {}),
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
