import type { MyProfile } from '@gamedeck/shared';
import { useT } from '../i18n';
import { gameTitle } from './GamePicker';

/**
 * Статистика игрока на главном экране. Новичку показываем только баланс:
 * счётчики и рейтинг появятся после первой сыгранной партии. Рейтинг —
 * отдельная карточка на каждую игру, в которую игрок уже играл.
 */
export function ProfileStats({ profile }: { profile: MyProfile }) {
  const t = useT();
  return (
    <div className="profile-stats">
      <div className="stat">
        <b>{profile.coins}</b>
        <span>{t.profile.coins}</span>
      </div>
      {profile.gamesPlayed > 0 ? (
        <>
          {profile.ratings.map((r) => (
            <div key={r.gameId} className="stat">
              <b>{r.rating}</b>
              <span>{t.profile.rating(gameTitle(r.gameId, t))}</span>
            </div>
          ))}
          <div className="stat">
            <b>{profile.gamesPlayed}</b>
            <span>{t.profile.games}</span>
          </div>
          <div className="stat">
            <b>{profile.wins}</b>
            <span>{t.profile.wins}</span>
          </div>
          {/* Карточек нечётное число — последняя на всю ширину, чтобы сетка не зияла. */}
          <div
            className={profile.ratings.length % 2 === 1 ? 'stat stat--span' : 'stat'}
            title={t.profile.wonLost(profile.coinsWon, profile.coinsLost)}
          >
            <b>
              <span className="up">+{profile.coinsWon}</span> / <span className="down">−{profile.coinsLost}</span>
            </b>
            <span>{t.profile.stakeCoins}</span>
          </div>
        </>
      ) : (
        <div className="stat stat--wide muted">{t.profile.firstGame}</div>
      )}
    </div>
  );
}
