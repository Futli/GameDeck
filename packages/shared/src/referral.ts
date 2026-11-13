import { z } from 'zod';

/**
 * Реферальный код игрока: 8 символов из строчных латинских букв и цифр, выдаётся при регистрации
 * и хранится в players.referral_code (генератор — в server/src/db/schema.ts). Им подписаны ссылка на бота (`?start=ref_<код>`)
 * и приглашение в комнату (`startapp=K7M2Q_<код>`). Код живёт в shared: ссылку собирает клиент,
 * а разбирает сервер. В параметрах start/startapp Telegram допустимы только буквы, цифры, `_` и `-`.
 */
export const referralCodeSchema = z.string().regex(/^[a-z0-9]{8}$/, 'Битый реферальный код');

/** Параметр ссылки на бота: /start ref_<код>. */
export const referralStartParam = (code: string) => `ref_${code}`;
