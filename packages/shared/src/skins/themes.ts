import { METALS, hsl, ramp } from './color.js';
import type { Rng } from './random.js';

export const SKIN_RARITIES = ['common', 'rare', 'epic'] as const;
export type SkinRarity = (typeof SKIN_RARITIES)[number];

/** Род существительного в названии: от него зависит окончание прилагательного. */
export type Gender = 'm' | 'f' | 'n' | 'pl';

/**
 * Тема — «материал» скина: основной тон, акцент и металл. Темы подобраны руками,
 * поэтому случайный скин не бывает грязно-коричневым с ядовито-зелёным: генератор
 * выбирает внутри заведомо красивого набора, а разнообразие дают узоры и детали.
 */
interface Theme {
  /** Прилагательное в мужском роде, ж., ср., мн. ч. */
  name: [string, string, string, string];
  hue: number;
  sat: number;
  /** Средняя яркость основного тона. */
  light: number;
  /** Акцент: свой тон; без него генератор подбирает гармоничный (соседний или противоположный). */
  accent?: { hue: number; sat: number; light: number };
  metal?: keyof typeof METALS;
}

/** Окончания: «лесн|ой» → лесная, лесное; «синий» и «космический» — свои. */
const adj = (stem: string, kind: 'ый' | 'ой' | 'ий' = 'ый'): Theme['name'] =>
  kind === 'ий'
    ? [`${stem}ий`, `${stem}ая`, `${stem}ое`, `${stem}ие`]
    : [`${stem}${kind}`, `${stem}ая`, `${stem}ое`, `${stem}ые`];

const THEMES: Record<SkinRarity, Theme[]> = {
  // Обычные: спокойные «столовые» цвета с невысокой насыщенностью.
  common: [
    { name: adj('Лесн', 'ой'), hue: 145, sat: 0.42, light: 0.36 },
    { name: adj('Винн'), hue: 350, sat: 0.45, light: 0.34 },
    { name: adj('Ночн', 'ой'), hue: 225, sat: 0.4, light: 0.3 },
    { name: adj('Графитов'), hue: 215, sat: 0.12, light: 0.34 },
    { name: adj('Песчан'), hue: 38, sat: 0.4, light: 0.6 },
    { name: adj('Орехов'), hue: 25, sat: 0.42, light: 0.38 },
    { name: adj('Мятн'), hue: 165, sat: 0.32, light: 0.56 },
    { name: adj('Сиренев'), hue: 270, sat: 0.3, light: 0.54 },
    { name: adj('Терракотов'), hue: 14, sat: 0.48, light: 0.45 },
    { name: adj('Морск', 'ой'), hue: 195, sat: 0.48, light: 0.36 },
    { name: adj('Горчичн'), hue: 46, sat: 0.55, light: 0.5 },
    { name: adj('Пудров'), hue: 345, sat: 0.35, light: 0.66 },
  ],
  // Редкие: драгоценные камни — насыщенно и с ярким акцентом.
  rare: [
    { name: adj('Изумрудн'), hue: 150, sat: 0.65, light: 0.36 },
    { name: adj('Сапфиров'), hue: 222, sat: 0.65, light: 0.38 },
    { name: adj('Рубинов'), hue: 352, sat: 0.66, light: 0.38 },
    { name: adj('Аметистов'), hue: 280, sat: 0.5, light: 0.38 },
    { name: adj('Янтарн'), hue: 34, sat: 0.75, light: 0.48 },
    { name: adj('Бирюзов'), hue: 176, sat: 0.6, light: 0.4 },
  ],
  // Эпические: тёмный фон со светящимся акцентом или металл.
  epic: [
    {
      name: adj('Неонов'),
      hue: 255,
      sat: 0.45,
      light: 0.14,
      accent: { hue: 300, sat: 1, light: 0.6 },
      metal: 'silver',
    },
    {
      name: adj('Золот', 'ой'),
      hue: 40,
      sat: 0.6,
      light: 0.36,
      accent: { hue: 48, sat: 0.95, light: 0.62 },
      metal: 'gold',
    },
    { name: adj('Лавов'), hue: 8, sat: 0.35, light: 0.12, accent: { hue: 22, sat: 1, light: 0.55 }, metal: 'gold' },
    {
      name: adj('Ледян', 'ой'),
      hue: 200,
      sat: 0.45,
      light: 0.74,
      accent: { hue: 190, sat: 0.9, light: 0.5 },
      metal: 'silver',
    },
    {
      name: adj('Космическ', 'ий'),
      hue: 250,
      sat: 0.5,
      light: 0.13,
      accent: { hue: 190, sat: 0.9, light: 0.62 },
      metal: 'silver',
    },
    {
      name: adj('Королевск', 'ий'),
      hue: 272,
      sat: 0.55,
      light: 0.27,
      accent: { hue: 45, sat: 0.9, light: 0.6 },
      metal: 'gold',
    },
  ],
};

/** Готовые цвета скина. Рампы идут от тёмного к светлому. */
export interface Palette {
  name: Theme['name'];
  /** Основной тон темы, градусы. */
  hue: number;
  base: string[];
  accent: string[];
  metal: readonly string[];
  outline: string;
  sparkle: string;
}

/**
 * Палитра скина. Редкий скин изредка берёт тему из обычных, эпический — из редких,
 * но рисуется по правилам своей редкости (акцент, металл), так что не путается с ними.
 */
export function pickPalette(
  rng: Rng,
  rarity: SkinRarity,
  baseCount = 5,
  accentCount = 4,
  /** Насколько осветлить основной тон: грани кубиков светлее коврика, иначе они сливаются. */
  lift = 0,
): Palette {
  const pool = rarity === 'common' ? 'common' : rng.chance(0.25) ? (rarity === 'epic' ? 'rare' : 'common') : rarity;
  const theme = rng.pick(THEMES[pool]);
  const hue = theme.hue + rng.range(-8, 8);
  const accent =
    theme.accent ??
    (rarity === 'common'
      ? // Обычный: соседний тон, едва отличимый, — узор «в тон».
        { hue: hue + rng.pick([-30, 30]), sat: theme.sat * 0.9, light: theme.light + (theme.light > 0.5 ? -0.2 : 0.2) }
      : // Редкий и выше: противоположный или треугольный тон — узор читается издалека.
        { hue: hue + rng.pick([180, 150, 210, 120]), sat: 0.75, light: theme.light > 0.5 ? 0.38 : 0.6 });
  const dark = theme.light < 0.2;
  const light = dark ? theme.light : Math.min(theme.light + lift, 0.8);
  return {
    name: theme.name,
    hue,
    base: ramp(hue, theme.sat, light, baseCount, dark ? 0.16 : 0.3),
    accent: ramp(accent.hue, accent.sat, accent.light, accentCount, 0.32),
    metal: METALS[theme.metal ?? (rng.chance(0.5) ? 'gold' : 'silver')],
    outline: hsl(hue + 10, 0.4, 0.07),
    sparkle: hsl(55, 0.9, 0.94),
  };
}
