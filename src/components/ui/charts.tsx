import { cn } from '@/lib/utils';

/**
 * Dependency-free SVG charts (server-rendered, zero client JS).
 * Used by the admin analytics dashboard.
 */

export interface TimePoint {
  label: string;
  value: number;
}

export function LineChart({
  data,
  height = 160,
  formatValue,
  className,
}: {
  data: TimePoint[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const fmt = formatValue ?? ((v: number) => String(v));
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No data for this period</p>;
  }
  const w = 600;
  const h = height;
  const padX = 8;
  const padTop = 12;
  const padBottom = 22;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (w - padX * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = padTop + (h - padTop - padBottom) * (1 - d.value / max);
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const area = `${path} L${points[points.length - 1][0].toFixed(1)},${(h - padBottom).toFixed(1)} L${points[0][0].toFixed(1)},${(h - padBottom).toFixed(1)} Z`;

  return (
    <figure className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Line chart: ${data.map((d) => `${d.label} ${fmt(d.value)}`).join(', ')}`}
      >
        <line
          x1={padX}
          y1={h - padBottom}
          x2={w - padX}
          y2={h - padBottom}
          stroke="#e5e7eb"
          strokeWidth="1"
        />
        <line x1={padX} y1={padTop} x2={padX} y2={h - padBottom} stroke="#e5e7eb" strokeWidth="1" />
        <path d={area} fill="#35885d" opacity="0.08" />
        <path
          d={path}
          fill="none"
          stroke="#35885d"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#20573c">
            <title>{`${data[i].label}: ${fmt(data[i].value)}`}</title>
          </circle>
        ))}
        {data.map((d, i) =>
          i % Math.ceil(data.length / 8) === 0 || i === data.length - 1 ? (
            <text
              key={`l${i}`}
              x={points[i][0]}
              y={h - 6}
              textAnchor="middle"
              fontSize="9"
              fill="#9ca3af"
            >
              {d.label}
            </text>
          ) : null
        )}
      </svg>
    </figure>
  );
}

export function BarChart({
  data,
  height = 160,
  formatValue,
  className,
}: {
  data: TimePoint[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const fmt = formatValue ?? ((v: number) => String(v));
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No data for this period</p>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <figure className={cn('w-full', className)}>
      <div
        className="flex items-end gap-2"
        style={{ height }}
        role="img"
        aria-label={`Bar chart: ${data.map((d) => `${d.label} ${fmt(d.value)}`).join(', ')}`}
      >
        {data.map((d) => (
          <div
            key={d.label}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-[10px] font-medium tabular-nums text-gray-600">
              {fmt(d.value)}
            </span>
            <div
              className="w-full max-w-[42px] rounded-t bg-brand-500"
              style={{ height: `${Math.max((d.value / max) * 100, 2)}%` }}
              title={`${d.label}: ${fmt(d.value)}`}
            />
            <span className="w-full truncate text-center text-[10px] text-gray-400">{d.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
