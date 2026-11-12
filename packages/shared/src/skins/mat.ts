import { PLAYER_SLOT, createImage, setPixel, type PixelImage } from './image.js';
import { bandTone, fbm, pixelNoise, valueNoise, type Rng } from './random.js';
import { pickPalette, type Gender, type SkinRarity } from './themes.js';

export const MAT_WIDTH = 128;
export const MAT_HEIGHT = 96;

// Номера цветов в палитре коврика.
const B = (tone: number) => 1 + tone; // основной тон 0..4
const A = (tone: number) => 6 + tone; // акцент 0..3
const M = (tone: number) => 10 + tone; // металл 0..2
const OUTLINE = 13;
const SPARKLE = 14;
const PLAYER = 15;

type Pattern = (x: number, y: number) => number;
interface PatternDef {
  noun: string;
  gender: Gender;
  make: (rng: Rng, seed: number) => Pattern;
}

/**
 * Узоры фона. Каждый — функция (x, y) → номер цвета. Параметры (шаг, наклон, масштаб)
 * случайны, поэтому одна «шотландка» не похожа на другую.
 */
const PATTERNS: Record<string, PatternDef> = {
  felt: {
    noun: 'сукно',
    gender: 'n',
    // Сукно: мягкие пятна ворса, переходы дизерингом.
    make: (rng, seed) => {
      const cell = rng.range(10, 18);
      return (x, y) => B(1 + bandTone(fbm(x, y, cell, seed), 3, x, y));
    },
  },
  stripes: {
    noun: 'полоска',
    gender: 'f',
    make: (rng) => {
      const width = rng.pick([6, 8]);
      const dir = rng.pick([1, -1]);
      return (x, y) => {
        const band = Math.floor((x + dir * y + 256) / width) % 2;
        return band ? B(3) : B(2);
      };
    },
  },
  checker: {
    noun: 'клетка',
    gender: 'f',
    make: (rng) => {
      const size = rng.pick([8, 16]);
      return (x, y) => {
        const odd = (Math.floor(x / size) + Math.floor(y / size)) % 2;
        // Верхний ряд светлой клетки чуть светлее: клетки «выпуклые».
        if (odd && y % size === 0) return B(4);
        return odd ? B(3) : B(2);
      };
    },
  },
  dots: {
    noun: 'горошек',
    gender: 'm',
    make: (rng) => {
      const step = rng.pick([8, 10, 12]);
      const r = rng.pick([1.5, 2.2]);
      return (x, y) => {
        const row = Math.floor(y / step);
        const cx = ((x + (row % 2) * (step / 2)) % step) - step / 2 + 0.5;
        const cy = (y % step) - step / 2 + 0.5;
        const d = Math.hypot(cx, cy);
        if (d < r) return cx + cy < -r * 0.6 ? A(3) : A(2);
        return B(2);
      };
    },
  },
  linen: {
    noun: 'рогожка',
    gender: 'f',
    make: (rng, seed) => {
      const cell = rng.range(14, 24);
      return (x, y) => {
        const weave = (x >> 3) % 2 === (y >> 2) % 2;
        const tone = valueNoise(x, y, cell, seed) > 0.5 ? 1 : 0;
        return B(weave ? 2 + tone : 1 + tone);
      };
    },
  },
  wood: {
    noun: 'шпон',
    gender: 'm',
    make: (rng, seed) => {
      const freq = rng.range(0.35, 0.55);
      const warp = rng.range(6, 12);
      return (x, y) => {
        const v = Math.sin((y + fbm(x, y, 24, seed) * warp) * freq + x * 0.02);
        return B(1 + bandTone((v + 1) / 2, 3, x, y));
      };
    },
  },
  tartan: {
    noun: 'шотландка',
    gender: 'f',
    make: (rng) => {
      const period = rng.pick([24, 32]);
      const wide = rng.pick([4, 6]);
      const line = rng.int(period - wide - 4) + wide + 2;
      const band = (v: number) => {
        const p = v % period;
        return p < wide ? 2 : p === line ? 1 : 0;
      };
      return (x, y) => {
        const h = band(y);
        const v = band(x);
        if (h === 1 || v === 1) return A(2);
        // Пересечение широких полос — тёмное, как плетение настоящей шотландки.
        if (h === 2 && v === 2) return B(0);
        if (h === 2 || v === 2) return B(1);
        return B(3);
      };
    },
  },
  waves: {
    noun: 'волна',
    gender: 'f',
    make: (rng) => {
      const period = rng.pick([16, 20]);
      const amp = rng.range(2, 4);
      const len = rng.range(10, 18);
      return (x, y) => {
        const v = y + Math.sin((x / len) * Math.PI) * amp;
        const p = ((v % period) + period) % period;
        if (p < 1) return A(2);
        if (p < 2) return A(1);
        return p < period / 2 + 1 ? B(3) : B(2);
      };
    },
  },
  scales: {
    noun: 'чешуя',
    gender: 'f',
    make: () => {
      const r = 12;
      return (x, y) => {
        const row = Math.floor(y / r);
        const ox = (row % 2) * r;
        const cx = (((x + ox) % (r * 2)) + r * 2) % (r * 2);
        const d = Math.hypot(cx - r + 0.5, (y % r) + 0.5);
        if (d > r - 1 && d <= r) return A(1);
        return d < r * 0.55 ? B(3) : B(2);
      };
    },
  },
  argyle: {
    noun: 'ромбы',
    gender: 'pl',
    make: () => {
      const w = 32;
      const h = w;
      return (x, y) => {
        const u = Math.abs((x % w) - w / 2 + 0.5) / (w / 2) + Math.abs((y % h) - h / 2 + 0.5) / (h / 2);
        const cell = (Math.floor(x / w) + Math.floor(y / h)) % 2;
        // Пунктир по диагоналям — «стежок» акцентом.
        const diag = (x + y) % w === 0 || (x - y + 512) % w === 0;
        if (diag) return A(2);
        if (u < 1) return cell ? B(3) : B(1);
        return B(2);
      };
    },
  },
  chevron: {
    noun: 'ёлочка',
    gender: 'f',
    make: (rng) => {
      const period = 16;
      const width = rng.pick([16, 20]);
      return (x, y) => {
        const zig = Math.abs((x % (width * 2)) - width);
        const p = (y + zig + 256) % period;
        if (p === 0) return A(1);
        return p < period / 2 ? B(3) : B(2);
      };
    },
  },
  honeycomb: {
    noun: 'соты',
    gender: 'pl',
    make: () => {
      const size = 13;
      const r3 = Math.sqrt(3);
      return (x, y) => {
        // Пиксель → осевые координаты шестиугольной сетки → центр ближайшей соты.
        const q = ((r3 / 3) * x - y / 3) / size;
        const r = ((2 / 3) * y) / size;
        let rx = Math.round(q);
        let rz = Math.round(r);
        const ry = Math.round(-q - r);
        const [dx0, dy0, dz0] = [Math.abs(rx - q), Math.abs(ry + q + r), Math.abs(rz - r)];
        if (dx0 > dy0 && dx0 > dz0) rx = -ry - rz;
        else if (dz0 >= dy0) rz = -rx - ry;
        const cx = size * r3 * (rx + rz / 2);
        const cy = size * 1.5 * rz;
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const edge = Math.max(dx, dx * 0.5 + dy * (r3 / 2)) / ((size * r3) / 2);
        if (edge > 0.86) return B(0);
        if (edge > 0.7) return y < cy ? A(2) : A(0);
        return y < cy - size * 0.3 ? B(3) : B(2);
      };
    },
  },
  bricks: {
    noun: 'кладка',
    gender: 'f',
    make: (rng, seed) => {
      const bw = rng.pick([12, 16]);
      const bh = rng.pick([6, 8]);
      return (x, y) => {
        const row = Math.floor(y / bh);
        const xx = x + (row % 2) * (bw / 2);
        if (y % bh === 0 || xx % bw === 0) return B(0);
        const brick = pixelNoise(Math.floor(xx / bw), row, seed);
        if (y % bh === 1) return B(3);
        return brick > 0.9 ? A(1) : brick > 0.55 ? B(3) : brick > 0.2 ? B(2) : B(1);
      };
    },
  },
  marble: {
    noun: 'мрамор',
    gender: 'm',
    make: (rng, seed) => {
      const freq = rng.range(0.06, 0.1);
      const warp = rng.range(18, 30);
      return (x, y) => {
        const v = Math.abs(Math.sin((x + y * 0.6) * freq + fbm(x, y, 20, seed) * warp * 0.2));
        if (v < 0.06) return M(2);
        if (v < 0.1) return A(2);
        return valueNoise(x, y, 40, seed + 7) > 0.5 ? B(2) : B(1);
      };
    },
  },
  starfield: {
    noun: 'космос',
    gender: 'm',
    make: (rng, seed) => {
      const cell = rng.range(30, 44);
      return (x, y) => {
        // Звёзды редкие, а туманность — крупные пятна в два-три тона: пёстрый космос
        // не влезает в 4 КБ виджета.
        const star = pixelNoise(x, y, seed + 3);
        if (star > 0.996) return SPARKLE;
        if (star > 0.99) return A(3);
        const neb = valueNoise(x, y, cell, seed);
        if (neb > 0.66) return neb > 0.8 ? A(2) : A(1);
        return neb > 0.4 ? B(1) : B(0);
      };
    },
  },
  sunburst: {
    noun: 'сияние',
    gender: 'n',
    make: (rng) => {
      const rays = rng.pick([8, 12]);
      return (x, y) => {
        const dx = x - MAT_WIDTH / 2 + 0.5;
        const dy = ((y - MAT_HEIGHT / 2 + 0.5) * MAT_WIDTH) / MAT_HEIGHT;
        const a = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
        const ray = Math.floor(a * rays) % 2;
        const r = Math.hypot(dx, dy) / 64;
        // Три кольца яркости без дизеринга: свет от центра стола.
        const tone = r < 0.4 ? 2 : r < 0.8 ? 1 : 0;
        return ray ? A(tone) : B(1 + Math.min(tone, 2));
      };
    },
  },
  rift: {
    noun: 'разлом',
    gender: 'm',
    make: (rng) => {
      // Ячейки Вороного: трещины между ними светятся акцентом, как лава между плитами.
      const points = Array.from({ length: 10 }, () => [rng.range(0, MAT_WIDTH), rng.range(0, MAT_HEIGHT)] as const);
      return (x, y) => {
        let d1 = Infinity;
        let d2 = Infinity;
        for (const [px, py] of points) {
          const d = Math.hypot(px - x, py - y);
          if (d < d1) [d1, d2] = [d, d1];
          else if (d < d2) d2 = d;
        }
        const edge = d2 - d1;
        if (edge < 1.2) return A(3);
        if (edge < 2.2) return A(2);
        return B(1);
      };
    },
  },
};

const PATTERN_POOL: Record<SkinRarity, string[]> = {
  common: ['felt', 'stripes', 'checker', 'dots', 'linen', 'wood'],
  rare: ['tartan', 'waves', 'scales', 'argyle', 'chevron', 'honeycomb', 'bricks', 'dots'],
  epic: ['marble', 'starfield', 'sunburst', 'rift', 'tartan', 'scales'],
};

/** Ширина рамки по редкости: у эпического коврика массивная металлическая. */
const FRAME_WIDTH: Record<SkinRarity, number> = { common: 4, rare: 5, epic: 6 };

/** На сколько пикселей точка удалена от края коврика. */
const edgeDistance = (x: number, y: number) => Math.min(x, y, MAT_WIDTH - 1 - x, MAT_HEIGHT - 1 - y);

/** Тон темнее на ступень, если он из рампы (для виньетки и тени рамки). */
function darker(color: number): number {
  if (color > B(0) && color <= B(4)) return color - 1;
  if (color > A(0) && color <= A(3)) return color - 1;
  return color;
}

/**
 * Эмблемы эпических ковриков нарисованы вручную: на сетке 9×9 случайная фигура почти
 * всегда выглядит кляксой, а корона или пиковый туз читаются сразу.
 */
const EMBLEMS: Record<string, string[]> = {
  корона: ['#...#...#', '##.###.##', '#########', '#########', '#.#.#.#.#', '#########'],
  звезда: ['....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.'],
  кристалл: ['..#####..', '.#######.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  сердце: ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  кость: ['#########', '#.#####.#', '#########', '####.####', '#########', '#.#####.#', '#########'],
  месяц: ['..####...', '.###.....', '###......', '###......', '###......', '.###.....', '..####...'],
  пика: ['....#....', '...###...', '..#####..', '.#######.', '#########', '.##.#.##.', '....#....', '...###...'],
  молния: ['....###', '...###.', '..###..', '.######', '...###.', '..###..', '.##....', '##.....'],
};

export interface MatSkin {
  image: PixelImage;
  noun: string;
  gender: Gender;
  adjectives: [string, string, string, string];
}

/** Коврик 128×96: фон-узор, виньетка, рамка по редкости, нитка цвета игрока, детали. */
export function generateMat(rng: Rng, seed: number, rarity: SkinRarity): MatSkin {
  const palette = pickPalette(rng, rarity);
  const image = createImage(MAT_WIDTH, MAT_HEIGHT, [
    '',
    ...palette.base,
    ...palette.accent,
    ...palette.metal,
    palette.outline,
    palette.sparkle,
    PLAYER_SLOT,
  ]);
  const def = PATTERNS[rng.pick(PATTERN_POOL[rarity])]!;
  const pattern = def.make(rng, seed);
  const frame = FRAME_WIDTH[rarity];

  // Фон с виньеткой: к краям узор темнеет дизерингом, центр стола «под лампой».
  for (let y = 0; y < MAT_HEIGHT; y++)
    for (let x = 0; x < MAT_WIDTH; x++) {
      let color = pattern(x, y);
      // Тень от рамки: сплошная полоса, без дизеринга (бюджет отрезков в виджете).
      const d = edgeDistance(x, y) - frame;
      if (d < 2) color = darker(color);
      setPixel(image, x, y, color);
    }

  // Эпический: металлический медальон в центре, с контуром и бликом слева сверху.
  if (rarity === 'epic') {
    const mark = EMBLEMS[rng.pick(Object.keys(EMBLEMS))]!.map((row) => [...row].map((c) => c === '#'));
    const scale = 2;
    const ox = Math.round(MAT_WIDTH / 2 - (mark[0]!.length * scale) / 2);
    const oy = Math.round(MAT_HEIGHT / 2 - (mark.length * scale) / 2);
    const inside = (px: number, py: number) =>
      mark[Math.floor((py - oy) / scale)]?.[Math.floor((px - ox) / scale)] === true && px >= ox && py >= oy;
    for (let py = oy - 1; py <= oy + mark.length * scale; py++)
      for (let px = ox - 1; px <= ox + mark[0]!.length * scale; px++) {
        if (inside(px, py)) {
          const color =
            !inside(px, py - 1) || !inside(px - 1, py)
              ? M(2)
              : !inside(px, py + 1) || !inside(px + 1, py)
                ? M(0)
                : M(1);
          setPixel(image, px, py, color);
        } else if (inside(px + 1, py) || inside(px - 1, py) || inside(px, py + 1) || inside(px, py - 1))
          setPixel(image, px, py, OUTLINE);
      }
  }

  drawFrame(image, rng, rarity, frame);

  // Искры на эпическом: крестики на металле рамки и пара на поле.
  if (rarity === 'epic') {
    for (let i = 0; i < 4; i++) {
      const top = rng.chance(0.5);
      sparkle(image, rng.int(MAT_WIDTH - 24) + 12, top ? 3 : MAT_HEIGHT - 4);
    }
    for (let i = 0; i < 3; i++) sparkle(image, rng.int(MAT_WIDTH - 30) + 15, rng.int(MAT_HEIGHT - 24) + 12);
  }

  return { image, noun: def.noun, gender: def.gender, adjectives: palette.name };
}

function sparkle(image: PixelImage, x: number, y: number) {
  setPixel(image, x, y, SPARKLE);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    setPixel(image, x + dx, y + dy, M(2));
}

/**
 * Рамка. Свет падает слева сверху: верх и левый край светлее, низ и правый темнее.
 * Сразу за контуром — нитка цвета игрока: по ней видно, чей коврик, при любом скине.
 */
function drawFrame(image: PixelImage, rng: Rng, rarity: SkinRarity, width: number) {
  const stitch = rarity !== 'epic' && rng.chance(0.6);
  for (let y = 0; y < MAT_HEIGHT; y++)
    for (let x = 0; x < MAT_WIDTH; x++) {
      const d = edgeDistance(x, y);
      if (d >= width) continue;
      // Какая сторона ближе: верх/лево — освещённые.
      const lit = Math.min(x, y) <= Math.min(MAT_WIDTH - 1 - x, MAT_HEIGHT - 1 - y);
      let color: number;
      if (d === 0) color = OUTLINE;
      else if (d === 1) color = PLAYER;
      else if (rarity === 'epic') {
        // Металл с фаской: блик, основа, тень, и тёмный кант по внутреннему краю.
        if (d === width - 1) color = OUTLINE;
        else if (d === 2) color = lit ? M(2) : M(1);
        else color = lit ? M(1) : M(0);
      } else if (rarity === 'rare') {
        if (d === width - 1) color = B(0);
        else color = lit ? A(2) : A(0);
        if (d === 2) color = lit ? A(3) : A(1);
      } else {
        if (d === width - 1) color = B(0);
        else color = lit ? B(4) : B(1);
      }
      setPixel(image, x, y, color);
    }

  // Строчка по сукну: пунктир чуть внутри рамки.
  if (stitch) {
    const d = width + 1;
    for (let x = d; x < MAT_WIDTH - d; x++)
      if (x % 4 < 2) {
        setPixel(image, x, d, A(3));
        setPixel(image, x, MAT_HEIGHT - 1 - d, A(3));
      }
    for (let y = d; y < MAT_HEIGHT - d; y++)
      if (y % 4 < 2) {
        setPixel(image, d, y, A(3));
        setPixel(image, MAT_WIDTH - 1 - d, y, A(3));
      }
  }

  // Уголки: у редкого ромбик-заклёпка, у эпического — металлическая накладка.
  if (rarity !== 'common') {
    const size = rarity === 'epic' ? 9 : 5;
    for (const [cx, cy, sx, sy] of [
      [0, 0, 1, 1],
      [MAT_WIDTH - 1, 0, -1, 1],
      [0, MAT_HEIGHT - 1, 1, -1],
      [MAT_WIDTH - 1, MAT_HEIGHT - 1, -1, -1],
    ] as const)
      for (let i = 0; i < size; i++)
        for (let j = 0; j < size; j++) {
          if (i + j >= size) continue;
          const x = cx + sx * (width + i - 1);
          const y = cy + sy * (width + j - 1);
          const edge = i + j === size - 1;
          const color = rarity === 'epic' ? (edge ? OUTLINE : i + j < 2 ? M(2) : M(1)) : edge ? B(0) : A(3);
          setPixel(image, x, y, color);
        }
  }
}
