/**
 * Коврик игрока в виджете — пиксельная картинка 128×96 с палитрой до 16 цветов.
 *
 * Картинку нельзя приложить файлом: у виджета нет сети, а весь его HTML вместе
 * с картинками должен сжиматься до 4 КБ. Поэтому коврик едет внутри HTML строкой:
 * один символ на пиксель, символ — номер цвета в палитре (0–f). Такая строка
 * отлично сжимается zlib (в пиксель-арте много повторов), а виджет рисует её
 * на canvas прямоугольниками — по одному на отрезок одинаковых пикселей в строке.
 */
import { resolvePalette, type PixelImage } from '@gamedeck/shared';

export const MAT_WIDTH = 128;
export const MAT_HEIGHT = 96;
const MAX_COLORS = 16;
/**
 * Telegram разрешает 4000 команд на canvas за одну задачу. Один отрезок — одна
 * команда fillRect, поэтому слишком пёстрый коврик виджет просто не дорисует.
 */
export const MAT_MAX_RUNS = 3500;

export interface MatSkin {
  /** Цвета #rrggbb, не больше 16. */
  palette: string[];
  /** 128×96 = 12288 символов, по строкам сверху вниз; символ — индекс цвета в палитре (hex). */
  pixels: string;
}

/** Сколько отрезков одного цвета в коврике, то есть сколько команд рисования он стоит. */
export function countMatRuns(mat: MatSkin): number {
  let runs = 0;
  for (let y = 0; y < MAT_HEIGHT; y++) {
    for (let x = 0; x < MAT_WIDTH; x++) {
      const i = y * MAT_WIDTH + x;
      if (x === 0 || mat.pixels[i] !== mat.pixels[i - 1]) runs++;
    }
  }
  return runs;
}

/** Проверить коврик перед отправкой. Сломанный коврик отклоняется, а не чинится молча. */
export function assertValidMat(mat: MatSkin): void {
  if (mat.palette.length < 1 || mat.palette.length > MAX_COLORS) {
    throw new Error(`В палитре коврика должно быть от 1 до ${MAX_COLORS} цветов`);
  }
  if (!mat.palette.every((color) => /^#[0-9a-f]{6}$/.test(color))) {
    throw new Error('Цвета палитры коврика задаются как #rrggbb строчными буквами');
  }
  if (mat.pixels.length !== MAT_WIDTH * MAT_HEIGHT) {
    throw new Error(`Коврик должен быть ${MAT_WIDTH}×${MAT_HEIGHT} пикселей`);
  }
  for (const char of mat.pixels) {
    const index = parseInt(char, 16);
    if (Number.isNaN(index) || index >= mat.palette.length) throw new Error(`Пиксель «${char}» вне палитры коврика`);
  }
  const runs = countMatRuns(mat);
  if (runs > MAT_MAX_RUNS) throw new Error(`Коврик слишком пёстрый: ${runs} отрезков при лимите ${MAT_MAX_RUNS}`);
}

/** Холст для рисования коврика кодом: набор пикселей и пара примитивов. */
class MatCanvas {
  private readonly cells: number[];

  constructor(background: number) {
    this.cells = new Array<number>(MAT_WIDTH * MAT_HEIGHT).fill(background);
  }

  set(x: number, y: number, color: number): void {
    if (x >= 0 && x < MAT_WIDTH && y >= 0 && y < MAT_HEIGHT) this.cells[y * MAT_WIDTH + x] = color;
  }

  /** Рамка в один пиксель с отступом inset от края. */
  frame(inset: number, color: number): void {
    for (let x = inset; x < MAT_WIDTH - inset; x++) {
      this.set(x, inset, color);
      this.set(x, MAT_HEIGHT - 1 - inset, color);
    }
    for (let y = inset; y < MAT_HEIGHT - inset; y++) {
      this.set(inset, y, color);
      this.set(MAT_WIDTH - 1 - inset, y, color);
    }
  }

  /** Ромб с центром (cx, cy): закрашенный или только контур. */
  diamond(cx: number, cy: number, radius: number, color: number, filled: boolean): void {
    for (let dy = -radius; dy <= radius; dy++) {
      const half = radius - Math.abs(dy);
      for (let dx = -half; dx <= half; dx++) {
        if (filled || Math.abs(dx) === half) this.set(cx + dx, cy + dy, color);
      }
    }
  }

  toPixels(): string {
    return this.cells.map((color) => color.toString(16)).join('');
  }
}

/**
 * «Зелёное сукно» — коврик по умолчанию. Нарисован кодом из деталей (фон,
 * узор, рамка, эмблема): из таких же деталей генератор позже будет собирать
 * остальные коврики, меняя палитру и параметры.
 */
export function feltMat(): MatSkin {
  const [FELT, WEAVE, EDGE, GOLD, GOLD_DARK] = [0, 1, 2, 3, 4];
  const canvas = new MatCanvas(FELT);

  // Узор сукна: редкие тёмные точки в шахматном порядке.
  for (let y = 8; y < MAT_HEIGHT - 8; y += 6) {
    for (let x = 10 + ((y / 6) % 2) * 6; x < MAT_WIDTH - 8; x += 12) canvas.set(x, y, WEAVE);
  }

  // Рамка: тёмный кант по краю и золотая нить внутри.
  canvas.frame(0, EDGE);
  canvas.frame(1, EDGE);
  canvas.frame(3, GOLD);
  canvas.frame(4, GOLD_DARK);

  // Ромбы по углам и эмблема в центре.
  for (const [cx, cy] of [
    [10, 10],
    [MAT_WIDTH - 11, 10],
    [10, MAT_HEIGHT - 11],
    [MAT_WIDTH - 11, MAT_HEIGHT - 11],
  ] as const) {
    canvas.diamond(cx, cy, 3, GOLD, true);
    canvas.diamond(cx, cy, 1, GOLD_DARK, true);
  }
  canvas.diamond(MAT_WIDTH / 2, MAT_HEIGHT / 2, 20, WEAVE, false);
  canvas.diamond(MAT_WIDTH / 2, MAT_HEIGHT / 2, 17, GOLD_DARK, false);

  return { palette: ['#1f7a4d', '#1a6a43', '#0f3d27', '#e6c15a', '#a8862f'], pixels: canvas.toPixels() };
}

/**
 * Сгенерированный коврик (генератор скинов из @gamedeck/shared) в формат виджета:
 * цвет игрока подставляется в палитру, номер цвета — одним hex-символом.
 */
export function matFromSkin(image: PixelImage, playerColor: string): MatSkin {
  return {
    // Пустой цвет у коврика не встречается (он без прозрачности), но палитра должна быть валидной.
    palette: resolvePalette(image, playerColor).map((color) => color || '#000000'),
    pixels: Array.from(image.pixels, (color) => color.toString(16)).join(''),
  };
}
