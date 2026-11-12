import { fetch, ProxyAgent, type Dispatcher } from 'undici';

/** Ошибка, которую вернул Bot API: код и описание от Telegram. */
export class BotApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`Bot API ${method}: ${code} ${description}`);
  }
}

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/** Вызов метода Bot API. Интерфейс, а не функция, чтобы тесты подставляли вместо Telegram запись вызовов. */
export interface BotApi {
  call<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

/**
 * Клиент Bot API. Обёртка намеренно тонкая: боту нужны пять методов, библиотека ради них лишняя.
 *
 * proxyUrl — HTTP-прокси вида http://хост:порт. Сервер в России до api.telegram.org
 * напрямую не достучится, поэтому запросы идут через прокси (docs/deploy-guide.md).
 * Через прокси ходит только этот клиент: игроки и база работают напрямую.
 */
export function createBotApi(token: string, proxyUrl: string | null): BotApi {
  if (proxyUrl !== null && !/^https?:\/\//.test(proxyUrl)) {
    throw new Error('TELEGRAM_PROXY_URL должен начинаться с http:// или https://');
  }
  const dispatcher: Dispatcher | undefined = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  return {
    async call<T>(method: string, params: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
      });
      const body = (await response.json()) as BotApiResponse<T>;
      if (!body.ok || body.result === undefined) {
        throw new BotApiError(method, body.error_code ?? response.status, body.description ?? 'неизвестная ошибка');
      }
      return body.result;
    },
  };
}
