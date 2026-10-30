/** Какие из 9 клеток сетки 3×3 заняты точками для каждого значения. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({ value, size = 32 }: { value: number; size?: number }) {
  return (
    <div className="die" style={{ width: size, height: size }} aria-label={`Выпало ${value}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[value]?.includes(i) ? 'pip' : undefined} />
      ))}
    </div>
  );
}
