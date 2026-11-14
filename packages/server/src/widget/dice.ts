/**
 * Кубики в виджете — пиксельные картинки, как коврик и стакан: пустая грань 21×21
 * и точка 5×5. Виджет рисует грань и ставит точку в нужные ячейки сетки 3×3, поэтому
 * шесть граней стоят одной картинки. Сгенерированный скин кубиков попадает в виджет
 * пиксель в пиксель, а старый двухцветный стиль (DiceStyle) собирается из тех же
 * прямоугольников, которыми виджет раньше рисовал кубик сам.
 */
import { diceShades, DIE_SIZE, generateSkin, resolvePalette, type DiceStyle, type SkinSeed } from '@gamedeck/shared';
import type { MatSkin } from './mat.js';

export const PIP_SPRITE = 5;
/** Точка с центром в ячейке (5, 5) грани: левый верхний угол её картинки 5×5. */
const PIP_ORIGIN = 3;
const TRANSPARENT = '#0000';

export interface DiceSprite {
  /** Пустая грань 21×21 без точек. Пиксель — номер цвета в палитре (hex), 0 — прозрачный угол. */
  face: MatSkin;
  /** Одна точка 5×5 в той же палитре, прозрачные пиксели не закрывают грань. */
  pip: MatSkin;
}

const toHex = (cells: ArrayLike<number>) => Array.from(cells, (c) => c.toString(16)).join('');

/** Скин кубиков игрока (генератор из @gamedeck/shared) → картинки для виджета. */
export function diceFromSkin(skin: SkinSeed): DiceSprite {
  const generated = generateSkin({ ...skin, kind: 'dice' });
  const blank = generated.render(0);
  // Точку берём с четвёрки: у эпических единица — особый крупный камень, а точки в углах обычные.
  const four = generated.render(4);
  const palette = resolvePalette(blank, '#000000').map((color) => color || TRANSPARENT);
  const pip: number[] = [];
  for (let y = 0; y < PIP_SPRITE; y++)
    for (let x = 0; x < PIP_SPRITE; x++) {
      const i = (PIP_ORIGIN + y) * DIE_SIZE + PIP_ORIGIN + x;
      pip.push(four.pixels[i] === blank.pixels[i] ? 0 : four.pixels[i]!);
    }
  return { face: { palette, pixels: toHex(blank.pixels) }, pip: { palette, pixels: toHex(pip) } };
}

/**
 * Двухцветный кубик (стандартный или из старого каталога) → картинки для виджета.
 * Цвета: 0 прозрачный, 1 обводка, 2 грань, 3 блик, 4 тень, 5 точка, 6 блик точки.
 */
export function diceFromStyle(style: DiceStyle): DiceSprite {
  const shades = diceShades(style);
  const palette = [TRANSPARENT, shades.outline, style.face, shades.light, shades.shade, style.pips, shades.pipLight];
  const face = new Array<number>(DIE_SIZE * DIE_SIZE).fill(0);
  const rects: Array<[number, number, number, number, number]> = [
    [1, 1, 0, 19, 21],
    [1, 0, 1, 21, 19],
    [2, 2, 1, 17, 19],
    [2, 1, 2, 19, 17],
    [3, 2, 1, 16, 1],
    [3, 1, 2, 1, 16],
    [4, 3, 19, 16, 1],
    [4, 19, 3, 1, 16],
  ];
  for (const [color, x0, y0, w, h] of rects)
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) face[y * DIE_SIZE + x] = color;
  const pip = new Array<number>(PIP_SPRITE * PIP_SPRITE).fill(0);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) pip[y * PIP_SPRITE + x] = 5;
  pip[PIP_SPRITE + 1] = 6;
  return { face: { palette, pixels: toHex(face) }, pip: { palette, pixels: toHex(pip) } };
}

/**
 * Два цвета сгенерированного скина — самый частый цвет грани и самый частый цвет точки —
 * для запасного виджета, когда картинка кубиков не влезает в 4 КБ вместе с пёстрыми
 * ковриком и стаканом. Текстура и форма точек теряются, цвет остаётся.
 */
export function flatDiceStyle(skin: SkinSeed): DiceStyle {
  const { face, pip } = diceFromSkin(skin);
  const commonest = (sprite: MatSkin, from: number) => {
    const counts = new Map<string, number>();
    for (const c of sprite.pixels.slice(from)) if (c !== '0') counts.set(c, (counts.get(c) ?? 0) + 1);
    const [best] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    return face.palette[parseInt(best, 16)]!;
  };
  // Грань считаем без верхних рядов фаски и обводки: ряд 2 и ниже.
  return { face: commonest(face, DIE_SIZE * 2), pips: commonest(pip, 0) };
}
