import type { InferInsertModel } from 'drizzle-orm';
import type { DiceStyle } from '@gamedeck/shared';
import type { coinPacks, items } from '../db/schema.js';

const dice = (face: DiceStyle['face'], pips: DiceStyle['pips']) => JSON.stringify({ face, pips } satisfies DiceStyle);

/**
 * Каталог живёт в коде: цены и предметы видны в git-истории и проходят ревью.
 * При старте сервер синхронизирует эти строки в таблицы items и coin_packs.
 */
export const catalogItems: Array<InferInsertModel<typeof items>> = [
  // Коврики 128×64 — главный «скин» игрока, их видят все за столом.
  { id: 'mat-felt', kind: 'mat', name: 'Зелёное сукно', rarity: 'common', asset: 'mats/felt.png', isDefault: true },
  { id: 'mat-wood', kind: 'mat', name: 'Дубовый стол', rarity: 'common', priceCoins: 300, asset: 'mats/wood.png' },
  { id: 'mat-neon', kind: 'mat', name: 'Неон', rarity: 'rare', priceCoins: 1200, priceStars: 50, asset: 'mats/neon.png' },
  { id: 'mat-dragon', kind: 'mat', name: 'Логово дракона', rarity: 'legendary', priceStars: 250, asset: 'mats/dragon.png' },
  // Скины кубиков: asset — JSON со стилем { face, pips }, клиент рисует кубик сам.
  { id: 'dice-classic', kind: 'dice', name: 'Классика', rarity: 'common', asset: dice('#fbf8ef', '#1a1a1a'), isDefault: true },
  { id: 'dice-bone', kind: 'dice', name: 'Кость', rarity: 'rare', priceCoins: 800, asset: dice('#e8d9b5', '#5a3a1e') },
  { id: 'dice-casino', kind: 'dice', name: 'Казино', rarity: 'rare', priceCoins: 1000, asset: dice('#d91e2b', '#ffffff') },
  { id: 'dice-night', kind: 'dice', name: 'Ночь', rarity: 'epic', priceCoins: 2500, asset: dice('#1b1f3a', '#7df9ff') },
  { id: 'dice-gold', kind: 'dice', name: 'Золото', rarity: 'epic', priceCoins: 3000, priceStars: 120, asset: dice('#ffc93c', '#6b3d00') },
  // Рамки аватара и эмоции за столом.
  { id: 'frame-silver', kind: 'frame', name: 'Серебряная рамка', rarity: 'rare', priceCoins: 600, asset: 'frames/silver.png' },
  { id: 'emote-gg', kind: 'emote', name: 'GG', rarity: 'common', priceCoins: 150, asset: 'emotes/gg.png' },
];

export const catalogCoinPacks: Array<InferInsertModel<typeof coinPacks>> = [
  { id: 'coins-500', title: '500 монет', priceStars: 25, coins: 500 },
  { id: 'coins-1500', title: '1 500 монет', priceStars: 65, coins: 1500 },
  { id: 'coins-5000', title: '5 000 монет', priceStars: 200, coins: 5000 },
];

/** Слоты экипировки = виды предметов. */
export const equipmentSlots = ['mat', 'dice', 'frame', 'emote'] as const;
