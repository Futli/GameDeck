import type { RoomView } from '@gamedeck/shared';
import { dismissTip, setTutorialEnabled, useTutorial } from '../../lib/tutorial';
import { useTutorialTexts, type HintId } from './texts';
import { pickTip, tipParams } from './tips';

/**
 * Карточка-наставник над кнопками хода: объясняет правило, которое нужно прямо сейчас.
 * Одна подсказка за раз; «Понятно» убирает её, и при следующей ситуации появится новая.
 */
export function Coach({ room, myId }: { room: RoomView; myId: string }) {
  const { enabled, seen } = useTutorial();
  const texts = useTutorialTexts();
  if (!enabled) return null;
  const id = pickTip(room, myId, seen);
  if (!id) return null;

  const tip = texts.tips[id];
  return (
    <section className="coach" role="status" aria-live="polite">
      <h3 className="coach-title">{tip.title}</h3>
      <p className="coach-body">{tip.body(tipParams(room))}</p>
      <div className="coach-actions">
        <button className="primary" onClick={() => dismissTip(id)}>
          {texts.ui.gotIt}
        </button>
        <button className="ghost" onClick={() => setTutorialEnabled(false)}>
          {texts.ui.turnOff}
        </button>
      </div>
    </section>
  );
}

/** Кнопка «?» в шапке комнаты: включает обучение заново или выключает его. */
export function TutorialToggle() {
  const { enabled } = useTutorial();
  const texts = useTutorialTexts();
  return (
    <button
      className={enabled ? 'ghost tutorial-toggle tutorial-toggle--on' : 'ghost tutorial-toggle'}
      aria-pressed={enabled}
      aria-label={texts.ui.toggle}
      title={texts.hints['tutorial-toggle']}
      onClick={() => setTutorialEnabled(!enabled)}
    >
      ?
    </button>
  );
}

/** Подпись под кнопкой: что она делает. Видна только в режиме обучения. */
export function Hint({ id }: { id: HintId }) {
  const { enabled } = useTutorial();
  const texts = useTutorialTexts();
  if (!enabled) return null;
  return <small className="hint">{texts.hints[id]}</small>;
}
