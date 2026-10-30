import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Схема базы. Из этого файла drizzle-kit генерирует SQL-миграции (папка drizzle/),
 * а drizzle-orm выводит из него типы для запросов.
 */

/** Игрок. Пока анонимный (по токену), позже появится telegram_id. */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Telegram user id. Заполнится, когда подключим авторизацию через initData. */
  telegramId: bigint('telegram_id', { mode: 'number' }).unique(),
  displayName: text('display_name').notNull().default('Игрок'),
  /** Баланс виртуальных монет. Меняется только вместе с записью в coin_transactions. */
  coins: bigint('coins', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('players_coins_non_negative', sql`${t.coins} >= 0`)]);

/** Сессии: храним не сам токен, а его SHA-256, чтобы утечка БД не давала войти за игрока. */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_player_idx').on(t.playerId)],
);

/** Рейтинг и статистика игрока в конкретной игре: одна строка на пару (игрок, игра). */
export const playerGameStats = pgTable(
  'player_game_stats',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    gameId: text('game_id').notNull(),
    rating: integer('rating').notNull().default(1000),
    peakRating: integer('peak_rating').notNull().default(1000),
    gamesPlayed: integer('games_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.gameId] }),
    // Таблица лидеров: «топ по рейтингу в игре X».
    index('player_game_stats_leaderboard_idx').on(t.gameId, t.rating.desc()),
  ],
);

/** Сыгранная партия. */
export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id').notNull(),
    roomCode: text('room_code').notNull(),
    stake: integer('stake').notNull().default(0),
    winnerId: uuid('winner_id').references(() => players.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index('matches_finished_idx').on(t.finishedAt.desc())],
);

/** Участник партии: место и изменение рейтинга. Из этой таблицы строится история игрока. */
export const matchPlayers = pgTable(
  'match_players',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    seat: smallint('seat').notNull(),
    /** 1 — победитель. Одинаковое место — делят его. Ушедшие из партии — последние. */
    place: smallint('place').notNull(),
    ratingBefore: integer('rating_before').notNull(),
    ratingAfter: integer('rating_after').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.playerId] }),
    index('match_players_player_idx').on(t.playerId),
  ],
);

// ─── Монетизация ────────────────────────────────────────────────────────────

/**
 * Журнал движения монет. Баланс в players.coins — это кэш суммы этого журнала:
 * по журналу всегда можно ответить «откуда у игрока столько монет».
 */
export const coinTransactions = pgTable(
  'coin_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    /** Плюс — начисление, минус — списание. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    /** stars_purchase | item_purchase | match_win | match_stake | bonus | referral */
    reason: text('reason').notNull(),
    /** На что ссылается операция: id предмета, партии, платежа. */
    refId: text('ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('coin_transactions_player_idx').on(t.playerId, t.createdAt.desc())],
);

/**
 * Каталог предметов: коврики 128×64, скины кубиков, рамки аватара, эмоции.
 * Строки синхронизируются из src/shop/catalog.ts при старте сервера.
 */
export const items = pgTable('items', {
  /** Читаемый id, например mat-neon. */
  id: text('id').primaryKey(),
  /** mat | dice | frame | emote. Совпадает со слотом экипировки. */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** common | rare | epic | legendary */
  rarity: text('rarity').notNull().default('common'),
  /** Цена в монетах; null — за монеты не продаётся. */
  priceCoins: integer('price_coins'),
  /** Цена в Telegram Stars; null — за Stars не продаётся. */
  priceStars: integer('price_stars'),
  /** Путь к спрайту или JSON-описание пиксельной картинки. */
  asset: text('asset').notNull(),
  /** Выдаётся всем новым игрокам бесплатно. */
  isDefault: boolean('is_default').notNull().default(false),
  /** Снятые с продажи предметы остаются у владельцев, но не видны в магазине. */
  isActive: boolean('is_active').notNull().default(true),
});

/** Наборы монет за Stars (донат-паки). */
export const coinPacks = pgTable('coin_packs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  priceStars: integer('price_stars').notNull(),
  coins: integer('coins').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

/** Инвентарь: какие предметы есть у игрока. */
export const playerItems = pgTable(
  'player_items',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    /** default | coins | stars | reward | gift */
    source: text('source').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.itemId] })],
);

/** Что надето: один предмет на слот (slot = items.kind). */
export const playerEquipment = pgTable(
  'player_equipment',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    slot: text('slot').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.slot] })],
);

/**
 * Платежи Telegram Stars. telegram_charge_id уникален: если Telegram пришлёт
 * successful_payment повторно, второй раз ничего не начислится.
 */
export const starsPayments = pgTable('stars_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  telegramChargeId: text('telegram_charge_id').notNull().unique(),
  /** coin_pack | item */
  productKind: text('product_kind').notNull(),
  productId: text('product_id').notNull(),
  stars: integer('stars').notNull(),
  /** paid | refunded */
  status: text('status').notNull().default('paid'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
