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

/** Оттенки для клиента в пиксельном стиле: блик, основной и тень. Насыщенные, чтобы читались на сукне. */
export const PLAYER_COLOR_HEX: Record<PlayerColor, { light: string; main: string; shade: string }> = {
  red: { light: '#ff7a84', main: '#ff2d3d', shade: '#a8101c' },
  blue: { light: '#73b4ff', main: '#1f7bff', shade: '#0b46a8' },
  green: { light: '#7ff09a', main: '#18c447', shade: '#0b7228' },
  yellow: { light: '#ffe873', main: '#ffc800', shade: '#a87d00' },
  purple: { light: '#d08eff', main: '#a53cff', shade: '#5e12a8' },
  orange: { light: '#ffaa66', main: '#ff6a00', shade: '#a84300' },
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
