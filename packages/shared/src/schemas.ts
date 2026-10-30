import { z } from 'zod';
import { gameIds, type GameMove } from './games/index.js';

/**
 * zod-схемы всего, что приходит от клиента. Сервер не доверяет ни одному
 * полю, пока оно не прошло parse(). Типы ниже выводятся из схем, поэтому
 * схема и тип никогда не разъедутся.
 */

export const MAX_PLAYERS = 6;

/**
 * Цвета игроков. У каждого за столом свой цвет: им окрашены стакан, кубики
 * и коврик. Два игрока в одной комнате одного цвета быть не могут.
 */
export const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'] as const;
export const playerColorSchema = z.enum(PLAYER_COLORS);

/** Базовые оттенки для клиента (пиксельный стиль: основной и тень). */
export const PLAYER_COLOR_HEX: Record<PlayerColor, { main: string; shade: string }> = {
  red: { main: '#e5484d', shade: '#a8262b' },
  blue: { main: '#3e8ef7', shade: '#1f5bb0' },
  green: { main: '#46a758', shade: '#2a6b37' },
  yellow: { main: '#f5c542', shade: '#b38a1a' },
  purple: { main: '#8e4ec6', shade: '#5b2c86' },
  orange: { main: '#f76b15', shade: '#b04a0a' },
};

export const playerNameSchema = z.string().trim().min(1).max(24);
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5}$/, 'Код комнаты — 5 символов');

export const roomSettingsSchema = z.object({
  gameId: z.enum(gameIds),
  /** Ставка в виртуальных монетах. Пока только хранится и показывается. */
  stake: z.number().int().min(0).max(1_000_000),
  /** Пустая строка или null — комната без пароля. */
  password: z.string().max(32).nullable(),
  maxPlayers: z.number().int().min(2).max(MAX_PLAYERS),
});

export const createRoomSchema = z.object({
  name: playerNameSchema,
  /** Желаемый цвет. Если занят — сервер выдаст первый свободный. */
  color: playerColorSchema.optional(),
  settings: roomSettingsSchema.partial().optional(),
});

export const joinRoomSchema = z.object({
  code: roomCodeSchema,
  name: playerNameSchema,
  password: z.string().max(32).optional(),
  color: playerColorSchema.optional(),
});

export const updateSettingsSchema = roomSettingsSchema.partial();

export const kickSchema = z.object({ playerId: z.string().min(1) });

export const colorSchema = z.object({ color: playerColorSchema });

// Схемы ходов живут в модулях игр (GameModule.moveSchema): комната проверяет
// ход схемой той игры, что сейчас идёт.

export type RoomSettings = z.infer<typeof roomSettingsSchema>;
export type CreateRoomInput = z.input<typeof createRoomSchema>;
export type JoinRoomInput = z.input<typeof joinRoomSchema>;
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
export type KickInput = z.input<typeof kickSchema>;
export type ColorInput = z.input<typeof colorSchema>;
export type PlayerColor = z.infer<typeof playerColorSchema>;
export type MoveInput = GameMove;
