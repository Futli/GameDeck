import type { ReactNode } from 'react';

/**
 * Всплывающее окно снизу экрана. Стол над ним остаётся виден: после «Не верю!»
 * все должны видеть открытые кубики, пока решают, что делать дальше.
 * late — окно появляется с задержкой, чтобы сначала доиграла анимация на столе.
 */
export function Sheet({ title, late, children }: { title: ReactNode; late?: boolean; children: ReactNode }) {
  return (
    <div className={late ? 'sheet-backdrop sheet-backdrop--late' : 'sheet-backdrop'}>
      <section className={late ? 'sheet sheet--late' : 'sheet'} role="dialog" aria-modal="true">
        <h2 className="sheet-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}
