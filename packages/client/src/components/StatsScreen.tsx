import { games, type MatchHistoryEntry, type MatchHistoryPage, type MyProfile } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { http } from '../lib/socket';

const PAGE = 20;

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** +120 / −50 / 0 с цветом: зелёный — заработал, красный — потерял. */
function Coins({ value }: { value: number }) {
  if (value === 0) return <span className="muted">0</span>;
  return <span className={value > 0 ? 'up' : 'down'}>{value > 0 ? `+${value}` : `−${-value}`}</span>;
}

function MatchRow({ match }: { match: MatchHistoryEntry }) {
  const won = match.place === 1;
  const rating = match.ratingAfter - match.ratingBefore;
  return (
    <li className={won ? 'history-row history-row--won' : 'history-row'}>
      <div className="history-row__main">
        <b>{won ? 'Победа' : `${match.place} место из ${match.players}`}</b>
        <span className="muted">
          {games[match.gameId]?.title ?? match.gameId} · {dateFormat.format(new Date(match.finishedAt))}
        </span>
      </div>
      <div className="history-row__numbers">
        <b>
          <Coins value={match.coins} />
        </b>
        <span className="muted">{match.stake > 0 ? `ставка ${match.stake}` : 'без ставки'}</span>
        <span className="muted">рейтинг {rating >= 0 ? `+${rating}` : `−${-rating}`}</span>
      </div>
    </li>
  );
}

/**
 * Статистика игрока: итоги по всем играм и история партий — чем кончилась каждая
 * и сколько монет принесла. Монеты берутся из журнала, поэтому проигранная ставка
 * ушедшего из партии игрока тоже видна здесь как минус.
 */
export function StatsScreen({ profile, onBack }: { profile: MyProfile; onBack: () => void }) {
  const [matches, setMatches] = useState<MatchHistoryEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (before: string | null) => {
    setLoading(true);
    try {
      const query = `limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
      const page = await http<MatchHistoryPage>(`/api/me/matches?${query}`);
      setMatches((prev) => [...(before ? (prev ?? []) : []), ...page.matches]);
      setNext(page.next);
    } catch {
      setMatches((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(null);
  }, []);

  const losses = profile.gamesPlayed - profile.wins;
  const net = profile.coinsWon - profile.coinsLost;
  const winRate = profile.gamesPlayed > 0 ? Math.round((profile.wins / profile.gamesPlayed) * 100) : 0;

  return (
    <main className="screen">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ← Назад
        </button>
        <h2>Статистика</h2>
      </header>

      <div className="profile-stats">
        <div className="stat">
          <b>{profile.gamesPlayed}</b>
          <span>игр</span>
        </div>
        <div className="stat">
          <b>
            <span className="up">{profile.wins}</span> / <span className="down">{losses}</span>
          </b>
          <span>побед / поражений · {winRate}%</span>
        </div>
        <div className="stat">
          <b>
            <span className="up">+{profile.coinsWon}</span> / <span className="down">−{profile.coinsLost}</span>
          </b>
          <span>выиграно / проиграно монет</span>
        </div>
        <div className="stat">
          <b>
            <Coins value={net} />
          </b>
          <span>итого на ставках</span>
        </div>
      </div>

      <h3 className="screen-subtitle">История партий</h3>
      {matches === null ? (
        <p className="muted center">Загружаем…</p>
      ) : matches.length === 0 ? (
        <p className="muted center">Сыграйте первую партию — она появится здесь</p>
      ) : (
        <ul className="history">
          {matches.map((m) => (
            <MatchRow key={m.matchId} match={m} />
          ))}
        </ul>
      )}
      {next && (
        <button disabled={loading} onClick={() => load(next)}>
          Показать ещё
        </button>
      )}
    </main>
  );
}
