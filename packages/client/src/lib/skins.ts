import { generateSkin, resolvePalette, rotate, type PixelImage, type SkinSeed } from '@gamedeck/shared';

/**
 * Картинки скинов для стола. Генератор отдаёт пиксели и палитру, здесь они превращаются
 * в data:-URL через canvas. Результат кэшируется: стол перерисовывается часто,
 * а скин за партию не меняется.
 */
const cache = new Map<string, string>();

function toDataUrl(image: PixelImage, playerColor: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(image.width, image.height);
  const palette = resolvePalette(image, playerColor).map((hex) =>
    hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null,
  );
  image.pixels.forEach((color, i) => {
    const rgb = palette[color];
    if (!rgb) return; // прозрачный пиксель
    data.data.set([...rgb, 255], i * 4);
  });
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL();
}

interface Options {
  /** Грань кубика 1..6. */
  value?: number;
  /** Цвет игрока для нитки на коврике и ободка стакана. */
  playerColor: string;
  /** Повернуть на 90°: коврик на боковом месте стола. */
  rotated?: boolean;
}

export function skinImageUrl(skin: SkinSeed, { value, playerColor, rotated = false }: Options): string {
  const key = `${skin.kind}:${skin.seed}:${skin.rarity}:${value ?? ''}:${playerColor}:${rotated}`;
  let url = cache.get(key);
  if (!url) {
    const image = generateSkin(skin).render(value);
    url = toDataUrl(rotated ? rotate(image) : image, playerColor);
    cache.set(key, url);
  }
  return url;
}
