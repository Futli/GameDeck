import type { PerudoView } from '@gamedeck/shared';
import { Die } from '../Die';
import { useT } from '../../i18n';
import { shownReveal } from './view';

/** Центр стола в перудо: раунд, действующая ставка, итог последнего вскрытия. */
export function PerudoCenter({ view, nameOf }: { view: PerudoView; nameOf: (id: string | null) => string }) {
  const bid = view.bids.at(-1);
  const reveal = shownReveal(view);
  const t = useT();

  return (
    <>
      <div className="round">
        {t.perudo.round(view.round)}
        {view.maputo && !view.winnerId && <span className="pd-maputo"> · {t.perudo.maputo}</span>}
      </div>
      <div className="muted">{t.perudo.diceOnTable(view.totalDice)}</div>

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
            <b>{nameOf(reveal.callerId)}</b>: {reveal.call === 'dudo' ? t.perudo.dudo : t.perudo.calza}
          </div>
          <div className="muted">
            {t.perudo.revealed(t.perudo.bidText(reveal.bid.quantity, reveal.bid.face), reveal.actual)}
          </div>
          <div>
            {reveal.loserId && (
              <>
                {t.perudo.loses} <b>{nameOf(reveal.loserId)}</b>
              </>
            )}
            {reveal.gainerId && (
              <>
                {t.perudo.gains} <b>{nameOf(reveal.gainerId)}</b>
              </>
            )}
            {!reveal.loserId && !reveal.gainerId && t.perudo.nobodyLoses}
          </div>
        </div>
      )}

      {!view.winnerId && view.phase === 'roll' && <div>{t.perudo.allRolling}</div>}
      {!view.winnerId && view.phase === 'bid' && view.turnId && (
        <div>
          {t.table.turn} <b>{nameOf(view.turnId)}</b>
        </div>
      )}
    </>
  );
}
