import type { MatchRecord } from '@gamedeck/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { matchPlayers, matches, playerGameStats, players } from '../db/schema.js';
import type { MatchResult } from '../rooms/room.js';
import { multiplayerElo } from './elo.js';

/** Статистика и рейтинг: запись итогов партии и таблица лидеров. */
export class StatsService {
  constructor(private readonly db: Db) {}

  /**
   * Сохранить партию и пересчитать рейтинг. Всё в одной транзакции:
   * либо записаны и партия, и новые рейтинги, либо ничего.
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
        })),
      };
    });
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
