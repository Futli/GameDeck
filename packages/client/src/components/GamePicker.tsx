import type { MyProfile } from '@gamedeck/shared';
import { games } from '@gamedeck/shared';
import { useT, type Messages } from '../i18n';

/** Название игры на языке интерфейса; у игры без перевода — название из реестра. */
export function gameTitle(gameId: string, t: Messages): string {
  return t.games[gameId]?.title ?? games[gameId]?.title ?? gameId;
}

const gameList = Object.values(games);

/**
 * Выбор игры на главной: карточка на каждую игру из реестра shared, новая игра появится здесь сама.
 * На карточке — рейтинг игрока в этой игре: он у каждой игры свой и не складывается с другими.
 */
export function GameCards({ profile, onPick }: { profile: MyProfile | null; onPick: (gameId: string) => void }) {
  const t = useT();
  return (
    <div className="game-cards" role="list" aria-label={t.lobby.gameAria}>
      {gameList.map((game) => {
        const rating = profile?.ratings.find((r) => r.gameId === game.id);
        return (
          <button key={game.id} type="button" role="listitem" className="game-card" onClick={() => onPick(game.id)}>
            <span className="game-card__text">
              <b>{gameTitle(game.id, t)}</b>
              {t.games[game.id] && <span className="muted">{t.games[game.id]!.hint}</span>}
              <span className="muted">{t.lobby.playersRange(game.minPlayers, game.maxPlayers)}</span>
            </span>
            <span className="game-card__rating">
              <b>{rating ? rating.rating : '—'}</b>
              <span className="muted">{rating ? t.lobby.rating : t.lobby.noRating}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
