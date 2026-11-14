/**
 * Скин как NFT в сети TON: что ляжет в контракт NFT при выводе скина на кошелёк.
 *
 * Минта пока нет, но формат зафиксирован заранее. Картинка хранится в самом контракте
 * (TEP-64, on-chain-метаданные, поле image_data), а не на нашем сервере: сервер может
 * исчезнуть, а NFT должен показываться в кошельке всегда. За место в контракте сеть берёт
 * аренду, поэтому всё содержимое держится в NFT_CONTENT_LIMIT байт, и тест проверяет это
 * на сотнях скинов. Подробности и цены — docs/skins-guide.md, раздел про NFT.
 */
import { crc32, deflateSync } from 'node:zlib';
import {
  PLAYER_COLOR_HEX,
  createImage,
  generateSkin,
  getPixel,
  resolvePalette,
  setPixel,
  type PixelImage,
  type SkinSeed,
} from '@gamedeck/shared';

/**
 * Предел on-chain-содержимого одного NFT. 2 КБ ≈ 0,012 GRAM аренды в год (тарифы на ноябрь 2026);
 * самый тяжёлый скин (эпический коврик) сейчас занимает около 1,75 КБ, в среднем — около 0,9 КБ.
 */
export const NFT_CONTENT_LIMIT = 2048;

/** Цвет игрока на картинке NFT: красный, как в виджете «Кубик удачи». */
const NFT_PLAYER_COLOR = PLAYER_COLOR_HEX.red.main;

/** Скин, который выводится в NFT: из чего рисуется картинка и его номер выпуска. */
export interface NftSkin extends SkinSeed {
  /**
   * Номер выпуска (skins.serial) — он же индекс NFT в коллекции. Serial не меняется и не
   * повторяется, поэтому адрес NFT можно вычислить заранее, ещё до минта.
   */
  serial: number;
}

/** Поля on-chain-метаданных по TEP-64. Ключи — имена полей стандарта. */
export interface NftContent {
  name: string;
  description: string;
  /** Признаки скина в формате маркетплейсов: JSON-массив { trait_type, value }. */
  attributes: string;
  /** PNG-картинка, сами байты. */
  image_data: Uint8Array;
}

/**
 * Картинка NFT. Коврик и стакан — как на столе. У кубика шесть граней, поэтому в NFT
 * кладётся лист 3×2 с промежутком в один прозрачный пиксель: так видно весь набор.
 */
export function nftImage(seed: SkinSeed): PixelImage {
  const skin = generateSkin(seed);
  if (seed.kind !== 'dice') return skin.render();
  const faces = [1, 2, 3, 4, 5, 6].map((v) => skin.render(v));
  const face = faces[0]!;
  // Лист рисуется общей палитрой; если у граней она разная, лист был бы неверным.
  if (faces.some((f) => f.palette.join() !== face.palette.join())) throw new Error('У граней кубика разные палитры');
  // Прозрачный цвет для промежутка: берём из палитры или добавляем.
  const palette = [...face.palette];
  let gap = palette.indexOf('');
  if (gap < 0) gap = palette.push('') - 1;
  const sheet = createImage(face.width * 3 + 2, face.height * 2 + 1, palette);
  sheet.pixels.fill(gap);
  faces.forEach((f, i) => {
    const left = (i % 3) * (f.width + 1);
    const top = Math.floor(i / 3) * (f.height + 1);
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) setPixel(sheet, left + x, top + y, getPixel(f, x, y));
  });
  return sheet;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * PNG с палитрой, 4 бита на пиксель: наша палитра — до 16 цветов, ровно столько и помещается.
 * Пустой цвет палитры ('') становится прозрачным (чанк tRNS). Кодер свой, потому что
 * формат простой, а каждый байт картинки потом стоит денег в блокчейне.
 */
export function encodePng(image: PixelImage, playerColor = NFT_PLAYER_COLOR): Uint8Array {
  const { width, height, pixels } = image;
  const palette = resolvePalette(image, playerColor);
  const rowBytes = Math.ceil(width / 2);
  // Каждая строка начинается с байта фильтра (0 — без фильтра), дальше по два пикселя в байте.
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (rowBytes + 1) + 1 + (x >> 1);
      raw[i]! |= x % 2 === 0 ? pixels[y * width + x]! << 4 : pixels[y * width + x]!;
    }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 4; // бит на пиксель
  header[9] = 3; // цвет по палитре
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((hex, i) => plte.writeUIntBE(hex ? parseInt(hex.slice(1), 16) : 0, i * 3, 3));
  const alpha = Buffer.from(palette.map((hex) => (hex ? 255 : 0)));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', plte),
    ...(alpha.includes(0) ? [pngChunk('tRNS', alpha)] : []),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** Метаданные NFT для скина: название с номером, признаки и картинка. */
export function nftContent(skin: NftSkin): NftContent {
  const generated = generateSkin(skin);
  return {
    name: `${generated.name} #${skin.serial}`,
    description: 'A unique GameDeck dice game skin.',
    attributes: JSON.stringify(generated.traits.map((t) => ({ trait_type: t.trait, value: t.value }))),
    image_data: encodePng(nftImage(skin)),
  };
}

/**
 * Сколько байт содержимое займёт в контракте. В TEP-64 это словарь: ключ — sha256 имени поля
 * (32 байта), значение — «змейка» из ячеек с байтом-префиксом. Служебные биты ячеек сверху
 * дают ещё несколько процентов, их покрывает запас в NFT_CONTENT_LIMIT.
 */
export function onchainBytes(content: NftContent): number {
  return Object.values(content).reduce<number>((sum, value) => {
    const bytes = typeof value === 'string' ? Buffer.byteLength(value) : value.length;
    return sum + 32 + 1 + bytes;
  }, 0);
}
