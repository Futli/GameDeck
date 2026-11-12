import type { MatchHistoryPage, MatchRecord } from '@gamedeck/shared';
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coinTransactions, matchPlayers, matches, playerGameStats, players } from '../db/schema.js';
import { changeCoins, type Tx } from '../db/wallet.js';
import type { MatchResult } from '../rooms/room.js';
import { multiplayerElo } from './elo.js';

/** Статистика и рейтинг: запись итогов партии и таблица лидеров. */
export class StatsService {
  constructor(private readonly db: Db) {}

  /**
   * Сохранить партию, пересчитать рейтинг и рассчитаться по ставке. Всё в одной транзакции:
   * либо записаны и партия, и новые рейтинги, и монеты, либо ничего.
   */
  async recordMatch(result: MatchResult): Promise<MatchRecord> {
    const ids = result.players.map((p) => p.playerId);

    return this.db.transaction(async (tx) => {
      // У новичка в этой игре ещё нет строки статистики — создаём со стартовым рейтингом.
      await tx
        .insert(playerGameStats)
        .values(ids.map((playerId) => ({ playerId, gameId: result.gameId })))
        .onConflictDoNothing();

      // FOR UPDATE: если две партии одного игрока закончатся одновременно, вторая подождёт первую.
      const current = await tx
        .select({ playerId: playerGameStats.playerId, rating: playerGameStats.rating })
        .from(playerGameStats)
        .where(and(eq(playerGameStats.gameId, result.gameId), inArray(playerGameStats.playerId, ids)))
        .for('update');
      const ratingOf = new Map(current.map((r) => [r.playerId, r.rating]));

      const next = multiplayerElo(
        result.players.map((p) => ({ id: p.playerId, rating: ratingOf.get(p.playerId)!, place: p.place })),
      );

      const [match] = await tx
        .insert(matches)
        .values({
          gameId: result.gameId,
          roomCode: result.roomCode,
          stake: result.stake,
          winnerId: result.winnerId,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
        })
        .returning({ id: matches.id });

      const rows = result.players.map((p) => ({
        matchId: match!.id,
        playerId: p.playerId,
        seat: p.seat,
        place: p.place,
        ratingBefore: ratingOf.get(p.playerId)!,
        ratingAfter: next.get(p.playerId)!,
      }));
      await tx.insert(matchPlayers).values(rows);
      const coins = await settleStake(tx, result, match!.id);

      for (const row of rows) {
        await tx
          .update(playerGameStats)
          .set({
            rating: row.ratingAfter,
            peakRating: sql`greatest(${playerGameStats.peakRating}, ${row.ratingAfter})`,
            gamesPlayed: sql`${playerGameStats.gamesPlayed} + 1`,
            wins: sql`${playerGameStats.wins} + ${row.playerId === result.winnerId ? 1 : 0}`,
            updatedAt: new Date(),
          })
          .where(and(eq(playerGameStats.playerId, row.playerId), eq(playerGameStats.gameId, result.gameId)));
      }

      return {
        matchId: match!.id,
        gameId: result.gameId,
        players: rows.map(({ playerId, place, ratingBefore, ratingAfter }) => ({
          playerId,
          place,
          ratingBefore,
          ratingAfter,
          coins: coins.get(playerId) ?? 0,
        })),
      };
    });
  }

  /**
   * История партий игрока, новые сверху, страницами по limit. Монеты берём из журнала
   * (match_win / match_stake со ссылкой на партию), а не пересчитываем по ставке:
   * журнал знает, сколько игрок отдал на самом деле, если монет не хватало.
   */
  async history(
    playerId: string,
    { limit = 20, before }: { limit?: number; before?: Date } = {},
  ): Promise<MatchHistoryPage> {
    const coins = sql<number>`coalesce((
      select sum(${coinTransactions.amount}) from ${coinTransactions}
      where ${coinTransactions.playerId} = ${matchPlayers.playerId}
        and ${coinTransactions.refId} = ${matches.id}::text
        and ${coinTransactions.reason} in ('match_win', 'match_stake')
    ), 0)::int`;
    const seated = sql<number>`(select count(*) from ${matchPlayers} mp where mp.match_id = ${matches.id})::int`;
    const rows = await this.db
      .select({
        matchId: matches.id,
        gameId: matches.gameId,
        finishedAt: matches.finishedAt,
        stake: matches.stake,
        place: matchPlayers.place,
        players: seated,
        ratingBefore: matchPlayers.ratingBefore,
        ratingAfter: matchPlayers.ratingAfter,
        coins,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.playerId, playerId), before ? lt(matches.finishedAt, before) : undefined))
      .orderBy(desc(matches.finishedAt))
      // Берём на одну строку больше: так узнаём, есть ли следующая страница.
      .limit(limit + 1);
    const page = rows.slice(0, limit).map((r) => ({ ...r, finishedAt: r.finishedAt.toISOString() }));
    return { matches: page, next: rows.length > limit ? page[page.length - 1]!.finishedAt : null };
  }

  async leaderboard(gameId: string, limit = 20) {
    return this.db
      .select({
        playerId: players.id,
        displayName: players.displayName,
        rating: playerGameStats.rating,
        gamesPlayed: playerGameStats.gamesPlayed,
        wins: playerGameStats.wins,
      })
      .from(playerGameStats)
      .innerJoin(players, eq(players.id, playerGameStats.playerId))
      .where(and(eq(playerGameStats.gameId, gameId), gt(playerGameStats.gamesPlayed, 0)))
      .orderBy(desc(playerGameStats.rating), desc(playerGameStats.wins))
      .limit(limit);
  }
}

/**
 * Ставка: каждый проигравший (в том числе ушедший из партии) отдаёт stake монет,
 * победитель забирает весь банк. Кому не хватает монет, отдаёт сколько есть —
 * баланс в минус не уходит. Возвращает изменение баланса по игрокам.
 */
async function settleStake(tx: Tx, result: MatchResult, matchId: string): Promise<Map<string, number>> {
  const delta = new Map<string, number>();
  const { stake, winnerId } = result;
  if (stake <= 0 || !winnerId || !result.players.some((p) => p.playerId === winnerId)) return delta;

  let pot = 0;
  for (const { playerId } of result.players) {
    if (playerId === winnerId) continue;
    const [row] = await tx.select({ coins: players.coins }).from(players).where(eq(players.id, playerId)).for('update');
    const paid = Math.min(stake, row?.coins ?? 0);
    if (paid <= 0) continue;
    await changeCoins(tx, playerId, -paid, 'match_stake', matchId);
    delta.set(playerId, -paid);
    pot += paid;
  }
  if (pot > 0) {
    await changeCoins(tx, winnerId, pot, 'match_win', matchId);
    delta.set(winnerId, pot);
  }
  return delta;
}
