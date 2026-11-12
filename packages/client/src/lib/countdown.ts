import { useEffect, useMemo, useState } from 'react';

/**
 * Сколько миллисекунд осталось до дедлайна. Сервер присылает не момент времени,
 * а «осталось N мс» на момент отправки: так часы клиента и сервера не обязаны
 * совпадать. Отсчёт идёт от получения состояния и тикает четыре раза в секунду.
 */
export function useMsLeft(msLeft: number | null): number | null {
  // Новое состояние с сервера (новое msLeft) — пересчитываем дедлайн по своим часам.
  const deadline = useMemo(() => (msLeft === null ? null : Date.now() + msLeft), [msLeft]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - Math.max(now, Date.now() - 250));
}
