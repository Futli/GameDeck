import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coinPacks, items, playerEquipment, playerItems, players, starsPayments } from '../db/schema.js';
import { changeCoins } from '../db/wallet.js';
import { AppError } from '../errors.js';
import { catalogCoinPacks, catalogItems } from './catalog.js';

export interface StarsPayment {
  playerId: string;
  /** telegram_payment_charge_id из successful_payment. */
  telegramChargeId: string;
  productKind: 'coin_pack' | 'item';
  productId: string;
  stars: number;
}

/** Магазин: каталог, инвентарь, покупка за монеты, экипировка и начисление покупок за Stars. */
export class ShopService {
  constructor(private readonly db: Db) {}

  /** Записать каталог из кода в базу (вставить новое, обновить изменённое). */
  async syncCatalog(): Promise<void> {
    for (const item of catalogItems) {
      await this.db
        .insert(items)
        .values(item)
        .onConflictDoUpdate({ target: items.id, set: { ...item, id: undefined } });
    }
    for (const pack of catalogCoinPacks) {
      await this.db
        .insert(coinPacks)
        .values(pack)
        .onConflictDoUpdate({ target: coinPacks.id, set: { ...pack, id: undefined } });
    }
  }

  async catalog() {
    const [itemRows, packRows] = await Promise.all([
      this.db.select().from(items).where(eq(items.isActive, true)),
      this.db.select().from(coinPacks).where(eq(coinPacks.isActive, true)),
    ]);
    return { items: itemRows, coinPacks: packRows };
  }

  /** Всё, что нужно клиенту для экрана «Мои вещи». */
  async inventory(playerId: string) {
    const [[wallet], owned, equipped] = await Promise.all([
      this.db.select({ coins: players.coins }).from(players).where(eq(players.id, playerId)),
      this.db
        .select({ itemId: playerItems.itemId, source: playerItems.source, acquiredAt: playerItems.acquiredAt })
        .from(playerItems)
        .where(eq(playerItems.playerId, playerId)),
      this.db.select().from(playerEquipment).where(eq(playerEquipment.playerId, playerId)),
    ]);
    return {
      coins: wallet?.coins ?? 0,
      items: owned,
      equipment: Object.fromEntries(equipped.map((e) => [e.slot, e.itemId])),
    };
  }

  async buyWithCoins(playerId: string, itemId: string) {
    await this.db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.isActive, true)));
      if (!item) throw new AppError('ITEM_NOT_FOUND', 'Предмет не найден');
      if (item.priceCoins === null) throw new AppError('NOT_FOR_COINS', 'Этот предмет продаётся только за Stars');

      // Сначала забираем предмет (PK не даст купить дважды), потом списываем монеты.
      const granted = await tx
        .insert(playerItems)
        .values({ playerId, itemId, source: 'coins' })
        .onConflictDoNothing()
        .returning();
      if (granted.length === 0) throw new AppError('ALREADY_OWNED', 'Предмет уже есть');
      await changeCoins(tx, playerId, -item.priceCoins, 'item_purchase', itemId);
    });
    return this.inventory(playerId);
  }

  async equip(playerId: string, itemId: string) {
    const [owned] = await this.db
      .select({ kind: items.kind })
      .from(playerItems)
      .innerJoin(items, eq(items.id, playerItems.itemId))
      .where(and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId)));
    if (!owned) throw new AppError('NOT_OWNED', 'Сначала купите предмет');

    await this.db
      .insert(playerEquipment)
      .values({ playerId, slot: owned.kind, itemId })
      .onConflictDoUpdate({ target: [playerEquipment.playerId, playerEquipment.slot], set: { itemId } });
    return this.inventory(playerId);
  }

  /**
   * Начислить оплаченный в Telegram товар. Вызывается из обработчика successful_payment бота.
   * Идемпотентно: повтор того же telegramChargeId ничего не начисляет.
   */
  async applyStarsPayment(payment: StarsPayment): Promise<{ duplicate: boolean }> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx.insert(starsPayments).values(payment).onConflictDoNothing().returning();
      if (inserted.length === 0) return { duplicate: true };

      if (payment.productKind === 'coin_pack') {
        const [pack] = await tx.select().from(coinPacks).where(eq(coinPacks.id, payment.productId));
        if (!pack || pack.priceStars !== payment.stars) throw new AppError('BAD_PAYMENT', 'Платёж не совпадает с товаром');
        await changeCoins(tx, payment.playerId, pack.coins, 'stars_purchase', payment.telegramChargeId);
      } else {
        const [item] = await tx.select().from(items).where(eq(items.id, payment.productId));
        if (!item || item.priceStars !== payment.stars) throw new AppError('BAD_PAYMENT', 'Платёж не совпадает с товаром');
        await tx
          .insert(playerItems)
          .values({ playerId: payment.playerId, itemId: item.id, source: 'stars' })
          .onConflictDoNothing();
      }
      return { duplicate: false };
    });
  }
}

