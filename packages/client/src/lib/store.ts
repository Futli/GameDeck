import type { MatchRecord, MyProfile, RoomView } from '@gamedeck/shared';
import { useSyncExternalStore } from 'react';

/** Всё, что клиент знает о мире. Источник правды — сервер, здесь только последнее, что он прислал. */
export interface ClientState {
  connected: boolean;
  playerId: string | null;
  /** Свой профиль: имя, баланс и статистика. null — ещё не загрузился. */
  profile: MyProfile | null;
  room: RoomView | null;
  /** Итог последней партии с изменением рейтинга. */
  lastMatch: MatchRecord | null;
  /** Короткое сообщение внизу экрана: ошибка или «вас исключили». */
  notice: string | null;
  /** https://t.me/<бот>/<приложение> из /api/config; null — приглашаем ссылкой на сайт. */
  telegramAppUrl: string | null;
  /** Бот присылает «Кубик удачи» в чат (TELEGRAM_CHAT_WIDGET): тогда есть кнопка «Открыть виджет в чате». */
  chatWidget: boolean;
}

let state: ClientState = {
  connected: false,
  playerId: null,
  profile: null,
  room: null,
  lastMatch: null,
  notice: null,
  telegramAppUrl: null,
  chatWidget: false,
};
const listeners = new Set<() => void>();

export function setState(patch: Partial<ClientState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getState(): ClientState {
  return state;
}

/**
 * Маленький стор без библиотек: React подписывается через useSyncExternalStore
 * и перерисовывает компонент, когда меняется выбранная часть состояния.
 */
export function useClientState<T>(select: (s: ClientState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}
