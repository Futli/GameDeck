/**
 * Детерминированная случайность для генератора скинов. Один и тот же seed на сервере,
 * в Mini App и в виджете даёт один и тот же скин, поэтому в базе хранится только число.
 */

/** Генератор mulberry32: быстрый, 32-битный, одинаковый во всех движках JS. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Целое 0..n-1. */
    int: (n: number) => Math.floor(next() * n),
    /** Число в диапазоне [min, max). */
    range: (min: number, max: number) => min + next() * (max - min),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
}

export type Rng = ReturnType<typeof createRng>;

/** Хэш точки решётки в [0, 1): основа шума, не зависит от порядка обхода пикселей. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Плавный «облачный» шум 0..1 с размером ячейки cell пикселей. */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const top = hash2(x0, y0, seed) * (1 - tx) + hash2(x0 + 1, y0, seed) * tx;
  const bottom = hash2(x0, y0 + 1, seed) * (1 - tx) + hash2(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Две октавы шума: крупные пятна плюс мелкая рябь. */
export function fbm(x: number, y: number, cell: number, seed: number): number {
  return valueNoise(x, y, cell, seed) * 0.65 + valueNoise(x, y, cell / 2, seed + 1) * 0.35;
}

/** Случайное, но воспроизводимое значение для конкретного пикселя. */
export const pixelNoise = hash2;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Порог упорядоченного дизеринга 4×4 (матрица Байера). Переходы между тонами получаются
 * регулярной «сеточкой», как в старых играх, а не шумом: так и красивее, и сжимается лучше.
 */
export const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

/** Непрерывное значение 0..1 → номер тона 0..count-1 с дизерингом между соседними тонами. */
export function ditherTone(value: number, count: number, x: number, y: number): number {
  const scaled = Math.min(Math.max(value, 0), 1) * (count - 1);
  const base = Math.floor(scaled);
  return Math.min(count - 1, base + (scaled - base > bayer(x, y) ? 1 : 0));
}
