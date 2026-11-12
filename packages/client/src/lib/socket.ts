import type {
  AckResult,
  ClientToServerEvents,
  CreateRoomInput,
  MyProfile,
  JoinRoomInput,
  MoveInput,
  RoomSummary,
  RoomView,
  ServerToClientEvents,
  UpdateSettingsInput,
} from '@gamedeck/shared';
import { io, type Socket } from 'socket.io-client';
import { getState, setState } from './store';
import { tg } from './telegram';

const TOKEN_KEY = 'gamedeck.token';

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

/**
 * Одно соединение на всё приложение. auth вызывается при каждом (пере)подключении,
 * поэтому после обрыва сервер получит свежий токен и вернёт нас в комнату.
 * В Telegram добавляем initData: сервер проверит подпись и узнает, кто мы.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: (cb) => cb({ token: readToken(), ...(tg ? { initData: tg.initData } : {}) }),
});

socket.on('connect', () => setState({ connected: true }));
socket.on('connect_error', (err) => {
  // Ошибка из middleware сервера: Socket.IO сам больше не переподключается.
  if (err.message === 'TELEGRAM_AUTH_FAILED') {
    setState({ notice: 'Не удалось проверить вход через Telegram. Закройте и откройте игру заново.' });
  }
});

// Ссылка на Mini App для приглашений. Не пришла — ничего страшного, пригласим ссылкой на сайт.
fetch('/api/config')
  .then((r) => r.json() as Promise<{ telegramAppUrl: string | null }>)
  .then(({ telegramAppUrl }) => setState({ telegramAppUrl }))
  .catch(() => {});
socket.on('disconnect', () => setState({ connected: false }));

let sessionToken: string | null = null;

/** Профиль для главного экрана. Ошибку не показываем: без статистики играть можно. */
function loadProfile(): void {
  if (!sessionToken) return;
  fetch('/api/me', { headers: { authorization: `Bearer ${sessionToken}` } })
    .then((r) => (r.ok ? (r.json() as Promise<MyProfile>) : null))
    .then((profile) => profile && setState({ profile }))
    .catch(() => {});
}

/**
 * Запрос к HTTP API от имени игрока (тот же токен, что и у сокета). Ошибку сервера
 * показываем внизу экрана и пробрасываем дальше, как в call().
 */
export async function http<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${sessionToken ?? ''}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    const message = data?.message ?? 'Сервер не ответил, попробуйте ещё раз';
    setState({ notice: message });
    throw Object.assign(new Error(message), { code: data?.error ?? 'HTTP_ERROR' });
  }
  return data as T;
}

socket.on('session', ({ token, playerId }) => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // приватный режим: сессия проживёт до закрытия вкладки
  }
  sessionToken = token;
  setState({ playerId });
  loadProfile();
});

socket.on('room:state', (room) => {
  // Новая партия — убираем итог прошлой.
  const lastMatch = room.status === 'playing' ? null : getState().lastMatch;
  setState({ room, lastMatch });
});

socket.on('room:kicked', () => setState({ room: null, notice: 'Хост исключил вас из комнаты' }));
socket.on('match:recorded', (lastMatch) => {
  setState({ lastMatch });
  // Партия записана — обновляем счётчики игр, побед и монет.
  loadProfile();
});

/** Запрос с ответом. Ошибку сервера показываем внизу экрана и пробрасываем дальше. */
async function call<T>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  // Типы событий проверяются в api ниже; здесь только общий механизм ack.
  const emit = socket.emitWithAck.bind(socket) as unknown as (
    event: string,
    ...args: unknown[]
  ) => Promise<AckResult<T>>;
  const result = await emit(event, ...args);
  if (!result.ok) {
    setState({ notice: result.error.message });
    throw Object.assign(new Error(result.error.message), { code: result.error.code });
  }
  setState({ notice: null });
  return result.data;
}

/** Все действия игрока. Компоненты вызывают только их и не знают о названиях событий. */
export const api = {
  createRoom: (input: CreateRoomInput) => call<RoomView>('room:create', input),
  joinRoom: (input: JoinRoomInput) => call<RoomView>('room:join', input),
  leaveRoom: async () => {
    await call<null>('room:leave');
    setState({ room: null, lastMatch: null });
  },
  updateSettings: (input: UpdateSettingsInput) => call<RoomView>('room:settings', input),
  kick: (playerId: string) => call<RoomView>('room:kick', { playerId }),
  watchRooms: () => call<RoomSummary[]>('rooms:watch'),
  unwatchRooms: () => call<null>('rooms:unwatch'),
  startGame: () => call<RoomView>('game:start'),
  roll: () => call<RoomView>('game:move', { type: 'roll' }),
  move: (move: MoveInput) => call<RoomView>('game:move', move),
};
