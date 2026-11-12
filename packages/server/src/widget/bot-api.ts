/** Ошибка, которую вернул Bot API: код HTTP и описание от Telegram. */
export class BotApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    description: string,
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

/**
 * Вызвать метод Bot API. Обёртка намеренно тонкая: у виджетов всего три метода
 * (sendWidget, editMessageWidgetData, answerWidgetQuery), библиотека ради них не нужна.
 */
export async function callBotApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json()) as BotApiResponse<T>;
  if (!body.ok || body.result === undefined) {
    throw new BotApiError(method, body.error_code ?? response.status, body.description ?? 'неизвестная ошибка');
  }
  return body.result;
}
