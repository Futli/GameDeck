import { createHash, randomBytes } from 'node:crypto';
import { parseDiceStyle, type DiceStyle, type SessionInfo } from '@gamedeck/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  items,
  matchPlayers,
  matches,
  playerEquipment,
  playerGameStats,
  playerItems,
  players,
  sessions,
} from '../db/schema.js';
import { changeCoins } from '../db/wallet.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Игроки и их сессии. Сессия — секретный токен у клиента; в базе лежит только хэш.
 * Позже сюда добавится вход через Telegram initData (поиск игрока по telegram_id).
 */
export class PlayerService {
  constructor(
    private readonly db: Db,
    private readonly startingCoins = 500,
  ) {}

  /** Найти игрока по токену или зарегистрировать нового. */
  async resolveSession(token: unknown): Promise<SessionInfo> {
    const playerId = await this.findPlayerId(token);
    if (playerId) {
      await this.db.update(players).set({ lastSeenAt: new Date() }).where(eq(players.id, playerId));
      return { token: token as string, playerId };
    }
    return this.register();
  }

  /** Только поиск, без регистрации. Нужен HTTP-запросам с заголовком Authorization. */
  async findPlayerId(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || token.length === 0) return null;
    const [found] = await this.db
      .select({ playerId: sessions.playerId })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)));
    return found?.playerId ?? null;
  }

  /** Новый игрок: строка в players, сессия, стартовые монеты и бесплатные предметы. */
  async register(): Promise<SessionInfo> {
    const token = randomBytes(24).toString('base64url');
    const playerId = await this.db.transaction(async (tx) => {
      const [player] = await tx.insert(players).values({}).returning({ id: players.id });
      const id = player!.id;
      await tx.insert(sessions).values({ tokenHash: hashToken(token), playerId: id });

      const defaults = await tx.select().from(items).where(eq(items.isDefault, true));
      if (defaults.length > 0) {
        await tx.insert(playerItems).values(defaults.map((i) => ({ playerId: id, itemId: i.id, source: 'default' })));
        await tx
          .insert(playerEquipment)
          .values(defaults.map((i) => ({ playerId: id, slot: i.kind, itemId: i.id })))
          .onConflictDoNothing();
      }
      if (this.startingCoins > 0) await changeCoins(tx, id, this.startingCoins, 'bonus', 'welcome');
      return id;
    });
    return { token, playerId };
  }

  async rename(playerId: string, displayName: string): Promise<void> {
    await this.db.update(players).set({ displayName }).where(eq(players.id, playerId));
  }

  /** Публичный профиль: имя, рейтинг и статистика по играм, последние партии, надетые предметы. */
  async profile(playerId: string) {
    const [player] = await this.db
      .select({ id: players.id, displayName: players.displayName, createdAt: players.createdAt })
      .from(players)
      .where(eq(players.id, playerId));
    if (!player) return null;

    const [stats, recent, equipment] = await Promise.all([
      this.db
        .select({
          gameId: playerGameStats.gameId,
          rating: playerGameStats.rating,
          peakRating: playerGameStats.peakRating,
          gamesPlayed: playerGameStats.gamesPlayed,
          wins: playerGameStats.wins,
        })
        .from(playerGameStats)
        .where(eq(playerGameStats.playerId, playerId)),
      this.db
        .select({
          matchId: matches.id,
          gameId: matches.gameId,
          finishedAt: matches.finishedAt,
          place: matchPlayers.place,
          ratingBefore: matchPlayers.ratingBefore,
          ratingAfter: matchPlayers.ratingAfter,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(eq(matchPlayers.playerId, playerId))
        .orderBy(desc(matches.finishedAt))
        .limit(10),
      this.equipment(playerId),
    ]);
    return { ...player, stats, recentMatches: recent, equipment };
  }

  /** Стиль надетого скина кубиков (цвет грани и точек) — его видят все за столом. */
  async diceStyle(playerId: string): Promise<DiceStyle> {
    const [row] = await this.db
      .select({ asset: items.asset })
      .from(playerEquipment)
      .innerJoin(items, eq(items.id, playerEquipment.itemId))
      .where(and(eq(playerEquipment.playerId, playerId), eq(playerEquipment.slot, 'dice')));
    return parseDiceStyle(row?.asset);
  }

  /** Надетые предметы: { mat: 'mat-neon', dice: 'dice-classic', ... }. */
  async equipment(playerId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ slot: playerEquipment.slot, itemId: playerEquipment.itemId })
      .from(playerEquipment)
      .where(eq(playerEquipment.playerId, playerId));
    return Object.fromEntries(rows.map((r) => [r.slot, r.itemId]));
  }
}
