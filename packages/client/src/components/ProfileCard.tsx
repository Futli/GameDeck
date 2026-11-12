import type { MyProfile } from '@gamedeck/shared';

/**
 * Статистика игрока на главном экране. Новичку показываем только баланс:
 * счётчики появятся после первой сыгранной партии.
 */
export function ProfileStats({ profile }: { profile: MyProfile }) {
  return (
    <div className="profile-stats">
      <div className="stat">
        <b>{profile.coins}</b>
        <span>монет</span>
      </div>
      {profile.gamesPlayed > 0 ? (
        <>
          <div className="stat">
            <b>{profile.gamesPlayed}</b>
            <span>игр</span>
          </div>
          <div className="stat">
            <b>{profile.wins}</b>
            <span>побед</span>
          </div>
          <div className="stat" title={`Выиграно ${profile.coinsWon}, проиграно ${profile.coinsLost}`}>
            <b>
              <span className="up">+{profile.coinsWon}</span> / <span className="down">−{profile.coinsLost}</span>
            </b>
            <span>монет на ставках</span>
          </div>
        </>
      ) : (
        <div className="stat stat--wide muted">Сыграйте первую партию — здесь появится статистика</div>
      )}
    </div>
  );
}
