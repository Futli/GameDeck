import type { PerudoView, PlayerView } from '@gamedeck/shared';
import { Die } from '../Die';
import { Cup } from './Cup';
import { useT } from '../../i18n';
import { matchesBid, shownReveal } from './view';

/**
 * Что лежит на коврике в перудо: свои кубики, чужой стакан с числом кубиков
 * или, после «Не верю!»/«Точно!», открытые кубики всех игроков.
 */
export function PerudoMat({ view, player, myId }: { view: PerudoView; player: PlayerView; myId: string }) {
  const reveal = shownReveal(view);
  const t = useT();
  const revealed = reveal?.dice[player.id];

  if (reveal && revealed && revealed.length > 0) {
    const lost = reveal.loserId === player.id;
    const gained = reveal.gainerId === player.id;
    return (
      <div className="pd-mat">
        <div className="pd-dice">
          {revealed.map((value, i) => (
            <span key={i} className={matchesBid(value, reveal.bid.face, reveal.palifico) ? 'pd-hit' : 'pd-miss'}>
              <Die value={value} size={21} style={player.dice} skin={player.skins.dice} />
            </span>
          ))}
        </div>
        {(lost || gained) && (
          <span className={lost ? 'pd-badge pd-badge--bad' : 'pd-badge pd-badge--good'}>{lost ? '−1' : '+1'}</span>
        )}
      </div>
    );
  }

  const hand = view.hands[player.id];
  if (!hand || hand.count === 0) return <div className="pd-mat muted">{t.perudo.out}</div>;

  if (player.id === myId && hand.dice) {
    return (
      <div className="pd-mat">
        <div className="pd-dice">
          {hand.dice.map((value, i) => (
            <Die key={i} value={value} size={21} style={player.dice} skin={player.skins.dice} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pd-mat pd-mat--cup">
      <Cup color={player.color} skin={player.skins.cup} />
      <span className="pd-count">×{hand.count}</span>
    </div>
  );
}
