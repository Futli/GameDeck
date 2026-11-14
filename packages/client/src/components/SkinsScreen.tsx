import { PLAYER_COLOR_HEX, SKIN_KINDS, type SkinKind, type SkinView } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { http } from '../lib/socket';
import { skinImageUrl } from '../lib/skins';

/**
 * Цвет игрока на превью (нитка коврика, ободок стакана). За столом он свой у каждого,
 * а здесь стола ещё нет — берём синий, как у первого места.
 */
const PREVIEW_COLOR = PLAYER_COLOR_HEX.blue.main;

/** Картинка скина: коврик целиком, кубик пятёркой (видно и грань, и точки), стакан. */
export function SkinPreview({ skin }: { skin: SkinView }) {
  return (
    <img
      className={`skin-preview skin-preview--${skin.kind}`}
      src={skinImageUrl(skin, { playerColor: PREVIEW_COLOR, ...(skin.kind === 'dice' ? { value: 5 } : {}) })}
      alt=""
    />
  );
}

/**
 * «Мои скины»: по вкладке на каждый предмет стола. Нажатие на скин надевает его,
 * выбор сохраняется на сервере (skin_equipment) и виден всем за столом.
 * «Стандартный» снимает скин — предмет рисуется как раньше, цветом игрока.
 */
export function SkinsScreen({ onBack }: { onBack: () => void }) {
  const [skins, setSkins] = useState<SkinView[] | null>(null);
  const [kind, setKind] = useState<SkinKind>('mat');
  const [busy, setBusy] = useState(false);
  const t = useT();

  useEffect(() => {
    http<{ skins: SkinView[] }>('/api/me/skins')
      .then((r) => setSkins(r.skins))
      .catch(() => setSkins([]));
  }, []);

  const change = async (request: () => Promise<{ skins: SkinView[] }>) => {
    setBusy(true);
    try {
      setSkins((await request()).skins);
    } catch {
      // текст ошибки уже внизу экрана
    } finally {
      setBusy(false);
    }
  };

  const ofKind = skins?.filter((s) => s.kind === kind) ?? [];
  const equipped = ofKind.find((s) => s.equipped);

  return (
    <main className="screen">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          {t.skins.back}
        </button>
        <h2>{t.skins.title}</h2>
      </header>

      <div className="tabs" role="tablist">
        {SKIN_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === kind}
            className={k === kind ? 'tab tab--active' : 'tab'}
            onClick={() => setKind(k)}
          >
            {t.skins.kinds[k]}
            <span className="tab__count">{skins?.filter((s) => s.kind === k).length ?? ''}</span>
          </button>
        ))}
      </div>

      {skins === null ? (
        <p className="muted center">{t.skins.loading}</p>
      ) : (
        <div className="skin-grid">
          <button
            className={equipped ? 'skin-card' : 'skin-card skin-card--equipped'}
            disabled={busy || !equipped}
            onClick={() => change(() => http('/api/me/skins/unequip', { kind }))}
          >
            <span className="skin-card__default">{t.skins.playerColor}</span>
            <b>{t.skins.standard}</b>
            {!equipped && <span className="skin-card__badge">{t.skins.equipped}</span>}
          </button>
          {ofKind.map((skin) => (
            <button
              key={skin.id}
              className={`skin-card skin-card--${skin.rarity}${skin.equipped ? ' skin-card--equipped' : ''}`}
              disabled={busy || skin.equipped}
              onClick={() => change(() => http(`/api/skins/${skin.id}/equip`, {}))}
            >
              <SkinPreview skin={skin} />
              <b>{skin.name}</b>
              <span className="muted">
                {t.skins.rarities[skin.rarity]} · {t.skins.serial(skin.serial)}
              </span>
              {skin.equipped && <span className="skin-card__badge">{t.skins.equipped}</span>}
            </button>
          ))}
        </div>
      )}

      {skins !== null && ofKind.length === 0 && <p className="muted center">{t.skins.empty(kind)}</p>}
    </main>
  );
}
