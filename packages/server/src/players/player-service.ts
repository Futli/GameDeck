import { createHash, randomBytes } from 'node:crypto';
import { parseDiceStyle, type DiceStyle, type SessionInfo } from '@gamedeck/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
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
import { displayNameOf, type TelegramUser } from '../telegram/init-data.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');

/** С чем создаётся игрок. Анонимный — со значениями по умолчанию. */
interface NewPlayer {
  telegramId?: number;
  displayName?: string;
  avatarUrl?: string | null;
}

/**
 * Игроки и их сессии. Сессия — секретный токен у клиента; в базе лежит только хэш.
 * Два способа войти: анонимно по токену (браузер) и через Telegram (проверенная initData).
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

  /**
   * Вход из Telegram. initData уже проверена, поэтому telegram id — надёжный ключ игрока:
   * тот же человек с другого телефона попадёт в тот же профиль.
   *
   * - Игрок с этим telegram id есть — обновляем имя и аватар, выдаём сессию.
   * - Нет, но у клиента токен анонимного игрока — привязываем Telegram к нему,
   *   чтобы не потерять монеты и рейтинг, набранные до входа через Telegram.
   * - Иначе — новый игрок.
   */
  async resolveTelegram(user: TelegramUser, token: unknown): Promise<SessionInfo> {
    const profile = { displayName: displayNameOf(user), avatarUrl: user.photo_url ?? null, lastSeenAt: new Date() };
    const tokenOwner = await this.findPlayerId(token);

    const [known] = await this.db.select({ id: players.id }).from(players).where(eq(players.telegramId, user.id));
    if (known) {
      await this.db.update(players).set(profile).where(eq(players.id, known.id));
      if (tokenOwner === known.id) return { token: token as string, playerId: known.id };
      return { token: await this.createSession(known.id), playerId: known.id };
    }

    if (tokenOwner) {
      // isNull в условии: если игрока уже привязали к другому Telegram, токен не переиспользуем.
      const [linked] = await this.db
        .update(players)
        .set({ ...profile, telegramId: user.id })
        .where(and(eq(players.id, tokenOwner), isNull(players.telegramId)))
        .returning({ id: players.id });
      if (linked) return { token: token as string, playerId: linked.id };
    }

    return this.register({ telegramId: user.id, displayName: profile.displayName, avatarUrl: profile.avatarUrl });
  }

  private async createSession(playerId: string): Promise<string> {
    const token = newToken();
    await this.db.insert(sessions).values({ tokenHash: hashToken(token), playerId });
    return token;
  }

  /** Новый игрок: строка в players, сессия, стартовые монеты и бесплатные предметы. */
  async register(info: NewPlayer = {}): Promise<SessionInfo> {
    const token = newToken();
    const playerId = await this.db.transaction(async (tx) => {
      const [player] = await tx.insert(players).values(info).returning({ id: players.id });
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
      .select({ id: players.id, displayName: players.displayName, avatarUrl: players.avatarUrl, createdAt: players.createdAt })
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

  /** Аватар из Telegram, если игрок входил через Mini App. */
  async avatarUrl(playerId: string): Promise<string | null> {
    const [row] = await this.db.select({ avatarUrl: players.avatarUrl }).from(players).where(eq(players.id, playerId));
    return row?.avatarUrl ?? null;
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
