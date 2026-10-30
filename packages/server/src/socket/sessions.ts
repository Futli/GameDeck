import { randomBytes, randomUUID } from 'node:crypto';
import type { SessionInfo } from '@gamedeck/shared';

/**
 * Сессии игроков: token → playerId. Сокет живёт до первого обрыва связи,
 * а игрок — дольше: после перезагрузки вкладки клиент присылает тот же token
 * и получает свой playerId и место за столом обратно.
 * Позже здесь будет проверка Telegram initData вместо случайного токена.
 */
export class SessionStore {
  private readonly byToken = new Map<string, string>();

  resolve(token: unknown): SessionInfo {
    if (typeof token === 'string') {
      const playerId = this.byToken.get(token);
      if (playerId) return { token, playerId };
    }
    const session = { token: randomBytes(24).toString('base64url'), playerId: randomUUID() };
    this.byToken.set(session.token, session.playerId);
    return session;
  }
}
