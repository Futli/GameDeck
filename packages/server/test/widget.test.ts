import { describe, expect, it } from 'vitest';
import { DEFAULT_DICE_STYLE, DIE_SIZE, PLAYER_COLOR_HEX, SKIN_RARITIES, generateSkin } from '@gamedeck/shared';
import {
  buildWidgetHtml,
  encodeWidgetState,
  measureWidget,
  WIDGET_MAX_BYTES,
  WIDGET_MAX_PACKED,
  type WidgetSkins,
  type WidgetState,
} from '../src/widget/build.js';
import { diceFromSkin, diceFromStyle, flatDiceStyle, PIP_SPRITE } from '../src/widget/dice.js';
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

const skins: WidgetSkins = {
  mat: feltMat(),
  dice: diceFromStyle(DEFAULT_DICE_STYLE),
  cup: defaultCup(PLAYER_COLOR_HEX.red),
};

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
  it('любой сгенерированный коврик со стаканом и кубиками в цветах скина влезает в виджет: по отрезкам и по 4 КБ', () => {
    let fullDiceMisses = 0;
    for (const rarity of SKIN_RARITIES)
      for (let i = 0; i < 300; i++) {
        const mat = matFromSkin(generateSkin({ kind: 'mat', seed: i * 7919 + 3, rarity }).render(), '#ff2d3d');
        // Стакан и кубики той же редкости: все три эпических разом — самый тяжёлый случай.
        const cup = cupFromSkin(generateSkin({ kind: 'cup', seed: i * 104729 + 7, rarity }).render(), '#ff2d3d');
        const dice = { kind: 'dice' as const, seed: i * 31337 + 5, rarity };
        expect(() => assertValidMat(mat)).not.toThrow();
        expect(countMatRuns(mat)).toBeLessThan(MAT_MAX_RUNS * 0.97);
        // Запасной вариант (кубики двумя цветами скина) обязан влезать всегда: на нём держится WidgetService.html.
        const html = buildWidgetHtml({ mat, dice: diceFromStyle(flatDiceStyle(dice)), cup });
        expect(measureWidget(html).packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
        try {
          buildWidgetHtml({ mat, dice: diceFromSkin(dice), cup });
        } catch {
          // Не влезли кубики пиксель в пиксель — это допустимо только для эпической тройки.
          expect(rarity).toBe('epic');
          fullDiceMisses++;
        }
      }
    // И даже у эпической тройки кубики почти всегда рисуются как есть.
    expect(fullDiceMisses).toBeLessThan(300 * 0.05);
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

describe('кубики виджета', () => {
  it('скин кубиков: пустая грань — та же картинка, что у генератора, а точка ставится по сетке', () => {
    for (const rarity of SKIN_RARITIES) {
      const seed = { kind: 'dice' as const, seed: 42, rarity };
      const { face, pip } = diceFromSkin(seed);
      const blank = generateSkin(seed).render(0);
      expect(face.pixels).toBe(Array.from(blank.pixels, (c) => c.toString(16)).join(''));
      expect(face.pixels).toHaveLength(DIE_SIZE * DIE_SIZE);
      expect(pip.pixels).toHaveLength(PIP_SPRITE * PIP_SPRITE);
      // Точка нарисована (у кольца центр пустой, поэтому смотрим на весь спрайт), углы спрайта прозрачные.
      expect(pip.pixels).toMatch(/[1-9a-f]/);
      expect(pip.pixels[0]).toBe('0');
      expect(face.palette[0]).toBe('#0000');
    }
  });

  it('кубики в цветах скина берут цвет грани и точек из самого скина', () => {
    const style = flatDiceStyle({ kind: 'dice', seed: 42, rarity: 'common' });
    const { face } = diceFromSkin({ kind: 'dice', seed: 42, rarity: 'common' });
    expect(face.palette).toContain(style.face);
    expect(face.palette).toContain(style.pips);
    expect(style.face).not.toBe(style.pips);
  });

  it('три кубика укладываются в лимит команд canvas', () => {
    for (const rarity of SKIN_RARITIES)
      for (let i = 0; i < 100; i++) {
        const { face } = diceFromSkin({ kind: 'dice', seed: i * 31337 + 5, rarity });
        let runs = 0;
        for (let j = 0; j < face.pixels.length; j++)
          if (j % DIE_SIZE === 0 || face.pixels[j] !== face.pixels[j - 1]) runs++;
        // Три грани и до 18 точек по 25 пикселей — далеко от 4000 команд за задачу.
        expect(3 * runs + 18 * 25).toBeLessThan(MAT_MAX_RUNS / 2);
      }
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
