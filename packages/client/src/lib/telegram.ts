import { referralCodeSchema, type JoinRoomInput } from '@gamedeck/shared';

/**
 * Всё, что связано с запуском внутри Telegram. Объект window.Telegram.WebApp создаёт
 * скрипт telegram-web-app.js (подключён в index.html). Вне Telegram он тоже есть,
 * но initData пустая — по ней и отличаем Mini App от обычного браузера.
 */

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  /** Язык приложения Telegram у игрока (IETF, например «ru» или «en-US»). */
  language_code?: string;
}

/** Цвета текущей темы Telegram. Любое поле может отсутствовать (старые клиенты). */
interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
  destructive_text_color?: string;
}

/** Только то, чем пользуемся. Полное описание: https://core.telegram.org/bots/webapps */
interface TelegramWebApp {
  /** Подписанная строка для сервера. Клиент её не разбирает, только передаёт. */
  initData: string;
  /** Те же данные, но без проверки — годятся только для показа (имя, аватар). */
  initDataUnsafe: { user?: TelegramUser; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openTelegramLink(url: string): void;
  onEvent(event: 'themeChanged', callback: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const webApp = window.Telegram?.WebApp;

/** Открыты ли мы как Mini App. */
export const tg = webApp?.initData ? webApp : null;

export const telegramUser = tg?.initDataUnsafe.user ?? null;

/** Ник по умолчанию по тем же правилам, что и на сервере (displayNameOf): username, иначе имя. */
export const telegramName = telegramUser
  ? (
      telegramUser.username ||
      [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ').trim() ||
      'Игрок'
    ).slice(0, 24)
  : null;

/**
 * Приглашение в комнату приходит как startapp=K7M2Q_ab12cd34 (Telegram) или /?room=K7M2Q&ref=ab12cd34
 * (браузер): код комнаты и реферальный код того, кто поделился ссылкой. В старых ссылках кода нет.
 */
const startParam = tg?.initDataUnsafe.start_param ?? '';
const urlParams = new URLSearchParams(location.search);

/**
 * Ссылка из окна приза в виджете «Кубик удачи»: startapp=luck — его страница, startapp=luck-<id скина> —
 * она же с выпавшим скином. В браузере то же самое: /?luck и /?luck=<id скина>.
 */
const luckMatch = /^luck(?:-([0-9a-f-]{36}))?$/.exec(startParam);
export const startLuck: { skinId: string | null } | null = luckMatch
  ? { skinId: luckMatch[1] ?? null }
  : urlParams.has('luck')
    ? { skinId: urlParams.get('luck') || null }
    : null;

const [startCode, ...startRef] = luckMatch ? [] : startParam.split('_');

/** Код комнаты из ссылки t.me/<бот>/<приложение>?startapp=…: по нему Mini App сразу садит за стол. */
export const startRoomCode = startCode ? startCode.toUpperCase() : null;

/** Код комнаты из ссылки-приглашения: им заполнено поле «Код комнаты». */
export const linkRoomCode = startRoomCode ?? urlParams.get('room')?.toUpperCase() ?? '';
const linkRef = startRoomCode ? startRef.join('_') : urlParams.get('ref');

/**
 * Как игрок узнал код (поле invite в room:join). Код из ссылки с целым реферальным кодом —
 * пригласил тот, кто поделился. Код набран руками, взят из старой ссылки или ссылка битая —
 * «code», тогда сервер засчитает приглашение хосту.
 */
export function inviteFor(code: string): JoinRoomInput['invite'] {
  const ref = referralCodeSchema.safeParse(linkRef);
  return code === linkRoomCode && ref.success ? ref.data : 'code';
}

/**
 * Цвета Telegram → наши CSS-переменные (styles.css). Свою тёмную палитру оставляем
 * для всего, чего в теме нет: сукно стола, цвета игроков.
 */
function applyTheme(app: TelegramWebApp): void {
  const t = app.themeParams;
  const vars: Record<string, string | undefined> = {
    '--bg': t.bg_color,
    '--surface': t.secondary_bg_color,
    '--surface-2': t.section_bg_color ?? t.secondary_bg_color,
    '--text': t.text_color,
    '--muted': t.hint_color,
    '--accent': t.button_color,
    '--accent-text': t.button_text_color,
    '--bad': t.destructive_text_color,
  };
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    if (value) root.style.setProperty(name, value);
  }
  root.style.colorScheme = app.colorScheme;
  root.dataset.theme = app.colorScheme;
  app.setHeaderColor?.('bg_color');
  if (t.bg_color) app.setBackgroundColor?.(t.bg_color);
}

/** Вызвать один раз при старте: тема, полный экран и сигнал Telegram «приложение готово». */
export function initTelegram(): void {
  if (!tg) return;
  applyTheme(tg);
  tg.onEvent('themeChanged', () => applyTheme(tg));
  tg.expand();
  // Свайп вниз по столу не должен закрывать игру.
  tg.disableVerticalSwipes?.();
  tg.ready();
}

/**
 * Ссылка-приглашение: в Telegram — на Mini App, иначе — на сайт. В ней реферальный код того,
 * кто делится: новичок, пришедший по ссылке, засчитается ему как приглашённый друг.
 */
export function inviteLink(code: string, telegramAppUrl: string | null, ref: string | null): string {
  if (telegramAppUrl) return `${telegramAppUrl}?startapp=${ref ? `${code}_${ref}` : code}`;
  return `${location.origin}/?room=${code}${ref ? `&ref=${ref}` : ''}`;
}

/** Открыть системное «Поделиться» Telegram со ссылкой на комнату и текстом приглашения. */
export function shareInvite(link: string, text: string): void {
  tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

/**
 * Чат с ботом, который присылает виджет «Кубик удачи» заново: /start dice. Адрес Mini App
 * выглядит как https://t.me/<бот>/<приложение>, из него берём имя бота. null — бот не настроен.
 */
export function luckChatLink(telegramAppUrl: string | null): string | null {
  const bot = /^https:\/\/t\.me\/([A-Za-z0-9_]+)\//.exec(telegramAppUrl ?? '')?.[1];
  return bot ? `https://t.me/${bot}?start=dice` : null;
}

/** Открыть ссылку t.me: в Telegram — им самим, в браузере — новой вкладкой. */
export function openTelegramLink(url: string): void {
  if (tg) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}
