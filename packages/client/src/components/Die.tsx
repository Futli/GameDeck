import { DEFAULT_DICE_STYLE, DICE_PIP_LAYOUT, type DiceStyle } from '@gamedeck/shared';

/**
 * Пиксельный кубик на сетке 21×21 «пикселя».
 *
 * Сетка нечётная, поэтому у грани есть центральный пиксель (10, 10), и любая раскладка
 * точек получается строго симметричной. Точки 3×3 стоят в пикселях 5, 10 и 15:
 * от края грани до точки 3 пикселя с каждой стороны, между точками — по 2.
 *
 * Из двух цветов скина (грань и точки) вычисляются обводка, блик и тень.
 */
const GRID = 21;
const PIP_CENTERS = [5, 10, 15] as const;

/** Смешать два цвета #rrggbb: t = 0 — первый, t = 1 — второй. */
function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Точка — квадрат 3×3 «пикселя» с центром в пикселе (cx, cy). */
function Pip({ cx, cy }: { cx: number; cy: number }) {
  return <rect x={cx - 1} y={cy - 1} width={3} height={3} />;
}

interface Props {
  value: number;
  /** Размер в CSS-пикселях. Лучше кратный 21, тогда «пиксели» кубика одинаковые. */
  size?: number;
  style?: DiceStyle;
}

export function Die({ value, size = 42, style = DEFAULT_DICE_STYLE }: Props) {
  const outline = mix(style.face, '#000000', 0.55);
  const shade = mix(style.face, '#000000', 0.22);
  const light = mix(style.face, '#ffffff', 0.45);
  const pipLight = mix(style.pips, '#ffffff', 0.25);
  const last = GRID - 1;

  return (
    <svg
      className="die"
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Выпало ${value}`}
    >
      {/* Обводка со срезанными углами */}
      <rect x={1} y={0} width={GRID - 2} height={GRID} fill={outline} />
      <rect x={0} y={1} width={GRID} height={GRID - 2} fill={outline} />
      {/* Грань */}
      <rect x={2} y={1} width={GRID - 4} height={GRID - 2} fill={style.face} />
      <rect x={1} y={2} width={GRID - 2} height={GRID - 4} fill={style.face} />
      {/* Блик сверху-слева и тень снизу-справа: свет падает из левого верхнего угла */}
      <rect x={2} y={1} width={GRID - 5} height={1} fill={light} />
      <rect x={1} y={2} width={1} height={GRID - 5} fill={light} />
      <rect x={3} y={last - 1} width={GRID - 5} height={1} fill={shade} />
      <rect x={last - 1} y={3} width={1} height={GRID - 5} fill={shade} />
      {/* Точки и светлый пиксель-блик в левом верхнем углу каждой */}
      <g fill={style.pips}>
        {DICE_PIP_LAYOUT[value]?.map(([col, row]) => (
          <Pip key={`${col}${row}`} cx={PIP_CENTERS[col]!} cy={PIP_CENTERS[row]!} />
        ))}
      </g>
      <g fill={pipLight}>
        {DICE_PIP_LAYOUT[value]?.map(([col, row]) => (
          <rect key={`${col}${row}`} x={PIP_CENTERS[col]! - 1} y={PIP_CENTERS[row]! - 1} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}
