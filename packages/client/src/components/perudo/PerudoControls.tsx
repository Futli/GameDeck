import { assertValidRaise, type PerudoBid, type PerudoView, type PlayerView } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/socket';
import { Die } from '../Die';
import { Hint } from '../tutorial/Coach';
import { bidText, shownReveal } from './view';

const ignore = () => {};

/** Ставка проходит по правилам? Те же правила, что на сервере (общий код из shared). */
function isValid(prev: PerudoBid | null, quantity: number, face: number, view: PerudoView): boolean {
  if (quantity < 1 || quantity > view.totalDice) return false;
  try {
    assertValidRaise(prev, { quantity, face }, view.palifico);
    return true;
  } catch {
    return false;
  }
}

/** Самая маленькая допустимая ставка на этот номинал — с неё удобно начинать. */
function minQuantity(prev: PerudoBid | null, face: number, view: PerudoView): number {
  for (let q = 1; q <= view.totalDice; q++) if (isValid(prev, q, face, view)) return q;
  return view.totalDice;
}

/** Ход в перудо: выбрать количество и номинал, или «Не верю!» / «Точно!». */
export function PerudoControls({
  view,
  me,
  myTurn,
}: {
  view: PerudoView;
  me: PlayerView | undefined;
  myTurn: boolean;
}) {
  const prev = view.bids.at(-1) ?? null;
  const startFace = prev && prev.face !== 1 ? prev.face : prev ? 1 : 2;
  const [face, setFace] = useState(startFace);
  const [quantity, setQuantity] = useState(() => minQuantity(prev, startFace, view));
  const [busy, setBusy] = useState(false);

  // Новая ставка на столе или новый раунд — подставляем ближайшую допустимую.
  const key = `${view.round}:${view.bids.length}`;
  useEffect(() => {
    setFace(startFace);
    setQuantity(minQuantity(prev, startFace, view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const send = (move: Parameters<typeof api.move>[0]) => {
    setBusy(true);
    void api
      .move(move)
      .catch(ignore)
      .finally(() => setBusy(false));
  };

  const pickFace = (f: number) => {
    setFace(f);
    if (!isValid(prev, quantity, f, view)) setQuantity(minQuantity(prev, f, view));
  };

  const myHand = view.hands[me?.id ?? '']?.dice;
  const reveal = shownReveal(view);
  const valid = isValid(prev, quantity, face, view);
  const faceLocked = view.palifico && prev !== null;

  return (
    <div className="pd-controls">
      {reveal && myHand && myHand.length > 0 && (
        <div className="pd-hand">
          <span className="muted">Ваши кубики в новом раунде:</span>
          <div className="pd-dice">
            {myHand.map((v, i) => (
              <Die key={i} value={v} size={28} style={me?.dice} skin={me?.skins.dice} />
            ))}
          </div>
        </div>
      )}

      {myHand === null || myHand?.length === 0 ? (
        <p className="muted center">Вы выбыли — смотрим, кто победит</p>
      ) : myTurn ? (
        <>
          <div className="pd-faces" role="radiogroup" aria-label="Номинал">
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={face === f}
                className={face === f ? 'pd-face pd-face--active' : 'pd-face'}
                disabled={busy || (faceLocked && f !== prev!.face) || (!prev && f === 1 && !view.palifico)}
                onClick={() => pickFace(f)}
              >
                <Die value={f} size={28} style={me?.dice} skin={me?.skins.dice} />
              </button>
            ))}
          </div>
          <Hint id="faces" />
          <div className="pd-stepper">
            <button type="button" disabled={busy || quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
              −
            </button>
            <span className="pd-quantity">{quantity}</span>
            <button
              type="button"
              disabled={busy || quantity >= view.totalDice}
              onClick={() => setQuantity(quantity + 1)}
            >
              +
            </button>
          </div>
          <Hint id="quantity" />
          <button
            className="primary big"
            disabled={busy || !valid}
            onClick={() => send({ type: 'bid', quantity, face })}
          >
            Ставка: {bidText(quantity, face)}
          </button>
          <Hint id="bid" />
          {prev && (
            <div className="pd-calls">
              <button className="pd-dudo" disabled={busy} onClick={() => send({ type: 'dudo' })}>
                Не верю!
              </button>
              <button
                disabled={busy || view.palifico}
                onClick={() => send({ type: 'calza' })}
                title={view.palifico ? 'В палифико нельзя' : ''}
              >
                Точно!
              </button>
            </div>
          )}
          {prev && <Hint id="dudo" />}
          {prev && !view.palifico && <Hint id="calza" />}
          {view.palifico && (
            <p className="muted center">Палифико: единицы не джокеры{prev ? ', номинал менять нельзя' : ''}</p>
          )}
        </>
      ) : (
        <p className="muted center">Ждём ход другого игрока</p>
      )}
    </div>
  );
}
