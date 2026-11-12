import { describe, expect, it } from 'vitest';
import {
  CUP_HEIGHT,
  CUP_WIDTH,
  DIE_SIZE,
  MAT_HEIGHT,
  MAT_WIDTH,
  SKIN_KINDS,
  SKIN_RARITIES,
  decodeImage,
  encodeImage,
  generateSkin,
  rotate,
} from '../src/index.js';
import { contrast } from '../src/skins/color.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 2654435 + 17);
const all = SKIN_KINDS.flatMap((kind) =>
  SKIN_RARITIES.flatMap((rarity) => SEEDS.map((seed) => ({ kind, rarity, seed }))),
);

describe('генератор скинов', () => {
  it('один seed — один и тот же скин: сервер, Mini App и виджет видят одинаковое', () => {
    for (const ref of all.slice(0, 60)) {
      const a = generateSkin(ref);
      const b = generateSkin(ref);
      expect(b.name).toBe(a.name);
      expect(encodeImage(b.render(3))).toBe(encodeImage(a.render(3)));
    }
  });

  it('разные seed дают разные картинки', () => {
    for (const kind of SKIN_KINDS) {
      const images = new Set(SEEDS.map((seed) => encodeImage(generateSkin({ kind, seed, rarity: 'rare' }).render(6))));
      expect(images.size).toBe(SEEDS.length);
    }
  });

  it('размеры по видам и палитра не больше 16 цветов (формат виджета)', () => {
    const size = { mat: [MAT_WIDTH, MAT_HEIGHT], dice: [DIE_SIZE, DIE_SIZE], cup: [CUP_WIDTH, CUP_HEIGHT] };
    for (const ref of all) {
      const image = generateSkin(ref).render(1);
      expect([image.width, image.height]).toEqual(size[ref.kind]);
      expect(image.palette.length).toBeLessThanOrEqual(16);
      expect(Math.max(...image.pixels)).toBeLessThan(image.palette.length);
    }
  });

  it('у каждого скина есть название по-русски', () => {
    for (const ref of all) expect(generateSkin(ref).name).toMatch(/^[А-ЯЁ][а-яё]+ .+/);
  });

  it('точки на кубике читаются на грани', () => {
    for (const ref of all.filter((r) => r.kind === 'dice' && r.rarity === 'common')) {
      const image = generateSkin(ref).render(5);
      const at = (x: number, y: number) => image.palette[image.pixels[y * DIE_SIZE + x]!]!;
      // Центр точки и грань между точками.
      expect(contrast(at(10, 10), at(7, 12))).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('строка для виджета разворачивается обратно без потерь', () => {
    for (const ref of all.slice(0, 30)) {
      const image = generateSkin(ref).render(2);
      expect(decodeImage(encodeImage(image))).toEqual(image);
    }
  });

  it('поворот коврика на боковое место: 96×128, углы переходят по часовой', () => {
    const image = generateSkin({ kind: 'mat', seed: 7, rarity: 'epic' }).render();
    const turned = rotate(image);
    expect([turned.width, turned.height]).toEqual([MAT_HEIGHT, MAT_WIDTH]);
    // Левый верхний угол оригинала — правый верхний после поворота.
    expect(turned.pixels[MAT_HEIGHT - 1]).toBe(image.pixels[0]);
  });
});
