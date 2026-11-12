import { ROOM_TIMEOUTS, type PerudoView, type RoomView } from '@gamedeck/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/socket';
import { Die } from '../Die';
import { Cup } from '../perudo/Cup';
import { bidText } from '../perudo/view';
import { TimerBar } from '../TimerBar';
import { Sheet } from './Sheet';

const ignore = () => {};
/** Столько трясётся стакан — как в виджете «Кубик удачи». */
const SHAKE_MS = 700;

/** Чем кончился прошлый раунд. Проигравший кубик видит тряску и «−1», получивший — «+1». */
function RoundResult({
  view,
  myId,
  nameOf,
}: {
  view: PerudoView;
  myId: string;
  nameOf: (id: string | null) => string;
}) {
  const reveal = view.lastReveal;
  if (!reveal) return null;
  const mine = reveal.loserId === myId ? 'lose' : reveal.gainerId === myId ? 'gain' : null;
  return (
    <div className={mine ? `round-result round-result--${mine}` : 'round-result'}>
      <div>
        <b>{nameOf(reveal.callerId)}</b>: {reveal.call === 'dudo' ? '«Не верю!»' : '«Точно!»'} Ставка{' '}
        {bidText(reveal.bid.quantity, reveal.bid.face)}, нашлось {reveal.actual}.
      </div>
      <div className="round-result-line">
        {reveal.loserId && (
          <>
            Кубик теряет <b>{nameOf(reveal.loserId)}</b> <span className="pd-badge pd-badge--bad">−1</span>
          </>
        )}
        {reveal.gainerId && (
          <>
            Кубик получает <b>{nameOf(reveal.gainerId)}</b> <span className="pd-badge pd-badge--good">+1</span>
          </>
        )}
        {!reveal.loserId && !reveal.gainerId && 'Никто не теряет кубик'}
      </div>
    </div>
  );
}

/**
 * Начало раунда перудо: каждый сам трясёт стакан кнопкой «Бросить». Нажал — ждёшь
 * остальных; кто не бросит до конца таймера, выходит из комнаты, играем без него.
 */
export function RollModal({ room, view, myId }: { room: RoomView; view: PerudoView; myId: string }) {
  const me = room.players.find((p) => p.id === myId);
  const hand = view.hands[myId];
  const rolled = view.rolled.includes(myId);
  const [shaking, setShaking] = useState(false);
  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? '—';
  const active = room.players.filter((p) => (view.hands[p.id]?.count ?? 0) > 0);

  // Стакан трясётся не меньше SHAKE_MS, даже если сервер ответил быстрее.
  useEffect(() => {
    if (!shaking) return;
    const id = setTimeout(() => setShaking(false), SHAKE_MS);
    return () => clearTimeout(id);
  }, [shaking]);

  const roll = () => {
    setShaking(true);
    void api.roll().catch(ignore);
  };

  return (
    <Sheet title={`Раунд ${view.round}`}>
      {view.round > 1 && <RoundResult view={view} myId={myId} nameOf={nameOf} />}
      {view.maputo && (
        <p className="maputo-note">Мапуто: единицы не джокеры, номинал после первой ставки не меняется</p>
      )}

      {me && hand && hand.count > 0 ? (
        <div className="roll-stage">
          {rolled && !shaking && hand.dice ? (
            <div className="pd-dice roll-dice">
              {hand.dice.map((v, i) => (
                <span key={i} style={{ animationDelay: `${i * 60}ms` }}>
                  <Die value={v} size={42} style={me.dice} skin={me.skins.dice} />
                </span>
              ))}
            </div>
          ) : (
            <div className={shaking ? 'roll-cup roll-cup--shake' : 'roll-cup'}>
              <Cup color={me.color} size={64} skin={me.skins.cup} />
              <span className="pd-count">×{hand.count}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="muted center">Вы выбыли — смотрим, кто победит</p>
      )}

      <ul className="ready-list ready-list--inline">
        {active.map((p) => (
          <li key={p.id} className={view.rolled.includes(p.id) ? 'ready-item ready-item--yes' : 'ready-item'}>
            <span className="ready-name">{p.name}</span>
            <span className="ready-status">{view.rolled.includes(p.id) ? '✓' : '…'}</span>
          </li>
        ))}
      </ul>

      <TimerBar msLeft={room.game?.msLeft ?? null} total={ROOM_TIMEOUTS.roll} label="Не бросил — выбыл" />

      <div className="sheet-actions">
        {hand && hand.count > 0 && !rolled && (
          <button className="primary big" disabled={shaking} onClick={roll}>
            Бросить кубики
          </button>
        )}
        {rolled && !shaking && <p className="muted center">Ждём, пока бросят остальные…</p>}
      </div>
    </Sheet>
  );
}
