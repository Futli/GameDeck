import { games } from '@gamedeck/shared';
import { useT, type Messages } from '../i18n';

/** Название игры на языке интерфейса; у игры без перевода — название из реестра. */
export function gameTitle(gameId: string, t: Messages): string {
  return t.games[gameId]?.title ?? games[gameId]?.title ?? gameId;
}

const gameList = Object.values(games);

/** Выбор игры: карточки-кнопки. Новая игра в реестре shared появится здесь сама. */
export function GamePicker({ value, onChange }: { value: string; onChange: (gameId: string) => void }) {
  const t = useT();
  return (
    <div className="game-picker" role="radiogroup" aria-label={t.lobby.gameAria}>
      {gameList.map((game) => (
        <button
          key={game.id}
          type="button"
          role="radio"
          aria-checked={value === game.id}
          className={value === game.id ? 'game-option game-option--active' : 'game-option'}
          onClick={() => onChange(game.id)}
        >
          <b>{gameTitle(game.id, t)}</b>
          {t.games[game.id] && <span className="muted">{t.games[game.id]!.hint}</span>}
          <span className="muted">{t.lobby.playersRange(game.minPlayers, game.maxPlayers)}</span>
        </button>
      ))}
    </div>
  );
}

/** Игра по умолчанию для новой комнаты: последняя выбранная, иначе перудо. */
const GAME_KEY = 'gamedeck.game';
export function loadGameChoice(): string {
  try {
    const saved = localStorage.getItem(GAME_KEY);
    if (saved && games[saved]) return saved;
  } catch {
    // нет доступа к хранилищу — берём по умолчанию
  }
  return games.perudo ? 'perudo' : gameList[0]!.id;
}
export function saveGameChoice(gameId: string) {
  try {
    localStorage.setItem(GAME_KEY, gameId);
  } catch {
    // не страшно
  }
}
