import { generateCup } from './cup.js';
import { generateDice } from './dice.js';
import type { PixelImage } from './image.js';
import { generateMat } from './mat.js';
import { createRng } from './random.js';
import { SKIN_RARITIES, type SkinRarity } from './themes.js';

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

/** Признак скина, как атрибут NFT: «Quality: Epic», «Frame: Gold». Всегда по-английски. */
export interface SkinTrait {
  trait: string;
  value: string;
}

export interface GeneratedSkin extends SkinSeed {
  /** Название по одному правилу для всех: цвет, стиль, вид — «Emerald Honeycomb Mat», «Ruby Dice». */
  name: string;
  /** Признаки по порядку: качество, цвет, стиль, затем детали вида (рамка, точки, отделка). */
  traits: SkinTrait[];
  /** Коврик и стакан — одна картинка, у кубика — грань для значения 1..6. */
  render: (value?: number) => PixelImage;
}

const QUALITY: Record<SkinRarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic' };
const KIND_NAME: Record<SkinKind, string> = { mat: 'Mat', dice: 'Dice', cup: 'Cup' };
/** Стили без узора в название не попадают: «Forest Dice», а не «Forest Plain Dice». */
const UNNAMED_STYLES = new Set(['Plain', 'Gradient']);

function nameOf(kind: SkinKind, color: string, style: string): string {
  return [color, UNNAMED_STYLES.has(style) ? null : style, KIND_NAME[kind]].filter(Boolean).join(' ');
}

/** Признаки без пустых значений: у обычного коврика нет эмблемы, у обычных кубиков — кромки. */
function traitsOf(rarity: SkinRarity, ...rest: Array<[string, string | null]>): SkinTrait[] {
  return [['Quality', QUALITY[rarity]] as [string, string | null], ...rest]
    .filter((pair): pair is [string, string] => pair[1] !== null)
    .map(([trait, value]) => ({ trait, value }));
}

/** Сгенерировать скин по seed. Чистая функция: тот же вход — тот же скин на любом устройстве. */
export function generateSkin({ kind, seed, rarity }: SkinSeed): GeneratedSkin {
  const rng = createRng(seed ^ (SKIN_KINDS.indexOf(kind) * 0x9e3779b9) ^ (SKIN_RARITIES.indexOf(rarity) << 28));
  switch (kind) {
    case 'mat': {
      const mat = generateMat(rng, seed, rarity);
      return {
        kind,
        seed,
        rarity,
        name: nameOf(kind, mat.color, mat.style),
        traits: traitsOf(
          rarity,
          ['Color', mat.color],
          ['Pattern', mat.style],
          ['Frame', mat.frame],
          ['Stitching', mat.stitched ? 'Dashed' : null],
          ['Emblem', mat.emblem],
        ),
        render: () => mat.image,
      };
    }
    case 'dice': {
      const dice = generateDice(rng, seed, rarity);
      return {
        kind,
        seed,
        rarity,
        name: nameOf(kind, dice.color, dice.style),
        traits: traitsOf(
          rarity,
          ['Color', dice.color],
          ['Texture', dice.style],
          ['Pips', dice.pips],
          ['Pip Color', dice.accentPips ? 'Accent' : 'Contrast'],
          ['Edge', dice.edge],
        ),
        render: (v = 5) => dice.face(v),
      };
    }
    case 'cup': {
      const cup = generateCup(rng, seed, rarity);
      return {
        kind,
        seed,
        rarity,
        name: nameOf(kind, cup.color, cup.style),
        traits: traitsOf(rarity, ['Color', cup.color], ['Pattern', cup.style], ['Trim', cup.trim]),
        render: () => cup.image,
      };
    }
  }
}

/** Случайный seed для нового скина: 31 бит, чтобы влезать в integer Postgres без знака. */
export const randomSkinSeed = (random: () => number = Math.random) => Math.floor(random() * 0x7fffffff);
