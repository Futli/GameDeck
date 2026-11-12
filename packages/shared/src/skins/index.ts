import { generateCup } from './cup.js';
import { generateDice } from './dice.js';
import type { PixelImage } from './image.js';
import { generateMat } from './mat.js';
import { createRng } from './random.js';
import { SKIN_RARITIES, type Gender, type SkinRarity } from './themes.js';

export { CUP_HEIGHT, CUP_WIDTH } from './cup.js';
export { DIE_SIZE } from './dice.js';
export { MAT_HEIGHT, MAT_WIDTH } from './mat.js';
export { PLAYER_SLOT, decodeImage, encodeImage, resolvePalette, rotate, type PixelImage } from './image.js';
export { SKIN_RARITIES, type SkinRarity };

export const SKIN_KINDS = ['mat', 'dice', 'cup'] as const;
export type SkinKind = (typeof SKIN_KINDS)[number];

/**
 * Версия генератора. Скин в базе — это (вид, seed, редкость, версия). Если поменять
 * генератор так, что старые seed нарисуются иначе, у игроков «перекрасятся» вещи,
 * поэтому такая правка повышает версию и сохраняет старую ветку кода.
 */
export const SKIN_GENERATOR_VERSION = 1;

/** Всё, что нужно, чтобы нарисовать скин где угодно: сервер шлёт только это. */
export interface SkinSeed {
  kind: SkinKind;
  seed: number;
  rarity: SkinRarity;
}

export interface GeneratedSkin extends SkinSeed {
  name: string;
  /** Коврик и стакан — одна картинка, у кубика — грань для значения 1..6. */
  render: (value?: number) => PixelImage;
}

const GENDER_INDEX: Record<Gender, number> = { m: 0, f: 1, n: 2, pl: 3 };
const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Сгенерировать скин по seed. Чистая функция: тот же вход — тот же скин на любом устройстве. */
export function generateSkin({ kind, seed, rarity }: SkinSeed): GeneratedSkin {
  const rng = createRng(seed ^ (SKIN_KINDS.indexOf(kind) * 0x9e3779b9) ^ (SKIN_RARITIES.indexOf(rarity) << 28));
  switch (kind) {
    case 'mat': {
      const mat = generateMat(rng, seed, rarity);
      const name = `${mat.adjectives[GENDER_INDEX[mat.gender]]} ${mat.noun}`;
      return { kind, seed, rarity, name: capitalize(name), render: () => mat.image };
    }
    case 'dice': {
      const dice = generateDice(rng, seed, rarity);
      return { kind, seed, rarity, name: `${dice.adjectives[3]} кости${dice.suffix}`, render: (v = 5) => dice.face(v) };
    }
    case 'cup': {
      const cup = generateCup(rng, seed, rarity);
      return { kind, seed, rarity, name: `${cup.adjectives[0]} стакан${cup.suffix}`, render: () => cup.image };
    }
  }
}

/** Случайный seed для нового скина: 31 бит, чтобы влезать в integer Postgres без знака. */
export const randomSkinSeed = (random: () => number = Math.random) => Math.floor(random() * 0x7fffffff);
