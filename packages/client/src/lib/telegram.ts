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

/** Имя по тем же правилам, что и на сервере (displayNameOf). */
export const telegramName = telegramUser
  ? ([telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ').trim() || telegramUser.username || 'Игрок').slice(0, 24)
  : null;

/** Код комнаты из ссылки t.me/<бот>/<приложение>?startapp=K7M2Q. */
export const startRoomCode = tg?.initDataUnsafe.start_param?.toUpperCase() ?? null;

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

/** Ссылка-приглашение: в Telegram — на Mini App, иначе — на сайт. */
export function inviteLink(code: string, telegramAppUrl: string | null): string {
  return telegramAppUrl ? `${telegramAppUrl}?startapp=${code}` : `${location.origin}/?room=${code}`;
}

/** Открыть системное «Поделиться» Telegram со ссылкой на комнату. */
export function shareInvite(link: string, code: string): void {
  const text = `Заходи в GameDeck, комната ${code}`;
  tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}
