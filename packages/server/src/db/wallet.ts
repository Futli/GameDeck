import { and, eq, gte, sql } from 'drizzle-orm';
import { AppError } from '../errors.js';
import type { Db } from './client.js';
import { coinTransactions, players } from './schema.js';

/** Транзакция drizzle: тот же API, что и у Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type CoinReason = 'stars_purchase' | 'item_purchase' | 'match_win' | 'match_stake' | 'bonus' | 'referral';

/**
 * Единственный способ изменить баланс. Обновление и проверка «хватает ли денег»
 * — один UPDATE с условием, поэтому две одновременные покупки не уведут баланс в минус.
 * Вызывать внутри транзакции: запись в журнал и баланс меняются вместе или никак.
 */
export async function changeCoins(
  tx: Tx,
  playerId: string,
  amount: number,
  reason: CoinReason,
  refId: string | null = null,
): Promise<number> {
  const [row] = await tx
    .update(players)
    .set({ coins: sql`${players.coins} + ${amount}` })
    .where(and(eq(players.id, playerId), gte(sql`${players.coins} + ${amount}`, 0)))
    .returning({ coins: players.coins });
  if (!row) throw new AppError('INSUFFICIENT_COINS', 'Недостаточно монет');

  await tx.insert(coinTransactions).values({ playerId, amount, balanceAfter: row.coins, reason, refId });
  return row.coins;
}
