import { deflateSync } from 'node:zlib';
import type { WidgetDice, WidgetRollOutcome } from '@gamedeck/shared';
import type { DiceSprite } from './dice.js';
import { assertValidMat, type CupSprite, type MatSkin } from './mat.js';
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
  /** Надетые кубики (diceFromSkin) или двухцветные (diceFromStyle). */
  dice: DiceSprite;
  /** Надетый стакан (cupFromSkin) или стандартный цвета игрока (defaultCup). */
  cup: CupSprite;
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
  /** Бонусные броски сверх запаса (за друзей). */
  a: number;
  /** Сколько у игрока перебросов и можно ли применить один к последнему броску (1 или 0). */
  m: number;
  u: number;
  /**
   * Что делает переброс и как им пользоваться, а если сейчас его применить нельзя — почему.
   * Виджет показывает это, когда игрок нажал «Переброс». Текст присылает сервер на языке игрока:
   * в HTML виджета на него нет байтов.
   */
  h?: string;
  /** Кубики последнего броска. */
  d?: WidgetDice;
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
      /**
       * Окно приза, когда выпало что-то сверх монет (скин или модификатор): заголовок и описание
       * через перевод строки. l — ссылка «Подробнее» в Mini App; без неё в окне только «Закрыть».
       */
      z?: string;
      l?: string;
    }
  | { e: 'NO_ROLLS' | 'NO_MOD'; x?: string };

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

/** Ссылку из виджета открывает openTelegramLink: только https://t.me/… и не длиннее 256 символов. */
export function isWidgetLink(url: string): boolean {
  return url.startsWith('https://t.me/') && url.length <= 256;
}

/**
 * Собрать HTML виджета для игрока с его скинами и на его языке. Заменить HTML у уже
 * отправленного виджета Telegram не даёт, поэтому при смене скина бот присылает новый виджет.
 */
export function buildWidgetHtml(skins: WidgetSkins, lang: BotLang = 'ru'): string {
  assertValidMat(skins.mat);

  const config = {
    m: { p: skins.mat.palette, s: skins.mat.pixels },
    k: { p: skins.cup.palette, s: skins.cup.pixels },
    d: { p: skins.dice.face.palette, s: skins.dice.face.pixels },
    e: { p: skins.dice.pip.palette, s: skins.dice.pip.pixels },
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
