import { z } from 'zod';
import { gameIds } from './games/index.js';

/**
 * zod-схемы всего, что приходит от клиента. Сервер не доверяет ни одному
 * полю, пока оно не прошло parse(). Типы ниже выводятся из схем, поэтому
 * схема и тип никогда не разъедутся.
 */

export const MAX_PLAYERS = 6;

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
  settings: roomSettingsSchema.partial().optional(),
});

export const joinRoomSchema = z.object({
  code: roomCodeSchema,
  name: playerNameSchema,
  password: z.string().max(32).optional(),
});

export const updateSettingsSchema = roomSettingsSchema.partial();

export const kickSchema = z.object({ playerId: z.string().min(1) });

export const moveSchema = z.object({ type: z.literal('roll') });

export type RoomSettings = z.infer<typeof roomSettingsSchema>;
export type CreateRoomInput = z.input<typeof createRoomSchema>;
export type JoinRoomInput = z.input<typeof joinRoomSchema>;
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
export type KickInput = z.input<typeof kickSchema>;
export type MoveInput = z.input<typeof moveSchema>;
