import { deflateSync } from 'node:zlib';
import {
  diceShades,
  PLAYER_COLOR_HEX,
  type DiceStyle,
  type PlayerColor,
  type WidgetDice,
  type WidgetRollOutcome,
} from '@gamedeck/shared';
import { assertValidMat, type MatSkin } from './mat.js';
import { WIDGET_SOURCE } from './source.js';
import { WIDGET_UI, type BotLang, type WidgetUiKey } from './texts.js';

/** Лимиты Telegram на HTML виджета: сырой размер и размер после zlib уровня 9. */
export const WIDGET_MAX_BYTES = 32_768;
export const WIDGET_MAX_PACKED = 4096;
/**
 * Запас к лимиту сжатого размера: zlib в Node и на серверах Telegram может
 * дать результат, отличающийся на несколько десятков байт.
 */
const PACKED_MARGIN = 64;
/** Лимит Telegram на строку состояния (chat_data). */
const STATE_MAX_BYTES = 1024;

/** Что надето на игроке: всё это видно в виджете. */
export interface WidgetSkins {
  mat: MatSkin;
  dice: DiceStyle;
  cup: PlayerColor;
}

/** Куда ведут кнопки виджета. null — кнопка не показывается. Только https://t.me/…, до 256 символов. */
export interface WidgetLinks {
  invite: string | null;
  ad: string | null;
  findGame: string | null;
}

/**
 * Состояние виджета, которое бот кладёт в chat_data. Имена полей короткие,
 * потому что строка ограничена 1 КБ и читает её только код виджета.
 */
export interface WidgetState {
  /** Сколько бросков доступно. */
  r: number;
  /** Когда придёт следующий бросок (unix, секунды); 0 — запас полон. */
  n: number;
  /** Интервал между бросками в секундах: виджет сам досчитывает таймер между ответами сервера. */
  t: number;
  /** Баланс монет. */
  b: number;
  /** Победы, поражения и выигранные монеты в партиях. */
  w: number;
  l: number;
  c: number;
  /** Бонусные броски сверх запаса (за друзей). */
  a: number;
  /** Сколько у игрока перебросов и можно ли применить один к последнему броску (1 или 0). */
  m: number;
  u: number;
  /** Кубики последнего броска. */
  d?: WidgetDice;
  /** Строка про приз недели. */
  p?: string;
}

/**
 * Ответ бота на запрос броска («r») или переброса кубика («m0»–«m2») — то, что получает
 * виджет из TelegramWidget.request(). У переброса c — сколько монет он добавил.
 * Имена короткие по той же причине, что и у WidgetState: лимит 1 КБ.
 */
export type WidgetRollAnswer =
  | {
      d: WidgetDice;
      o: WidgetRollOutcome;
      /** Сколько монет принёс бросок. */
      c: number;
      /** Запас бросков, время следующего и баланс после броска. */
      r: number;
      n: number;
      b: number;
      /** Бонусные броски, перебросы и можно ли применить переброс — как в WidgetState. */
      a: number;
      m: number;
      u: number;
      /** Фраза под кубиками целиком: событие, монеты и что выпало сверх них. Текст в виджете стоит байтов лимита. */
      x: string;
    }
  | { e: 'NO_ROLLS' | 'NO_MOD' };

export function measureWidget(html: string): { bytes: number; packed: number } {
  const raw = Buffer.from(html, 'utf8');
  return { bytes: raw.length, packed: deflateSync(raw, { level: 9 }).length };
}

/** Убрать из исходника комментарии и отступы: они нужны читателю кода, а не Telegram. */
function strip(source: string): string {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
    .join('\n');
}

function assertLink(url: string | null): void {
  if (url !== null && (!url.startsWith('https://t.me/') || url.length > 256)) {
    throw new Error(`Ссылка виджета должна начинаться с https://t.me/ и быть не длиннее 256 символов: ${url}`);
  }
}

/**
 * Собрать HTML виджета для игрока с его скинами и на его языке. Заменить HTML у уже
 * отправленного виджета Telegram не даёт, поэтому при смене скина бот присылает новый виджет.
 */
export function buildWidgetHtml(skins: WidgetSkins, links: WidgetLinks, lang: BotLang = 'ru'): string {
  assertValidMat(skins.mat);
  [links.invite, links.ad, links.findGame].forEach(assertLink);

  const shades = diceShades(skins.dice);
  const cup = PLAYER_COLOR_HEX[skins.cup];
  const config = {
    p: skins.mat.palette,
    m: skins.mat.pixels,
    d: [shades.outline, skins.dice.face, shades.light, shades.shade, skins.dice.pips, shades.pipLight],
    c: [cup.light, cup.main, cup.shade, 'rgba(0,0,0,.67)'],
    u: { i: links.invite, a: links.ad, f: links.findGame },
  };
  // «</» внутри <script> закрыло бы тег, поэтому экранируем косую черту.
  const json = JSON.stringify(config).replaceAll('</', '<\\/');
  const ui = WIDGET_UI[lang];
  const html = strip(WIDGET_SOURCE)
    .replace(/@(\w+)@/g, (_, key: string) => ui[key as WidgetUiKey])
    .replace('__CFG__', () => json);

  const { bytes, packed } = measureWidget(html);
  if (bytes > WIDGET_MAX_BYTES || packed > WIDGET_MAX_PACKED - PACKED_MARGIN) {
    throw new Error(
      `Виджет не влезает в лимиты Telegram: ${bytes} байт (лимит ${WIDGET_MAX_BYTES}), ` +
        `${packed} байт после сжатия (лимит ${WIDGET_MAX_PACKED} с запасом ${PACKED_MARGIN})`,
    );
  }
  return html;
}

/** Состояние → строка chat_data. */
export function encodeWidgetState(state: WidgetState): string {
  const json = JSON.stringify(state);
  if (Buffer.byteLength(json, 'utf8') > STATE_MAX_BYTES) {
    throw new Error(`Состояние виджета больше ${STATE_MAX_BYTES} байт`);
  }
  return json;
}
