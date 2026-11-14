import { SKIN_KINDS, SKIN_RARITIES, getPixel, resolvePalette } from '@gamedeck/shared';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NFT_CONTENT_LIMIT, encodePng, nftContent, nftImage, onchainBytes } from '../src/skins/nft.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 2654435 + 17);
const all = SKIN_KINDS.flatMap((kind) =>
  SKIN_RARITIES.flatMap((rarity) => SEEDS.map((seed) => ({ kind, rarity, seed }))),
);

/** Разбор PNG обратно в номера цветов: проверяем, что кодер пишет то, что нарисовал генератор. */
function decodePng(png: Uint8Array) {
  const buf = Buffer.from(png);
  const chunks = new Map<string, Buffer>();
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    chunks.set(type, Buffer.concat([chunks.get(type) ?? Buffer.alloc(0), buf.subarray(at + 8, at + 8 + length)]));
    at += 12 + length;
  }
  const ihdr = chunks.get('IHDR')!;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const raw = inflateSync(chunks.get('IDAT')!);
  const rowBytes = Math.ceil(width / 2);
  const pixel = (x: number, y: number) => {
    const byte = raw[y * (rowBytes + 1) + 1 + (x >> 1)]!;
    return x % 2 === 0 ? byte >> 4 : byte & 15;
  };
  const plte = chunks.get('PLTE')!;
  const colors = Array.from({ length: plte.length / 3 }, (_, i) => plte.readUIntBE(i * 3, 3));
  return { width, height, pixel, colors, alpha: chunks.get('tRNS') };
}

describe('скин как NFT', () => {
  it('PNG декодируется в ту же картинку, что рисует генератор', () => {
    for (const ref of all.filter((_, i) => i % 15 === 0)) {
      const image = nftImage(ref);
      const png = decodePng(encodePng(image, '#ff2d3d'));
      expect([png.width, png.height]).toEqual([image.width, image.height]);
      const palette = resolvePalette(image, '#ff2d3d');
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) expect(png.pixel(x, y)).toBe(getPixel(image, x, y));
      palette.forEach((hex, i) => {
        expect(png.colors[i]).toBe(hex ? parseInt(hex.slice(1), 16) : 0);
        if (png.alpha) expect(png.alpha[i]).toBe(hex ? 255 : 0);
      });
    }
  });

  it('у кубика в NFT все шесть граней одним листом 3×2', () => {
    const image = nftImage({ kind: 'dice', seed: 42, rarity: 'epic' });
    const face = 21;
    expect([image.width, image.height]).toEqual([face * 3 + 2, face * 2 + 1]);
  });

  it('название с номером выпуска и признаки в формате маркетплейсов', () => {
    const content = nftContent({ kind: 'mat', seed: 7, rarity: 'rare', serial: 1042 });
    expect(content.name).toMatch(/^[A-Z][A-Za-z -]+ Mat #1042$/);
    const attributes = JSON.parse(content.attributes) as Array<{ trait_type: string; value: string }>;
    expect(attributes[0]).toEqual({ trait_type: 'Quality', value: 'Rare' });
  });

  it(`ни один скин не занимает в блокчейне больше ${NFT_CONTENT_LIMIT} байт: аренда остаётся копеечной`, () => {
    let heaviest = 0;
    for (const ref of all) {
      // Длинный номер выпуска — худший случай для названия.
      const bytes = onchainBytes(nftContent({ ...ref, serial: 9_999_999 }));
      heaviest = Math.max(heaviest, bytes);
    }
    expect(heaviest).toBeLessThanOrEqual(NFT_CONTENT_LIMIT);
  });
});
