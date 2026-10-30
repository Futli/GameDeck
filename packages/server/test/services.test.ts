import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { coinTransactions } from '../src/db/schema.js';
import { PlayerService } from '../src/players/player-service.js';
import { ShopService } from '../src/shop/shop-service.js';
import { StatsService } from '../src/stats/stats-service.js';
import { testDatabase } from './helpers.js';

describe('база: игроки, статистика, магазин', () => {
  let database: Database;
  let players: PlayerService;
  let stats: StatsService;
  let shop: ShopService;

  beforeAll(async () => {
    database = await testDatabase();
    players = new PlayerService(database.db, 500);
    stats = new StatsService(database.db);
    shop = new ShopService(database.db);
    await shop.syncCatalog();
  });

  const match = (ids: string[], winnerIndex = 0) => ({
    gameId: 'dice-high',
    roomCode: 'TEST1',
    stake: 0,
    winnerId: ids[winnerIndex]!,
    startedAt: new Date(),
    finishedAt: new Date(),
    players: ids.map((playerId, seat) => ({ playerId, seat, place: seat === winnerIndex ? 1 : 2 })),
  });

  describe('игроки', () => {
    it('новый игрок получает стартовые монеты, бесплатные предметы и надевает их', async () => {
      const { playerId } = await players.register();
      const inv = await shop.inventory(playerId);
      expect(inv.coins).toBe(500);
      expect(inv.equipment).toEqual({ mat: 'mat-felt', dice: 'dice-classic' });

      const ledger = await database.db.select().from(coinTransactions).where(eq(coinTransactions.playerId, playerId));
      expect(ledger).toMatchObject([{ amount: 500, balanceAfter: 500, reason: 'bonus' }]);
    });

    it('сессия находится по токену; неизвестный токен создаёт нового игрока', async () => {
      const first = await players.resolveSession(undefined);
      const again = await players.resolveSession(first.token);
      expect(again.playerId).toBe(first.playerId);

      const stranger = await players.resolveSession('fake-token');
      expect(stranger.playerId).not.toBe(first.playerId);
    });
  });

  describe('статистика и рейтинг', () => {
    it('партия сохраняется, рейтинг и счётчики обновляются, профиль показывает историю', async () => {
      const a = (await players.register()).playerId;
      const b = (await players.register()).playerId;
      await players.rename(a, 'Алиса');

      const record = await stats.recordMatch(match([a, b]));
      expect(record.players).toEqual([
        { playerId: a, place: 1, ratingBefore: 1000, ratingAfter: 1016 },
        { playerId: b, place: 2, ratingBefore: 1000, ratingAfter: 984 },
      ]);

      await stats.recordMatch(match([a, b], 1));
      const profile = await players.profile(a);
      expect(profile?.displayName).toBe('Алиса');
      expect(profile?.stats).toMatchObject([{ gameId: 'dice-high', gamesPlayed: 2, wins: 1, peakRating: 1016 }]);
      expect(profile?.recentMatches).toHaveLength(2);
    });

    it('таблица лидеров отсортирована по рейтингу', async () => {
      const ids = [(await players.register()).playerId, (await players.register()).playerId];
      await stats.recordMatch(match(ids, 1));
      const top = await stats.leaderboard('dice-high', 100);
      const ratings = top.map((p) => p.rating);
      expect(ratings).toEqual([...ratings].sort((x, y) => y - x));
      expect(top.find((p) => p.playerId === ids[1])?.rating).toBe(1016);
    });
  });

  describe('магазин', () => {
    it('покупка за монеты списывает баланс и добавляет предмет; второй раз купить нельзя', async () => {
      const { playerId } = await players.register();
      const inv = await shop.buyWithCoins(playerId, 'mat-wood');
      expect(inv.coins).toBe(200);
      expect(inv.items.map((i) => i.itemId)).toContain('mat-wood');
      await expect(shop.buyWithCoins(playerId, 'mat-wood')).rejects.toThrow('уже есть');
    });

    it('не хватает монет — ничего не меняется', async () => {
      const { playerId } = await players.register();
      await expect(shop.buyWithCoins(playerId, 'dice-gold')).rejects.toThrow('Недостаточно монет');
      const inv = await shop.inventory(playerId);
      expect(inv.coins).toBe(500);
      expect(inv.items.map((i) => i.itemId)).not.toContain('dice-gold');
    });

    it('предмет только за Stars нельзя купить монетами', async () => {
      const { playerId } = await players.register();
      await expect(shop.buyWithCoins(playerId, 'mat-dragon')).rejects.toThrow('только за Stars');
    });

    it('надетый скин кубиков определяет цвет грани и точек за столом', async () => {
      const { playerId } = await players.register();
      expect(await players.diceStyle(playerId)).toEqual({ face: '#fbf8ef', pips: '#1a1a1a' });
      await shop.buyWithCoins(playerId, 'dice-casino').catch(() => {}); // 1000 > 500 монет
      await shop.applyStarsPayment({
        playerId,
        telegramChargeId: `dice-${playerId}`,
        productKind: 'coin_pack',
        productId: 'coins-500',
        stars: 25,
      });
      await shop.buyWithCoins(playerId, 'dice-casino');
      await shop.equip(playerId, 'dice-casino');
      expect(await players.diceStyle(playerId)).toEqual({ face: '#d91e2b', pips: '#ffffff' });
    });

    it('надеть можно только свой предмет, он занимает слот своего вида', async () => {
      const { playerId } = await players.register();
      await expect(shop.equip(playerId, 'mat-wood')).rejects.toThrow('Сначала купите');
      await shop.buyWithCoins(playerId, 'mat-wood');
      const inv = await shop.equip(playerId, 'mat-wood');
      expect(inv.equipment.mat).toBe('mat-wood');
    });

    it('платёж Stars начисляется один раз, даже если Telegram прислал его дважды', async () => {
      const { playerId } = await players.register();
      const payment = {
        playerId,
        telegramChargeId: `charge-${playerId}`,
        productKind: 'coin_pack' as const,
        productId: 'coins-500',
        stars: 25,
      };
      expect(await shop.applyStarsPayment(payment)).toEqual({ duplicate: false });
      expect(await shop.applyStarsPayment(payment)).toEqual({ duplicate: true });
      expect((await shop.inventory(playerId)).coins).toBe(1000);
    });

    it('платёж с неверной суммой отклоняется и не сохраняется', async () => {
      const { playerId } = await players.register();
      const payment = {
        playerId,
        telegramChargeId: `bad-${playerId}`,
        productKind: 'item' as const,
        productId: 'mat-dragon',
        stars: 1,
      };
      await expect(shop.applyStarsPayment(payment)).rejects.toThrow('не совпадает');
      // Транзакция откатилась, поэтому правильный повтор пройдёт.
      expect(await shop.applyStarsPayment({ ...payment, stars: 250 })).toEqual({ duplicate: false });
      expect((await shop.inventory(playerId)).items.map((i) => i.itemId)).toContain('mat-dragon');
    });
  });
});
