/**
 * Внешний вид кубика: цвет грани и цвет точек. Из них же клиент
 * вычисляет блик, тень и обводку, поэтому скин задаётся всего двумя цветами.
 */
export interface DiceStyle {
  /** Цвет грани, #rrggbb. */
  face: string;
  /** Цвет точек, #rrggbb. */
  pips: string;
}

export const DEFAULT_DICE_STYLE: DiceStyle = { face: '#fbf8ef', pips: '#1a1a1a' };

/**
 * Схема точек: ячейки сетки 3×3 (колонка, ряд), как на настоящем кубике.
 * Каждая раскладка симметрична относительно центра грани.
 *
 *   (0,0) (1,0) (2,0)
 *   (0,1) (1,1) (2,1)
 *   (0,2) (1,2) (2,2)
 */
export const DICE_PIP_LAYOUT: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
};

/** Смешать два цвета #rrggbb: t = 0 — первый, t = 1 — второй. */
function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Оттенки, которые рисующий кубик вычисляет из двух цветов скина: свет падает слева сверху. */
export function diceShades(style: DiceStyle) {
  return {
    outline: mix(style.face, '#000000', 0.55),
    shade: mix(style.face, '#000000', 0.22),
    light: mix(style.face, '#ffffff', 0.45),
    pipLight: mix(style.pips, '#ffffff', 0.25),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Разобрать стиль кубика из JSON (поле asset у скина в каталоге). Мусор — стиль по умолчанию. */
export function parseDiceStyle(json: string | null | undefined): DiceStyle {
  try {
    const value = JSON.parse(json ?? '') as Partial<DiceStyle>;
    if (HEX.test(value.face ?? '') && HEX.test(value.pips ?? '')) return { face: value.face!, pips: value.pips! };
  } catch {
    // не JSON — например, старый путь к картинке
  }
  return DEFAULT_DICE_STYLE;
}
