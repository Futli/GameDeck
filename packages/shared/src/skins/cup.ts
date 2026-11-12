import { PLAYER_SLOT, createImage, setPixel, type PixelImage } from './image.js';
import { ditherTone, fbm, type Rng } from './random.js';
import { pickPalette, type SkinRarity } from './themes.js';

/** Стакан 16×18, перевёрнутый вверх дном, как компонент Cup: сверху узкое дно, снизу край. */
export const CUP_WIDTH = 16;
export const CUP_HEIGHT = 18;

// Номера цветов в палитре стакана.
const BODY = (tone: number) => 1 + tone; // 0..3
const ACCENT = (tone: number) => 5 + tone; // 0..2
const OUTLINE = 8;
const SPARKLE = 9;
const METAL = (tone: number) => 10 + tone; // 0..2
const PLAYER = 13;

/** Ширина тела по строкам: [первый x, последний x] включительно; строка 17 — только контур. */
function bodySpan(y: number): [number, number] | null {
  if (y >= 1 && y <= 4) return [4, 11];
  if (y >= 5 && y <= 12) return [3, 12];
  if (y >= 13 && y <= 16) return [2, 13];
  return null;
}

type Decor = 'plain' | 'bands' | 'vstripes' | 'dots' | 'zigzag' | 'leather' | 'checker' | 'royal';
const DECOR: Record<SkinRarity, Decor[]> = {
  common: ['plain', 'leather', 'bands', 'vstripes'],
  rare: ['bands', 'dots', 'zigzag', 'checker', 'vstripes'],
  epic: ['royal', 'zigzag', 'dots'],
};
const DECOR_SUFFIX: Record<Decor, string> = {
  plain: '',
  leather: ' из кожи',
  bands: ' с поясками',
  vstripes: ' в полоску',
  dots: ' в горошек',
  zigzag: ' с зигзагом',
  checker: ' в клетку',
  royal: ' с гербом',
};

export interface CupSkin {
  image: PixelImage;
  adjectives: [string, string, string, string];
  suffix: string;
}

/**
 * Стакан: тело с узором, блик слева и тень справа, ободок у края — цвета игрока,
 * чтобы в перудо было видно, чей стакан, при любом скине.
 */
export function generateCup(rng: Rng, seed: number, rarity: SkinRarity): CupSkin {
  const palette = pickPalette(rng, rarity, 4, 3);
  const image = createImage(CUP_WIDTH, CUP_HEIGHT, [
    '',
    ...palette.base,
    ...palette.accent,
    palette.outline,
    palette.sparkle,
    ...palette.metal,
    PLAYER_SLOT,
  ]);
  const decor = rng.pick(DECOR[rarity]);
  const bandRows = rng.pick([
    [3, 9],
    [6, 10],
    [4, 8, 12],
  ]);
  const trim = rarity === 'epic' ? METAL(1) : ACCENT(1);

  const pattern = (x: number, y: number): number => {
    switch (decor) {
      case 'plain':
        return BODY(2);
      case 'leather':
        return BODY(1 + ditherTone(fbm(x, y, 4, seed), 2, x, y));
      case 'bands':
        return bandRows.includes(y) ? trim : BODY(2);
      case 'vstripes':
        return x % 3 === 0 ? BODY(1) : BODY(2);
      case 'dots':
        return (x + (Math.floor(y / 3) % 2) * 2) % 4 === 0 && y % 3 === 1 ? ACCENT(2) : BODY(2);
      case 'zigzag': {
        const z = 8 + Math.abs((x % 4) - 2);
        return y === z ? trim : y === z + 1 ? ACCENT(0) : BODY(2);
      }
      case 'checker':
        return (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? BODY(2) : ACCENT(0);
      case 'royal':
        return y === 4 || y === 12 ? METAL(1) : BODY(2);
    }
  };

  for (let y = 0; y < CUP_HEIGHT; y++) {
    const span = bodySpan(y);
    // Контур: пиксель вокруг тела, сверху — по дну, снизу — строка 17.
    const outer = span ?? (y === 0 ? [5, 10] : y === 17 ? [2, 13] : null);
    if (!outer) continue;
    setPixel(image, outer[0] - 1, y, OUTLINE);
    setPixel(image, outer[1] + 1, y, OUTLINE);
    if (!span) {
      for (let x = outer[0] - 1; x <= outer[1] + 1; x++) setPixel(image, x, y, OUTLINE);
      continue;
    }
    for (let x = span[0]; x <= span[1]; x++) {
      let color = pattern(x, y);
      // Ободок у края — цвет игрока с тенью под ним.
      if (y === 15) color = PLAYER;
      else if (y === 16) color = BODY(0);
      // Объём: две колонки блика слева, тень по правому краю.
      else if (x === span[0]) color = color === BODY(2) ? BODY(3) : color;
      else if (x === span[1]) color = color === BODY(2) || color === BODY(1) ? BODY(0) : color;
      setPixel(image, x, y, color);
    }
  }

  // Эпический: герб-камень посередине и искра на блике.
  if (rarity === 'epic') {
    for (const [x, y, c] of [
      [7, 7, ACCENT(2)],
      [8, 7, ACCENT(1)],
      [6, 8, ACCENT(2)],
      [7, 8, ACCENT(1)],
      [8, 8, ACCENT(1)],
      [9, 8, ACCENT(0)],
      [7, 9, ACCENT(1)],
      [8, 9, ACCENT(0)],
      [7, 6, METAL(2)],
      [8, 6, METAL(1)],
      [6, 7, METAL(2)],
      [9, 7, METAL(1)],
      [5, 8, METAL(1)],
      [10, 8, METAL(0)],
      [6, 9, METAL(1)],
      [9, 9, METAL(0)],
      [7, 10, METAL(0)],
      [8, 10, METAL(0)],
    ] as const)
      setPixel(image, x, y, c);
    setPixel(image, 4, 2, SPARKLE);
  }
  return { image, adjectives: palette.name, suffix: DECOR_SUFFIX[decor] };
}
