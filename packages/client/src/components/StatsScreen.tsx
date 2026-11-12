import type { MatchHistoryEntry, MatchHistoryPage, MyProfile } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { gameTitle } from './GamePicker';
import { http } from '../lib/socket';

const PAGE = 20;

const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );

/** Знак всегда виден: +16, −10. */
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** +120 / −50 / 0 с цветом: зелёный — заработал, красный — потерял. */
function Coins({ value }: { value: number }) {
  if (value === 0) return <span className="muted">0</span>;
  return <span className={value > 0 ? 'up' : 'down'}>{value > 0 ? `+${value}` : `−${-value}`}</span>;
}

function MatchRow({ match }: { match: MatchHistoryEntry }) {
  const t = useT();
  const won = match.place === 1;
  const rating = match.ratingAfter - match.ratingBefore;
  return (
    <li className={won ? 'history-row history-row--won' : 'history-row'}>
      <div className="history-row__main">
        <b>{won ? t.stats.win : t.stats.place(match.place, match.players)}</b>
        <span className="muted">
          {gameTitle(match.gameId, t)} · {formatDate(match.finishedAt, t.stats.locale)}
        </span>
      </div>
      <div className="history-row__numbers">
        <b>
          <Coins value={match.coins} />
        </b>
        <span className="muted">{t.stats.stake(match.stake)}</span>
        <span className="muted">{t.stats.rating(signed(rating))}</span>
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
  const t = useT();

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
          {t.stats.back}
        </button>
        <h2>{t.stats.title}</h2>
      </header>

      <div className="profile-stats">
        <div className="stat">
          <b>{profile.gamesPlayed}</b>
          <span>{t.stats.games}</span>
        </div>
        <div className="stat">
          <b>
            <span className="up">{profile.wins}</span> / <span className="down">{losses}</span>
          </b>
          <span>{t.stats.winsLosses(winRate)}</span>
        </div>
        <div className="stat">
          <b>
            <span className="up">+{profile.coinsWon}</span> / <span className="down">−{profile.coinsLost}</span>
          </b>
          <span>{t.stats.wonLostCoins}</span>
        </div>
        <div className="stat">
          <b>
            <Coins value={net} />
          </b>
          <span>{t.stats.net}</span>
        </div>
      </div>

      <h3 className="screen-subtitle">{t.stats.history}</h3>
      {matches === null ? (
        <p className="muted center">{t.stats.loading}</p>
      ) : matches.length === 0 ? (
        <p className="muted center">{t.stats.empty}</p>
      ) : (
        <ul className="history">
          {matches.map((m) => (
            <MatchRow key={m.matchId} match={m} />
          ))}
        </ul>
      )}
      {next && (
        <button disabled={loading} onClick={() => load(next)}>
          {t.stats.more}
        </button>
      )}
    </main>
  );
}
