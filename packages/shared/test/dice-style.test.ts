import { describe, expect, it } from 'vitest';
import { DEFAULT_DICE_STYLE, DICE_PIP_LAYOUT, parseDiceStyle } from '../src/index.js';

describe('dice style', () => {
  it('у каждого значения столько точек, сколько выпало', () => {
    for (let value = 1; value <= 6; value++) expect(DICE_PIP_LAYOUT[value]).toHaveLength(value);
  });

  it('раскладка точек симметрична относительно центра грани', () => {
    for (let value = 1; value <= 6; value++) {
      const cells = DICE_PIP_LAYOUT[value]!.map(([c, r]) => `${c},${r}`).sort();
      const rotated = DICE_PIP_LAYOUT[value]!.map(([c, r]) => `${2 - c},${2 - r}`).sort();
      expect(rotated).toEqual(cells);
    }
  });

  it('стиль читается из JSON скина, мусор даёт классический кубик', () => {
    expect(parseDiceStyle('{"face":"#d91e2b","pips":"#ffffff"}')).toEqual({ face: '#d91e2b', pips: '#ffffff' });
    expect(parseDiceStyle('dice/old.png')).toEqual(DEFAULT_DICE_STYLE);
    expect(parseDiceStyle('{"face":"red","pips":"#fff"}')).toEqual(DEFAULT_DICE_STYLE);
  });
});
