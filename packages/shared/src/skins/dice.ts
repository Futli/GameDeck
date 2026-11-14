import { DICE_PIP_LAYOUT } from '../dice-style.js';
import { contrast, hsl, mix } from './color.js';
import { createImage, setPixel, type PixelImage } from './image.js';
import { ditherTone, fbm, pixelNoise, type Rng } from './random.js';
import { pickPalette, type SkinRarity } from './themes.js';

/** Сетка кубика 21×21, как у компонента Die: точки 3×3 в пикселях 5, 10 и 15. */
export const DIE_SIZE = 21;
const PIP_CENTERS = [5, 10, 15] as const;

// Номера цветов в палитре кубика.
const FACE = (tone: number) => 1 + tone; // грань 0..3
const PIP = 5;
const PIP_LIGHT = 6;
const OUTLINE = 7;
const SPARKLE = 8;
const PIP_SOFT = 14; // полутон между точкой и гранью
const ACCENT = (tone: number) => 9 + tone; // 0..1
const METAL = (tone: number) => 11 + tone; // 0..2

type Texture = 'plain' | 'speckle' | 'marble' | 'split' | 'stripes' | 'gradient' | 'stars' | 'facets';
const TEXTURES: Record<SkinRarity, Texture[]> = {
  common: ['plain', 'plain', 'speckle', 'gradient'],
  rare: ['speckle', 'marble', 'split', 'stripes', 'gradient'],
  epic: ['marble', 'stars', 'facets', 'split'],
};
/** Текстура в названии и признаках скина: «Ruby Marble Dice». У гладкой грани стиля в названии нет. */
const TEXTURE_STYLE: Record<Texture, string> = {
  plain: 'Plain',
  speckle: 'Speckled',
  marble: 'Marble',
  split: 'Yin-Yang',
  stripes: 'Striped',
  gradient: 'Gradient',
  stars: 'Starry',
  facets: 'Faceted',
};

type PipShape = 'square' | 'round' | 'ring' | 'gem';
const PIP_SHAPES: Record<SkinRarity, PipShape[]> = {
  common: ['square', 'round'],
  rare: ['round', 'ring', 'square'],
  epic: ['gem', 'round'],
};

export interface DiceSkin {
  /** Грань с нужным числом точек. Параметры скина уже выбраны, рисование детерминировано. */
  face: (value: number) => PixelImage;
  color: string;
  style: string;
  /** Форма точек: Square, Round, Ring, Gem. */
  pips: string;
  /** Точки цветом акцента, а не в тон грани. */
  accentPips: boolean;
  /** Металлическая кромка эпических кубиков: Gold или Silver; null — без кромки. */
  edge: string | null;
}

/** Точки должны читаться на грани: если контраст слабый, уводим их в тёмное или светлое. */
function readablePips(face: string, hue: number, sat: number): [string, string] {
  const dark = contrast(face, '#000000') > contrast(face, '#ffffff');
  for (let step = 0; step <= 6; step++) {
    const l = dark ? 0.32 - step * 0.05 : 0.7 + step * 0.05;
    const pip = hsl(hue, sat, l);
    if (contrast(face, pip) >= 3.2 || step === 6) return [pip, hsl(hue, sat * 0.8, Math.min(l + 0.18, 0.97))];
  }
  return ['#000000', '#444444'];
}

export function generateDice(rng: Rng, seed: number, rarity: SkinRarity): DiceSkin {
  const palette = pickPalette(rng, rarity, 4, 2, 0.24);
  const face = palette.base;
  const texture = rng.pick(TEXTURES[rarity]);
  const shape = rng.pick(PIP_SHAPES[rarity]);
  const accentPips = rarity !== 'common' && rng.chance(0.5);
  const pipBase = accentPips ? palette.accent[1]! : face[2]!;
  const [pip, pipLight] =
    accentPips && contrast(face[2]!, pipBase) >= 3.2
      ? [pipBase, palette.accent[1]!]
      : readablePips(face[2]!, palette.hue, rarity === 'common' ? 0.3 : 0.6);
  const metalEdge = rarity === 'epic';
  const stripeStep = rng.pick([3, 4]);
  const splitDir = rng.pick([1, -1]);

  const colors = [
    '',
    ...face,
    pip,
    pipLight,
    palette.outline,
    palette.sparkle,
    ...palette.accent,
    ...palette.metal,
    mix(pip, face[2]!),
  ];

  const faceTone = (x: number, y: number): number => {
    // Базовый свет: слева сверху светлее, справа снизу темнее.
    const light = 1 - (x + y) / (DIE_SIZE * 2);
    switch (texture) {
      case 'plain':
        return FACE(2);
      case 'gradient':
        return FACE(1 + ditherTone(light, 3, x, y));
      case 'speckle':
        return pixelNoise(x, y, seed) > 0.95 ? (rarity === 'common' ? FACE(1) : ACCENT(1)) : FACE(2);
      case 'marble': {
        const v = Math.abs(Math.sin((x + y) * 0.35 + fbm(x, y, 6, seed) * 6));
        return v < 0.12 ? ACCENT(1) : v < 0.3 ? FACE(1) : FACE(2);
      }
      case 'split':
        return (splitDir > 0 ? x + y : x - y + DIE_SIZE) < DIE_SIZE ? FACE(3) : FACE(1);
      case 'stripes':
        return Math.floor((x + y) / stripeStep) % 2 ? FACE(2) : FACE(1);
      case 'stars':
        return pixelNoise(x, y, seed) > 0.97 ? SPARKLE : FACE(ditherTone(light * 0.7, 3, x, y));
      case 'facets': {
        // Огранка: концентрические «ромбы» тонов, как у камня.
        const d = Math.abs(x - 10) + Math.abs(y - 10);
        return FACE(3 - Math.min(3, Math.floor(d / 4)));
      }
    }
  };

  const drawPip = (image: PixelImage, cx: number, cy: number) => {
    // Эпическая точка — камень в оправе: тёмный контур отделяет её от пёстрой грани.
    if (shape === 'gem')
      for (let i = -1; i <= 1; i++)
        for (const [x, y] of [
          [cx + i, cy - 2],
          [cx + i, cy + 2],
          [cx - 2, cy + i],
          [cx + 2, cy + i],
        ] as const)
          setPixel(image, x, y, OUTLINE);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const corner = dx !== 0 && dy !== 0;
        // Круглая точка: углы квадрата — полутон, на мелкой сетке это читается как круг.
        if (shape === 'round' && corner) {
          setPixel(image, cx + dx, cy + dy, PIP_SOFT);
          continue;
        }
        if (shape === 'ring' && dx === 0 && dy === 0) continue;
        let color = PIP;
        if (shape === 'gem')
          color = dx + dy === -2 ? SPARKLE : dx + dy === 2 ? PIP_SOFT : dx + dy < 0 ? PIP_LIGHT : PIP;
        setPixel(image, cx + dx, cy + dy, color);
      }
    if (shape === 'square' || shape === 'ring') setPixel(image, cx - 1, cy - 1, PIP_LIGHT);
    if (shape === 'round') setPixel(image, cx, cy - 1, PIP_LIGHT);
  };

  const render = (value: number): PixelImage => {
    const image = createImage(DIE_SIZE, DIE_SIZE, colors);
    const last = DIE_SIZE - 1;
    for (let y = 0; y < DIE_SIZE; y++)
      for (let x = 0; x < DIE_SIZE; x++) {
        // Срезанные углы: в самих углах пусто, рядом — контур.
        const corner = (x === 0 || x === last) && (y === 0 || y === last);
        if (corner) continue;
        const edge = x === 0 || y === 0 || x === last || y === last;
        const innerCorner = (x === 1 || x === last - 1) && (y === 1 || y === last - 1);
        if (edge || innerCorner) {
          setPixel(image, x, y, metalEdge ? (x + y < DIE_SIZE ? METAL(2) : METAL(0)) : OUTLINE);
          continue;
        }
        let color = faceTone(x, y);
        // Фаска: блик по верхнему и левому краю, тень по нижнему и правому.
        if (y === 1 || x === 1) color = metalEdge ? METAL(1) : FACE(3);
        else if (y === last - 1 || x === last - 1) color = metalEdge ? METAL(0) : FACE(0);
        setPixel(image, x, y, color);
      }
    if (metalEdge) {
      for (const [x, y] of [
        [1, 1],
        [last - 1, 1],
        [1, last - 1],
        [last - 1, last - 1],
      ] as const)
        setPixel(image, x, y, OUTLINE);
    }
    for (const [col, row] of DICE_PIP_LAYOUT[value] ?? []) drawPip(image, PIP_CENTERS[col]!, PIP_CENTERS[row]!);
    // Эпическая «единица» — крупный камень с искрой.
    if (rarity === 'epic' && value === 1) {
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (Math.abs(dx) + Math.abs(dy) <= 2)
            setPixel(image, 10 + dx, 10 + dy, dx + dy < 0 ? PIP_LIGHT : dx + dy > 1 ? OUTLINE : PIP);
      setPixel(image, 9, 9, SPARKLE);
    }
    return image;
  };

  return {
    face: render,
    color: palette.name,
    style: TEXTURE_STYLE[texture],
    pips: { square: 'Square', round: 'Round', ring: 'Ring', gem: 'Gem' }[shape],
    accentPips: pip === pipBase && accentPips,
    edge: metalEdge ? (palette.metalName === 'gold' ? 'Gold' : 'Silver') : null,
  };
}
