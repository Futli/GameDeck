import {
  SKIN_GENERATOR_VERSION,
  SKIN_KINDS,
  generateSkin,
  randomSkinSeed,
  type EquippedSkins,
  type SkinCustody,
  type SkinKind,
  type SkinRarity,
  type SkinTransferView,
  type SkinView,
} from '@gamedeck/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { players, skinEquipment, skinTransfers, skins } from '../db/schema.js';
import type { Tx } from '../db/wallet.js';
import { AppError } from '../errors.js';

export type SkinSource = 'drop' | 'reward' | 'admin';

interface MintOptions {
  source: SkinSource;
  tradable?: boolean;
  /** Генератор seed; в тестах — детерминированный. */
  random?: () => number;
  /** Выпустить внутри чужой транзакции (бросок в виджете): скин и монеты появятся или не появятся вместе. */
  tx?: Tx;
}

type SkinRow = typeof skins.$inferSelect;

/** Строка базы → карточка для клиента. Название считает генератор, в базе его нет. */
function toView(row: SkinRow, equipped: boolean): SkinView {
  const kind = row.kind as SkinKind;
  const rarity = row.rarity as SkinRarity;
  return {
    id: row.id,
    serial: row.serial,
    kind,
    seed: row.seed,
    rarity,
    name: generateSkin({ kind, seed: row.seed, rarity }).name,
    tradable: row.tradable,
    custody: row.custody as SkinCustody,
    equipped,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Можно ли передать скин внутри игры. Одна проверка на все пути, которые меняют владельца:
 * подарок сейчас, рынок и аукцион потом. Скин, выведенный в NFT, двигается только в блокчейне,
 * иначе запись в базе и владелец на кошельке разойдутся.
 */
export function assertMovableInGame(skin: Pick<SkinRow, 'tradable' | 'custody'>): void {
  if (!skin.tradable) throw new AppError('NOT_TRADABLE', 'Этот скин нельзя передать');
  if (skin.custody !== 'game') throw new AppError('ON_CHAIN', 'Скин выведен в NFT: передайте его с кошелька');
}

/**
 * Сгенерированные скины: выпуск, инвентарь, надеть/снять и передача другому игроку.
 * Каждый скин — уникальная вещь с одним владельцем; каждая смена владельца пишется
 * в skin_transfers, так же как монеты пишутся в журнал.
 */
export class SkinService {
  constructor(private readonly db: Db) {}

  /**
   * Выпустить новый скин игроку (дроп в виджете, приз недели). Seed случайный;
   * если такой уже занят (шанс ~1 на 2 млрд), пробуем другой.
   */
  async mint(playerId: string, kind: SkinKind, rarity: SkinRarity, options: MintOptions): Promise<SkinView> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const seed = randomSkinSeed(options.random);
      const db = options.tx ?? this.db;
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(skins)
          .values({
            kind,
            seed,
            rarity,
            version: SKIN_GENERATOR_VERSION,
            ownerId: playerId,
            source: options.source,
            tradable: options.tradable ?? true,
          })
          .onConflictDoNothing()
          .returning();
        if (created)
          await tx.insert(skinTransfers).values({ skinId: created.id, toPlayerId: playerId, reason: 'mint' });
        return created;
      });
      if (row) return toView(row, false);
    }
    throw new AppError('SKIN_SEED_EXHAUSTED', 'Не удалось выпустить скин, попробуйте ещё раз');
  }

  /** Инвентарь игрока: сначала надетые, потом по редкости и новизне. */
  async list(playerId: string): Promise<SkinView[]> {
    const rows = await this.db
      .select({ skin: skins, equippedBy: skinEquipment.playerId })
      .from(skins)
      .leftJoin(skinEquipment, eq(skinEquipment.skinId, skins.id))
      .where(eq(skins.ownerId, playerId))
      .orderBy(desc(skins.createdAt));
    const rank: Record<string, number> = { epic: 0, rare: 1, common: 2 };
    return rows
      .map((r) => toView(r.skin, r.equippedBy !== null))
      .sort((a, b) => Number(b.equipped) - Number(a.equipped) || rank[a.rarity]! - rank[b.rarity]!);
  }

  /** Карточка скина с историей владельцев: её видят все, как витрину. */
  async card(skinId: string): Promise<{ skin: SkinView; ownerId: string; history: SkinTransferView[] }> {
    const [row] = await this.db
      .select({ skin: skins, equippedBy: skinEquipment.playerId })
      .from(skins)
      .leftJoin(skinEquipment, eq(skinEquipment.skinId, skins.id))
      .where(eq(skins.id, skinId));
    if (!row) throw new AppError('SKIN_NOT_FOUND', 'Скин не найден');
    const history = await this.db
      .select({
        reason: skinTransfers.reason,
        fromPlayerId: skinTransfers.fromPlayerId,
        toPlayerId: skinTransfers.toPlayerId,
        priceCoins: skinTransfers.priceCoins,
        createdAt: skinTransfers.createdAt,
      })
      .from(skinTransfers)
      .where(eq(skinTransfers.skinId, skinId))
      .orderBy(asc(skinTransfers.createdAt));
    return {
      skin: toView(row.skin, row.equippedBy !== null),
      ownerId: row.skin.ownerId,
      history: history.map((h) => ({
        ...h,
        reason: h.reason as SkinTransferView['reason'],
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  async equip(playerId: string, skinId: string): Promise<SkinView[]> {
    const [skin] = await this.db
      .select({ kind: skins.kind })
      .from(skins)
      .where(and(eq(skins.id, skinId), eq(skins.ownerId, playerId)));
    if (!skin) throw new AppError('NOT_OWNER', 'Этого скина у вас нет');
    await this.db
      .insert(skinEquipment)
      .values({ playerId, kind: skin.kind, skinId })
      .onConflictDoUpdate({ target: [skinEquipment.playerId, skinEquipment.kind], set: { skinId } });
    return this.list(playerId);
  }

  async unequip(playerId: string, kind: SkinKind): Promise<SkinView[]> {
    await this.db.delete(skinEquipment).where(and(eq(skinEquipment.playerId, playerId), eq(skinEquipment.kind, kind)));
    return this.list(playerId);
  }

  /**
   * Подарить скин. Одна транзакция: проверка владельца, смена владельца, снятие
   * с прежнего хозяина и запись в журнал. UPDATE с условием «владелец — я» не даст
   * подарить одну вещь двоим, даже если два запроса придут одновременно.
   */
  async gift(fromPlayerId: string, toPlayerId: string, skinId: string): Promise<SkinView[]> {
    if (fromPlayerId === toPlayerId) throw new AppError('SELF_TRANSFER', 'Нельзя подарить скин самому себе');
    await this.db.transaction(async (tx) => {
      await this.transfer(tx, { skinId, fromPlayerId, toPlayerId, reason: 'gift' });
    });
    return this.list(fromPlayerId);
  }

  /**
   * Общая часть любой передачи: подарок сейчас, продажа на рынке потом.
   * Списание монет за продажу будет жить рядом, в той же транзакции.
   */
  private async transfer(
    tx: Tx,
    t: { skinId: string; fromPlayerId: string; toPlayerId: string; reason: 'gift' | 'sale'; priceCoins?: number },
  ): Promise<void> {
    const [skin] = await tx.select().from(skins).where(eq(skins.id, t.skinId));
    if (!skin) throw new AppError('SKIN_NOT_FOUND', 'Скин не найден');
    if (skin.ownerId !== t.fromPlayerId) throw new AppError('NOT_OWNER', 'Этого скина у вас нет');
    assertMovableInGame(skin);
    const [recipient] = await tx.select({ id: players.id }).from(players).where(eq(players.id, t.toPlayerId));
    if (!recipient) throw new AppError('PLAYER_NOT_FOUND', 'Игрок не найден');

    const moved = await tx
      .update(skins)
      .set({ ownerId: t.toPlayerId })
      .where(and(eq(skins.id, t.skinId), eq(skins.ownerId, t.fromPlayerId)))
      .returning({ id: skins.id });
    if (moved.length === 0) throw new AppError('NOT_OWNER', 'Этого скина у вас уже нет');
    await tx.delete(skinEquipment).where(eq(skinEquipment.skinId, t.skinId));
    await tx.insert(skinTransfers).values({
      skinId: t.skinId,
      fromPlayerId: t.fromPlayerId,
      toPlayerId: t.toPlayerId,
      reason: t.reason,
      priceCoins: t.priceCoins ?? null,
    });
  }

  /** Надетые скины игрока для стола: только то, из чего генератор нарисует картинку. */
  async equipped(playerId: string): Promise<EquippedSkins> {
    const rows = await this.db
      .select({ kind: skins.kind, seed: skins.seed, rarity: skins.rarity })
      .from(skinEquipment)
      .innerJoin(skins, eq(skins.id, skinEquipment.skinId))
      .where(and(eq(skinEquipment.playerId, playerId), inArray(skins.kind, [...SKIN_KINDS])));
    return Object.fromEntries(
      rows.map((r) => [r.kind, { kind: r.kind as SkinKind, seed: r.seed, rarity: r.rarity as SkinRarity }]),
    );
  }
}
