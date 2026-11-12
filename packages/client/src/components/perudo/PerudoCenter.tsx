import type { PerudoView } from '@gamedeck/shared';
import { Die } from '../Die';
import { bidText, shownReveal } from './view';

/** Центр стола в перудо: раунд, действующая ставка, итог последнего вскрытия. */
export function PerudoCenter({ view, nameOf }: { view: PerudoView; nameOf: (id: string | null) => string }) {
  const bid = view.bids.at(-1);
  const reveal = shownReveal(view);

  return (
    <>
      <div className="round">
        Раунд {view.round}
        {view.palifico && !view.winnerId && <span className="pd-palifico"> · палифико</span>}
      </div>
      <div className="muted">На столе {view.totalDice} куб.</div>

      {bid && (
        <div className="pd-bid">
          <span className="muted">{nameOf(bid.playerId)}:</span>
          <b>{bid.quantity} ×</b>
          <Die value={bid.face} size={21} />
        </div>
      )}

      {reveal && (
        <div className="pd-reveal">
          <div>
            <b>{nameOf(reveal.callerId)}</b>: {reveal.call === 'dudo' ? '«Не верю!»' : '«Точно!»'}
          </div>
          <div className="muted">
            Ставка {bidText(reveal.bid.quantity, reveal.bid.face)}, нашлось {reveal.actual}
          </div>
          <div>
            {reveal.loserId && (
              <>
                Кубик теряет <b>{nameOf(reveal.loserId)}</b>
              </>
            )}
            {reveal.gainerId && (
              <>
                Кубик получает <b>{nameOf(reveal.gainerId)}</b>
              </>
            )}
            {!reveal.loserId && !reveal.gainerId && 'Никто не теряет кубик'}
          </div>
        </div>
      )}

      {!view.winnerId && view.turnId && (
        <div>
          Ходит: <b>{nameOf(view.turnId)}</b>
        </div>
      )}
    </>
  );
}
