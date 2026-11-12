import { PLAYER_COLOR_HEX, type PlayerColor } from '@gamedeck/shared';

/**
 * Пиксельный стакан цвета игрока, перевёрнутый вверх дном: кубики под ним.
 * Сетка 16×18, сверху дно (узкое), снизу широкий край.
 */
export function Cup({ color, size = 36 }: { color: PlayerColor; size?: number }) {
  const { light, main, shade } = PLAYER_COLOR_HEX[color];
  return (
    <svg className="cup" width={size} height={(size * 18) / 16} viewBox="0 0 16 18" shapeRendering="crispEdges" aria-hidden>
      {/* Обводка */}
      <rect x={4} y={0} width={8} height={1} fill="#000a" />
      <rect x={3} y={1} width={10} height={4} fill="#000a" />
      <rect x={2} y={5} width={12} height={8} fill="#000a" />
      <rect x={1} y={13} width={14} height={5} fill="#000a" />
      {/* Тело стакана */}
      <rect x={4} y={1} width={8} height={4} fill={main} />
      <rect x={3} y={5} width={10} height={8} fill={main} />
      <rect x={2} y={13} width={12} height={4} fill={main} />
      {/* Блик слева и тень справа */}
      <rect x={4} y={1} width={2} height={4} fill={light} />
      <rect x={3} y={5} width={2} height={8} fill={light} />
      <rect x={2} y={13} width={2} height={3} fill={light} />
      <rect x={11} y={2} width={1} height={3} fill={shade} />
      <rect x={12} y={5} width={1} height={8} fill={shade} />
      <rect x={13} y={13} width={1} height={4} fill={shade} />
      {/* Ободок */}
      <rect x={2} y={15} width={12} height={1} fill={shade} />
    </svg>
  );
}
