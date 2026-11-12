import { useEffect, useSyncExternalStore } from 'react';
import type { TipId } from '../components/tutorial/texts';
import { useClientState } from './store';

/**
 * Состояние обучения живёт в браузере игрока, а не на сервере: это личная настройка
 * интерфейса, другим игрокам и рейтингу она не нужна.
 */
const ENABLED_KEY = 'gamedeck.tutorial';
const SEEN_KEY = 'gamedeck.tutorial.seen';

// localStorage может быть недоступен (приватный режим, запрет в WebView) — тогда обучение
// просто не запоминается между запусками, но работает.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // см. read
  }
}

function readSeen(): Set<TipId> {
  try {
    const parsed: unknown = JSON.parse(read(SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? (parsed as TipId[]) : []);
  } catch {
    return new Set();
  }
}

interface TutorialState {
  /** Явный выбор игрока; null — не выбирал, решаем по числу сыгранных партий. */
  choice: boolean | null;
  seen: ReadonlySet<TipId>;
}

const stored = read(ENABLED_KEY);
let state: TutorialState = { choice: stored === null ? null : stored === 'on', seen: readSeen() };
const listeners = new Set<() => void>();

function update(next: TutorialState): void {
  state = next;
  if (next.choice !== null) write(ENABLED_KEY, next.choice ? 'on' : 'off');
  write(SEEN_KEY, JSON.stringify([...next.seen]));
  listeners.forEach((listener) => listener());
}

/** Закрыть подсказку: больше она не покажется, следующая по ситуации займёт её место. */
export function dismissTip(id: TipId): void {
  update({ ...state, seen: new Set([...state.seen, id]) });
}

/** Включить обучение заново (все подсказки снова покажутся) или выключить совсем. */
export function setTutorialEnabled(enabled: boolean): void {
  update({ choice: enabled, seen: enabled ? new Set() : state.seen });
}

/**
 * Обучение включено, если игрок сам его включил или ещё не сыграл ни одной партии.
 * Пока профиль не загрузился, ничего не показываем, чтобы опытный игрок не увидел мигания подсказки.
 */
export function useTutorial(): { enabled: boolean; seen: ReadonlySet<TipId> } {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  const gamesPlayed = useClientState((s) => s.profile?.gamesPlayed);
  const enabled = current.choice ?? gamesPlayed === 0;
  // Новичка запоминаем сразу: иначе после первой партии счётчик станет 1
  // и обучение выключится посреди подсказки «Партия окончена».
  useEffect(() => {
    if (current.choice === null && gamesPlayed === 0) setTutorialEnabled(true);
  }, [current.choice, gamesPlayed]);
  return { enabled, seen: current.seen };
}
