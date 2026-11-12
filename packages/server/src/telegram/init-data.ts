import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Проверка initData — строки, которую Telegram передаёт Mini App при запуске.
 * В ней пользователь (id, имя, аватар), start_param из ссылки и подпись hash.
 *
 * Клиенту верить нельзя: initData может подделать кто угодно. Но подделать подпись
 * без токена бота невозможно — его знают только Telegram и наш сервер.
 * Алгоритм из документации Telegram:
 *   secret = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash   = hex(HMAC_SHA256(key = secret, data = data_check_string))
 * где data_check_string — все поля, кроме hash, отсортированные по ключу, в виде key=value через \n.
 */

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  /** Есть не всегда: зависит от клиента Telegram и настроек приватности. */
  photo_url: z.string().url().optional(),
});

export type TelegramUser = z.infer<typeof telegramUserSchema>;

export interface TelegramLaunch {
  user: TelegramUser;
  /** Параметр из ссылки t.me/<бот>/<приложение>?startapp=… — у нас это код комнаты. */
  startParam: string | null;
  authDate: Date;
}

export class InitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitDataError';
  }
}

export interface VerifyOptions {
  botToken: string;
  /** Сколько секунд initData считается свежей. Защищает от повторного использования украденной строки. */
  maxAgeSec: number;
  now?: Date;
}

/** HMAC от data_check_string: поля без hash, по алфавиту, key=value через перевод строки. */
function sign(params: URLSearchParams, botToken: string): Buffer {
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest();
}

export function verifyInitData(raw: string, { botToken, maxAgeSec, now = new Date() }: VerifyOptions): TelegramLaunch {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) throw new InitDataError('нет подписи');
  params.delete('hash');

  const expected = sign(params, botToken);

  // Сравнение за постоянное время: обычное === по времени подсказывает, сколько байт совпало.
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError('подпись не совпадает');
  }

  const authDate = new Date(Number(params.get('auth_date')) * 1000);
  if (Number.isNaN(authDate.getTime())) throw new InitDataError('нет auth_date');
  if (now.getTime() - authDate.getTime() > maxAgeSec * 1000) throw new InitDataError('initData устарела');

  let rawUser: unknown;
  try {
    rawUser = JSON.parse(params.get('user') ?? 'null');
  } catch {
    throw new InitDataError('user — не JSON');
  }
  const user = telegramUserSchema.safeParse(rawUser);
  if (!user.success) throw new InitDataError('нет пользователя');

  return { user: user.data, startParam: params.get('start_param'), authDate };
}

/** Имя для стола: «Имя Фамилия», обрезанное до лимита имени игрока. */
export function displayNameOf(user: TelegramUser): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return (full || user.username || 'Игрок').slice(0, 24);
}

/** Подписать initData так же, как это делает Telegram. Нужно тестам и локальной отладке. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.set('hash', sign(params, botToken).toString('hex'));
  return params.toString();
}
