import { useSyncExternalStore } from 'react';
import { telegramName } from './telegram';

/**
 * Имя игрока за столом. Меняется на странице настроек, а нужно главной и экрану игры,
 * поэтому живёт отдельным маленьким стором, как язык в i18n.
 *
 * Откуда берётся: в Telegram — ник из Telegram, иначе — то, что игрок вводил раньше в этом браузере.
 * Когда приходит профиль с сервера, его имя важнее (adoptProfileName): там ник, который игрок
 * мог сменить на другом устройстве.
 */
const NAME_KEY = 'gamedeck.name';
/** Имя новичка по умолчанию на сервере: его не подставляем, пусть игрок выберет своё. */
const DEFAULT_SERVER_NAME = 'Игрок';

function saved(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

let name = telegramName ?? saved();
/** Игрок уже правил имя в этой вкладке: профиль с сервера его не перетирает. */
let edited = false;
const listeners = new Set<() => void>();

function emit(next: string): void {
  name = next;
  listeners.forEach((listener) => listener());
}

/** Игрок ввёл имя. На сервер оно уйдёт при входе в комнату, здесь — запоминаем в браузере. */
export function setPlayerName(next: string): void {
  edited = true;
  try {
    localStorage.setItem(NAME_KEY, next.trim());
  } catch {
    // приватный режим: имя проживёт до закрытия вкладки
  }
  emit(next);
}

/** Профиль пришёл с сервера: берём сохранённое там имя, если игрок ещё ничего не вводил. */
export function adoptProfileName(serverName: string): void {
  if (edited || serverName === DEFAULT_SERVER_NAME || serverName === name) return;
  emit(serverName);
}

/** Имя сейчас — для кода вне рендера (вход по ссылке сразу после прихода профиля). */
export function getPlayerName(): string {
  return name;
}

export function usePlayerName(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => name,
  );
}
