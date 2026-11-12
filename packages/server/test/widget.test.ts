import { describe, expect, it } from 'vitest';
import { DEFAULT_DICE_STYLE, SKIN_RARITIES, WIDGET_MAX_STORED_ROLLS, generateSkin } from '@gamedeck/shared';
import {
  buildWidgetHtml,
  encodeWidgetState,
  measureWidget,
  WIDGET_MAX_BYTES,
  WIDGET_MAX_PACKED,
  type WidgetLinks,
  type WidgetSkins,
} from '../src/widget/build.js';
import { createDemoPlayer, demoState, playDemoRoll } from '../src/widget/demo.js';
import { assertValidMat, countMatRuns, feltMat, matFromSkin, MAT_MAX_RUNS, type MatSkin } from '../src/widget/mat.js';

const skins: WidgetSkins = { mat: feltMat(), dice: DEFAULT_DICE_STYLE, cup: 'red' };
const links: WidgetLinks = {
  invite: 'https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fexample_bot',
  ad: 'https://t.me/example_bot/play?startapp=ad',
  findGame: 'https://t.me/example_bot/play',
};

/** Самый дорогой для сжатия коврик из допустимых: 16 цветов без повторяющегося рисунка. */
function noisyMat(): MatSkin {
  const palette = Array.from({ length: 16 }, (_, i) => `#${(i * 0x111111).toString(16).padStart(6, '0')}`);
  let seed = 1;
  let pixels = '';
  while (pixels.length < 128 * 64) {
    seed = (seed * 48271) % 2147483647;
    // Отрезки по 4 пикселя: случайный цвет, но число команд рисования в лимите.
    pixels += (Math.floor(seed / 65536) % 16).toString(16).repeat(4);
  }
  return { palette, pixels };
}

describe('коврик виджета', () => {
  it('любой сгенерированный коврик влезает в виджет с запасом по отрезкам', () => {
    for (const rarity of SKIN_RARITIES)
      for (let i = 0; i < 200; i++) {
        const mat = matFromSkin(generateSkin({ kind: 'mat', seed: i * 7919 + 3, rarity }).render(), '#ff2d3d');
        expect(() => assertValidMat(mat)).not.toThrow();
        expect(countMatRuns(mat)).toBeLessThan(MAT_MAX_RUNS * 0.95);
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
    const pixels = Array.from({ length: 128 * 64 }, (_, i) => i % 2).join('');
    expect(() => assertValidMat({ palette: ['#000000', '#ffffff'], pixels })).toThrow(/пёстрый/);
  });
});

describe('сборка HTML виджета', () => {
  it('укладывается в лимиты Telegram', () => {
    const { bytes, packed } = measureWidget(buildWidgetHtml(skins, links));
    expect(bytes).toBeLessThanOrEqual(WIDGET_MAX_BYTES);
    expect(packed).toBeLessThanOrEqual(WIDGET_MAX_PACKED);
  });

  it('подставляет скины и ссылки и не оставляет комментариев', () => {
    const html = buildWidgetHtml(skins, links);
    expect(html).not.toContain('__CFG__');
    expect(html).toContain(links.findGame);
    expect(html).toContain(skins.mat.pixels);
    expect(html).not.toMatch(/^\s*\/\//m);
  });

  it('не использует то, чего в виджете нет: сеть, внешние ресурсы, поля ввода', () => {
    const html = buildWidgetHtml(skins, links);
    for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'src=', '<input', 'addEventListener']) {
      expect(html).not.toContain(banned);
    }
  });

  it('отклоняет ссылку не на t.me', () => {
    expect(() => buildWidgetHtml(skins, { ...links, findGame: 'https://example.com/' })).toThrow(/t\.me/);
  });

  it('отклоняет виджет, который не влезает в лимит, а не отправляет его как есть', () => {
    expect(() => buildWidgetHtml({ ...skins, mat: noisyMat() }, links)).toThrow(/не влезает/);
  });

  it('отклоняет состояние больше 1 КБ', () => {
    const state = demoState(createDemoPlayer(500), 1000, 60);
    expect(encodeWidgetState(state).length).toBeLessThan(200);
    expect(() => encodeWidgetState({ ...state, p: 'я'.repeat(600) })).toThrow();
  });
});

describe('бросок в прототипе', () => {
  // Генератор, который всегда даёт шестёрки.
  const sixes = () => 0.99;

  it('тратит бросок, начисляет монеты и запускает таймер', () => {
    const { player, answer } = playDemoRoll(createDemoPlayer(500), 1000, sixes, 60);
    expect(answer).toEqual({
      d: [6, 6, 6],
      o: 'triple',
      c: 90,
      r: WIDGET_MAX_STORED_ROLLS - 1,
      n: 1060,
      b: 590,
      x: 'Выпал эпический скин',
    });
    expect(demoState(player, 1000, 60)).toMatchObject({ r: 2, n: 1060, t: 60, b: 590, d: [6, 6, 6] });
  });

  it('отказывает, когда бросков нет, и возвращает их по таймеру', () => {
    let player = createDemoPlayer(0);
    for (let i = 0; i < WIDGET_MAX_STORED_ROLLS; i++) player = playDemoRoll(player, 1000, sixes, 60).player;

    const refused = playDemoRoll(player, 1001, sixes, 60);
    expect(refused.answer).toEqual({ e: 'NO_ROLLS' });
    expect(refused.player.coins).toBe(270);

    expect(playDemoRoll(refused.player, 1060, sixes, 60).answer).toMatchObject({ r: 0, b: 360 });
  });
});
