/** Цвета для пиксель-арта: перевод HSL ↔ #rrggbb и «рампы» оттенков со сдвигом тона. */

export function hsl(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = Math.min(Math.max(s, 0), 1);
  const lig = Math.min(Math.max(l, 0), 1);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lig - c / 2;
  return `#${[r, g, b]
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Сдвинуть тон h к target на amount градусов по короткой дуге круга. */
function towards(h: number, target: number, amount: number): number {
  const diff = ((target - h + 540) % 360) - 180;
  return h + Math.sign(diff) * Math.min(Math.abs(diff), amount);
}

/**
 * Рампа из count оттенков от тёмного к светлому. Приём пиксель-художников: тени уходят
 * в холодный синий, блики — в тёплый жёлтый, а насыщенность выше в середине. Так цвет
 * выглядит живым, а не «тот же цвет с чёрным и белым».
 */
export function ramp(h: number, s: number, l: number, count: number, spread = 0.36, hueShift = 18): string[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const lig = l + (t - 0.5) * spread;
    const hue = t < 0.5 ? towards(h, 245, hueShift * (0.5 - t) * 2) : towards(h, 55, hueShift * (t - 0.5) * 2);
    const sat = s * (1 - Math.abs(t - 0.5) * 0.5);
    return hsl(hue, sat, lig);
  });
}

/** Относительная яркость по WCAG: нужна, чтобы точки на кубике читались на грани. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Середина между двумя цветами #rrggbb. */
export function mix(a: string, b: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round((channel(a, i) + channel(b, i)) / 2)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Металлы для эпических рамок: тень, основа, блик. */
export const METALS = {
  gold: ['#6e3f0b', '#c4861c', '#ffd65c'],
  silver: ['#4a5266', '#9aa6bd', '#eef3ff'],
} as const;
