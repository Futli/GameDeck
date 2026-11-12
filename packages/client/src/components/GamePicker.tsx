import { games } from '@gamedeck/shared';

/** Коротко о правилах — чтобы было понятно, что выбираешь. */
const GAME_HINTS: Record<string, string> = {
  'dice-high': 'Каждый бросает кубик, у кого больше — тот выиграл',
  perudo: 'Кубики под стаканом, ставки на весь стол и «Не верю!»',
};

const gameList = Object.values(games);

/** Выбор игры: карточки-кнопки. Новая игра в реестре shared появится здесь сама. */
export function GamePicker({ value, onChange }: { value: string; onChange: (gameId: string) => void }) {
  return (
    <div className="game-picker" role="radiogroup" aria-label="Игра">
      {gameList.map((game) => (
        <button
          key={game.id}
          type="button"
          role="radio"
          aria-checked={value === game.id}
          className={value === game.id ? 'game-option game-option--active' : 'game-option'}
          onClick={() => onChange(game.id)}
        >
          <b>{game.title}</b>
          {GAME_HINTS[game.id] && <span className="muted">{GAME_HINTS[game.id]}</span>}
          <span className="muted">
            {game.minPlayers}–{game.maxPlayers} игроков
          </span>
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
