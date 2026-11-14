import { readFile } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { playerItems, skins as skinsTable } from '../src/db/schema.js';
import { PlayerService } from '../src/players/player-service.js';
import { ShopService } from '../src/shop/shop-service.js';
import { SkinService } from '../src/skins/skin-service.js';
import { testDatabase } from './helpers.js';

describe('скины: выпуск, надевание, подарок', () => {
  let database: Database;
  let players: PlayerService;
  let skins: SkinService;

  beforeAll(async () => {
    database = await testDatabase();
    players = new PlayerService(database.db, 0);
    skins = new SkinService(database.db);
  });

  const newPlayer = async () => (await players.register()).playerId;

  it('выпущенный скин лежит в инвентаре с названием и номером, журнал помнит выпуск', async () => {
    const alice = await newPlayer();
    const mat = await skins.mint(alice, 'mat', 'epic', { source: 'drop' });
    expect(mat).toMatchObject({ kind: 'mat', rarity: 'epic', equipped: false, tradable: true });
    expect(mat.name.length).toBeGreaterThan(3);
    expect(await skins.list(alice)).toEqual([mat]);

    const card = await skins.card(mat.id);
    expect(card.ownerId).toBe(alice);
    expect(card.history).toMatchObject([{ reason: 'mint', fromPlayerId: null, toPlayerId: alice }]);
  });

  it('занятый seed не выпускается второй раз: берётся другой', async () => {
    const alice = await newPlayer();
    let calls = 0;
    // Первые два вызова дают один и тот же seed, третий — другой.
    const random = () => (calls++ < 2 ? 0.123456 : 0.654321);
    const first = await skins.mint(alice, 'dice', 'rare', { source: 'drop', random });
    const second = await skins.mint(alice, 'dice', 'rare', { source: 'drop', random });
    expect(second.seed).not.toBe(first.seed);
  });

  it('надетый скин уходит на стол; надеть чужой нельзя', async () => {
    const alice = await newPlayer();
    const bob = await newPlayer();
    const cup = await skins.mint(alice, 'cup', 'rare', { source: 'drop' });

    await skins.equip(alice, cup.id);
    expect(await skins.equipped(alice)).toEqual({ cup: { kind: 'cup', seed: cup.seed, rarity: 'rare' } });
    await expect(skins.equip(bob, cup.id)).rejects.toMatchObject({ code: 'NOT_OWNER' });

    await skins.unequip(alice, 'cup');
    expect(await skins.equipped(alice)).toEqual({});
  });

  it('подарок меняет владельца, снимает скин с дарителя и пишется в журнал', async () => {
    const alice = await newPlayer();
    const bob = await newPlayer();
    const mat = await skins.mint(alice, 'mat', 'common', { source: 'drop' });
    await skins.equip(alice, mat.id);

    expect(await skins.gift(alice, bob, mat.id)).toEqual([]);
    expect(await skins.equipped(alice)).toEqual({});
    expect(await skins.list(bob)).toMatchObject([{ id: mat.id, equipped: false }]);

    const { history } = await skins.card(mat.id);
    expect(history.map((h) => h.reason)).toEqual(['mint', 'gift']);
    expect(history[1]).toMatchObject({ fromPlayerId: alice, toPlayerId: bob });

    // Подаренное второй раз не подарить.
    await expect(skins.gift(alice, bob, mat.id)).rejects.toMatchObject({ code: 'NOT_OWNER' });
  });

  it('привязанный скин, подарок себе и несуществующему игроку отклоняются', async () => {
    const alice = await newPlayer();
    const bob = await newPlayer();
    const prize = await skins.mint(alice, 'dice', 'epic', { source: 'reward', tradable: false });
    await expect(skins.gift(alice, bob, prize.id)).rejects.toMatchObject({ code: 'NOT_TRADABLE' });
    await expect(skins.gift(alice, alice, prize.id)).rejects.toMatchObject({ code: 'SELF_TRANSFER' });

    const gift = await skins.mint(alice, 'dice', 'common', { source: 'drop' });
    await expect(skins.gift(alice, '00000000-0000-4000-8000-000000000000', gift.id)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND',
    });
    const [row] = await database.db.select().from(skinsTable).where(eq(skinsTable.id, gift.id));
    expect(row!.ownerId).toBe(alice);
  });

  it('два одновременных подарка одной вещи: доходит только один', async () => {
    const alice = await newPlayer();
    const bob = await newPlayer();
    const carol = await newPlayer();
    const mat = await skins.mint(alice, 'mat', 'rare', { source: 'drop' });
    const results = await Promise.allSettled([skins.gift(alice, bob, mat.id), skins.gift(alice, carol, mat.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { history } = await skins.card(mat.id);
    expect(history.filter((h) => h.reason === 'gift')).toHaveLength(1);
  });

  it('миграция 0009: старые выигрыши виджета из каталога становятся скинами в «Моих скинах»', async () => {
    await new ShopService(database.db).syncCatalog();
    const alice = await newPlayer();
    const bob = await newPlayer();
    const wonAt = new Date('2026-11-13T10:00:00Z');
    await database.db.insert(playerItems).values([
      { playerId: alice, itemId: 'mat-wood', source: 'reward', acquiredAt: wonAt },
      { playerId: alice, itemId: 'dice-night', source: 'reward', acquiredAt: wonAt },
      // Купленное в магазине — не выигрыш виджета, его миграция не трогает.
      { playerId: bob, itemId: 'dice-bone', source: 'coins' },
    ]);

    const migration = await readFile(new URL('../drizzle/0009_widget_legacy_skins.sql', import.meta.url), 'utf8');
    await database.db.execute(sql.raw(migration));

    const won = await skins.list(alice);
    expect(won.map((s) => [s.kind, s.rarity]).sort()).toEqual([
      ['dice', 'epic'],
      ['mat', 'common'],
    ]);
    expect(won.every((s) => s.tradable && s.createdAt === wonAt.toISOString())).toBe(true);
    const { history } = await skins.card(won[0]!.id);
    expect(history).toMatchObject([{ reason: 'mint', fromPlayerId: null, toPlayerId: alice }]);
    expect(await skins.list(bob)).toEqual([]);
  });
});
