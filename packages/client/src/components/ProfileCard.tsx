import type { MyProfile } from '@gamedeck/shared';
import { useT } from '../i18n';

/**
 * Статистика игрока на главном экране. Новичку показываем только баланс:
 * счётчики появятся после первой сыгранной партии.
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
          <div className="stat">
            <b>{profile.gamesPlayed}</b>
            <span>{t.profile.games}</span>
          </div>
          <div className="stat">
            <b>{profile.wins}</b>
            <span>{t.profile.wins}</span>
          </div>
          <div className="stat" title={t.profile.wonLost(profile.coinsWon, profile.coinsLost)}>
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
