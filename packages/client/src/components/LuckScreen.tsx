import { generateSkin, type SkinView } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { http } from '../lib/socket';
import { useClientState } from '../lib/store';
import { luckChatLink, openTelegramLink } from '../lib/telegram';
import { SkinPreview } from './SkinsScreen';

/**
 * Призы и правила «Кубика удачи»: сюда ведёт «Подробнее» из окна приза в виджете (на главной или в чате).
 * С выпавшим скином (skinId) — сначала его карточка с кнопкой «Надеть», дальше правила,
 * таблица призов и модификаторы: что они делают и как ими пользоваться.
 */
export function LuckScreen({
  skinId,
  onBack,
  onSkins,
}: {
  skinId: string | null;
  onBack: () => void;
  onSkins: () => void;
}) {
  const t = useT();
  const profile = useClientState((s) => s.profile);
  const telegramAppUrl = useClientState((s) => s.telegramAppUrl);
  // Кнопка «Открыть виджет в чате» — только когда бот его туда присылает (TELEGRAM_CHAT_WIDGET).
  const chatWidget = useClientState((s) => s.chatWidget);
  // undefined — приз ещё грузится, null — приза нет (или не загрузился).
  const [prize, setPrize] = useState<{ skin: SkinView; ownerId: string } | null | undefined>(skinId ? undefined : null);
  const [busy, setBusy] = useState(false);
  const chat = chatWidget ? luckChatLink(telegramAppUrl) : null;

  useEffect(() => {
    if (!skinId) return;
    http<{ skin: SkinView; ownerId: string }>(`/api/skins/${skinId}`)
      .then(setPrize)
      .catch(() => setPrize(null));
  }, [skinId]);

  const equip = async () => {
    if (!prize) return;
    setBusy(true);
    try {
      const { skins } = await http<{ skins: SkinView[] }>(`/api/skins/${prize.skin.id}/equip`, {});
      setPrize({ ...prize, skin: skins.find((s) => s.id === prize.skin.id) ?? prize.skin });
    } catch {
      // текст ошибки уже внизу экрана
    } finally {
      setBusy(false);
    }
  };

  const mine = prize != null && profile !== null && prize.ownerId === profile.id;
  // Пока приз грузится, правила ниже не показываем: карточка приза встаёт над ними, и без этого
  // весь текст прыгал бы вниз у игрока на глазах. Приходит ответ — всё проявляется разом.
  const waiting = prize === undefined;

  return (
    <main className={waiting ? 'screen luck luck--waiting' : 'screen luck'}>
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          {t.luck.back}
        </button>
        <h2>{t.luck.title}</h2>
      </header>

      {prize && (
        <section className={`luck-prize skin-card--${prize.skin.rarity}`}>
          <span className="luck-prize__label">{t.luck.prize}</span>
          <SkinPreview skin={prize.skin} />
          <b>
            {prize.skin.name} #{prize.skin.serial}
          </b>
          {/* Признаки, как атрибуты NFT: качество, цвет, стиль, рамка. Всегда по-английски, как и название. */}
          <dl className="traits">
            {generateSkin(prize.skin).traits.map(({ trait, value }) => (
              <div key={trait}>
                <dt>{trait}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">{mine ? t.luck.prizeFrom : t.luck.notYours}</p>
          {mine && (
            <div className="profile-links">
              <button className="primary" disabled={busy || prize.skin.equipped} onClick={() => void equip()}>
                {prize.skin.equipped ? t.luck.equipped : t.luck.equip}
              </button>
              <button onClick={onSkins}>{t.luck.toSkins}</button>
            </div>
          )}
        </section>
      )}

      <section className="luck-section">
        <h3>{t.luck.modifiersTitle}</h3>
        <div className="luck-modifier">
          <b>⟳ {t.luck.rerollName}</b>
          <p>{t.luck.rerollWhat}</p>
          <ol>
            {t.luck.rerollHow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="muted">{t.luck.rerollRules}</p>
        </div>
      </section>

      <section className="luck-section">
        <h3>{t.luck.prizesTitle}</h3>
        <table className="luck-prizes">
          <tbody>
            {t.luck.prizes.map(([combo, reward]) => (
              <tr key={combo}>
                <td>{combo}</td>
                <td>{reward}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="luck-section">
        <h3>{t.luck.howTitle}</h3>
        <ul>
          {t.luck.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {chat && (
        <>
          <button className="primary" onClick={() => openTelegramLink(chat)}>
            {t.luck.openChat}
          </button>
          <p className="muted center">{t.luck.lostWidget}</p>
        </>
      )}
    </main>
  );
}
