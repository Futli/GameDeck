/**
 * Пиксельная картинка скина: палитра до 16 цветов и номер цвета на каждый пиксель.
 * Тот же формат уходит в виджет «Кубик удачи» строкой RLE (см. encodeImage),
 * поэтому Mini App и виджет рисуют скин из одного источника.
 */
export interface PixelImage {
  width: number;
  height: number;
  /** #rrggbb, '' — прозрачный, PLAYER_SLOT — цвет игрока, его подставляет стол. */
  palette: string[];
  /** Номер цвета в palette для каждого пикселя, построчно. */
  pixels: Uint8Array;
}

/** Цвет игрока на скине: строчка на стакане и нитка на коврике, чтобы за столом не путать игроков. */
export const PLAYER_SLOT = 'player';
export const MAX_PALETTE = 16;

export function createImage(width: number, height: number, palette: string[]): PixelImage {
  if (palette.length > MAX_PALETTE) throw new Error(`Палитра больше ${MAX_PALETTE} цветов`);
  return { width, height, palette, pixels: new Uint8Array(width * height) };
}

export function setPixel(image: PixelImage, x: number, y: number, color: number): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  image.pixels[y * image.width + x] = color;
}

export function getPixel(image: PixelImage, x: number, y: number): number {
  return image.pixels[y * image.width + x] ?? 0;
}

/** Палитра с подставленным цветом игрока: то, что реально рисуется на экране. */
export function resolvePalette(image: PixelImage, playerColor: string): string[] {
  return image.palette.map((c) => (c === PLAYER_SLOT ? playerColor : c));
}

/** Повернуть на 90° по часовой: коврик на боковом месте стоит вдоль края стола (96×128). */
export function rotate(image: PixelImage): PixelImage {
  const out = createImage(image.height, image.width, image.palette);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) setPixel(out, image.height - 1 - y, x, getPixel(image, x, y));
  return out;
}

const RUN_CHARS = 'abcdefghijklmnop';

/**
 * Компактная строка для виджета: «ширина:высота:палитра:пиксели». Палитра — цвета без #
 * через запятую, пиксели — серии «буква цвета + длина», длина опускается, если она 1.
 * Например, «a12b3c» — 12 пикселей цвета 0, 3 цвета 1 и один цвета 2.
 */
export function encodeImage(image: PixelImage): string {
  let runs = '';
  for (let i = 0; i < image.pixels.length;) {
    const color = image.pixels[i]!;
    let length = 1;
    while (image.pixels[i + length] === color) length++;
    runs += RUN_CHARS[color]! + (length > 1 ? length : '');
    i += length;
  }
  const palette = image.palette.map((c) => c.replace('#', '')).join(',');
  return `${image.width}:${image.height}:${palette}:${runs}`;
}

export function decodeImage(encoded: string): PixelImage {
  const [w, h, palette, runs] = encoded.split(':');
  const image = createImage(
    Number(w),
    Number(h),
    palette!.split(',').map((c) => (c && c !== PLAYER_SLOT ? `#${c}` : c)),
  );
  let offset = 0;
  for (const [, color, length] of runs!.matchAll(/([a-p])(\d*)/g)) {
    const count = length ? Number(length) : 1;
    image.pixels.fill(RUN_CHARS.indexOf(color!), offset, offset + count);
    offset += count;
  }
  return image;
}
