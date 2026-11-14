import { describe, expect, it } from 'vitest';
import { DEFAULT_DICE_STYLE, PLAYER_COLOR_HEX, SKIN_RARITIES, generateSkin } from '@gamedeck/shared';
import {
  buildWidgetHtml,
  encodeWidgetState,
  measureWidget,
  WIDGET_MAX_BYTES,
  WIDGET_MAX_PACKED,
  type WidgetSkins,
  type WidgetState,
} from '../src/widget/build.js';
import {
  assertValidMat,
  countMatRuns,
  cupFromSkin,
  defaultCup,
  feltMat,
  matFromSkin,
  MAT_HEIGHT,
  MAT_MAX_RUNS,
  MAT_WIDTH,
  type MatSkin,
} from '../src/widget/mat.js';

const skins: WidgetSkins = { mat: feltMat(), dice: DEFAULT_DICE_STYLE, cup: defaultCup(PLAYER_COLOR_HEX.red) };

/** Самый дорогой для сжатия коврик из допустимых: 16 цветов без повторяющегося рисунка. */
function noisyMat(): MatSkin {
  const palette = Array.from({ length: 16 }, (_, i) => `#${(i * 0x111111).toString(16).padStart(6, '0')}`);
  let seed = 1;
  let pixels = '';
  while (pixels.length < MAT_WIDTH * MAT_HEIGHT) {
    seed = (seed * 48271) % 2147483647;
    // Отрезки по 4 пикселя: случайный цвет, но число команд рисования в лимите.
    pixels += (Math.floor(seed / 65536) % 16).toString(16).repeat(4);
  }
  return { palette, pixels };
}

describe('коврик виджета', () => {
  it('любой сгенерированный коврик со стаканом влезает в виджет: по отрезкам и по 4 КБ после сжатия', () => {
    for (const rarity of SKIN_RARITIES)
      for (let i = 0; i < 300; i++) {
        const mat = matFromSkin(generateSkin({ kind: 'mat', seed: i * 7919 + 3, rarity }).render(), '#ff2d3d');
        // Стакан той же редкости: эпические коврик и стакан вместе — самый тяжёлый случай.
        const cup = cupFromSkin(generateSkin({ kind: 'cup', seed: i * 104729 + 7, rarity }).render(), '#ff2d3d');
        expect(() => assertValidMat(mat)).not.toThrow();
        expect(countMatRuns(mat)).toBeLessThan(MAT_MAX_RUNS * 0.97);
        const html = buildWidgetHtml({ mat, dice: DEFAULT_DICE_STYLE, cup });
        expect(measureWidget(html).packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
      }
  });

  it('коврик по умолчанию проходит проверку и укладывается в лимит команд canvas', () => {
    const mat = feltMat();
    expect(() => assertValidMat(mat)).not.toThrow();
    expect(countMatRuns(mat)).toBeLessThan(MAT_MAX_RUNS);
  });

  it('отклоняет коврик не того размера, с пикселем вне палитры и с плохим цветом', () => {
    const mat = feltMat();
    expect(() => assertValidMat({ ...mat, pixels: mat.pixels.slice(1) })).toThrow();
    expect(() => assertValidMat({ ...mat, pixels: 'f' + mat.pixels.slice(1) })).toThrow();
    expect(() => assertValidMat({ ...mat, palette: ['red'] })).toThrow();
  });

  it('отклоняет слишком пёстрый коврик', () => {
    const pixels = Array.from({ length: MAT_WIDTH * MAT_HEIGHT }, (_, i) => i % 2).join('');
    expect(() => assertValidMat({ palette: ['#000000', '#ffffff'], pixels })).toThrow(/пёстрый/);
  });
});

describe('сборка HTML виджета', () => {
  it('укладывается в лимиты Telegram', () => {
    const { bytes, packed } = measureWidget(buildWidgetHtml(skins));
    expect(bytes).toBeLessThanOrEqual(WIDGET_MAX_BYTES);
    expect(packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
  });

  it('подставляет скины и не оставляет комментариев', () => {
    const html = buildWidgetHtml(skins);
    expect(html).not.toContain('__CFG__');
    expect(html).toContain(skins.mat.pixels);
    expect(html).toContain(skins.cup.pixels);
    expect(html).not.toMatch(/^\s*\/\//m);
  });

  it('на английском: все надписи переведены и виджет влезает в лимит', () => {
    const html = buildWidgetHtml(skins, 'en');
    expect(html).not.toMatch(/[А-Яа-яЁё]/);
    expect(html).not.toMatch(/@\w+@/);
    expect(html).toContain('Re-roll');
    expect(measureWidget(html).packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
  });

  it('не использует то, чего в виджете нет: сеть, внешние ресурсы, поля ввода', () => {
    const html = buildWidgetHtml(skins);
    for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'src=', '<input', 'addEventListener']) {
      expect(html).not.toContain(banned);
    }
  });

  it('отклоняет виджет, который не влезает в лимит, а не отправляет его как есть', () => {
    expect(() => buildWidgetHtml({ ...skins, mat: noisyMat() })).toThrow(/не влезает/);
  });

  it('отклоняет состояние больше 1 КБ', () => {
    const state: WidgetState = { r: 3, n: 0, t: 60, b: 500, a: 0, m: 0, u: 0 };
    expect(encodeWidgetState(state).length).toBeLessThan(200);
    expect(() => encodeWidgetState({ ...state, p: 'я'.repeat(600) })).toThrow();
  });
});
