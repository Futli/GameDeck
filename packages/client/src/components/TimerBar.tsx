import { useT } from '../i18n';
import { useMsLeft } from '../lib/countdown';

/** Полоска оставшегося времени с секундами. Последние 10 секунд — красная. */
export function TimerBar({ msLeft, total, label }: { msLeft: number | null; total: number; label?: string }) {
  const t = useT();
  const left = useMsLeft(msLeft);
  if (left === null) return null;
  const seconds = Math.ceil(left / 1000);
  return (
    <div className={seconds <= 10 ? 'timer timer--low' : 'timer'}>
      <div className="timer-track">
        <div className="timer-fill" style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
      </div>
      <span className="timer-text">
        {label && `${label} · `}
        {t.flow.seconds(seconds)}
      </span>
    </div>
  );
}
