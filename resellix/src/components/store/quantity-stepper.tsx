'use client';

export function QuantityStepper({
  value,
  min = 1,
  max = 99,
  onChange,
  label = 'Quantity',
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  const set = (v: number) => onChange(Math.min(Math.max(v, min), max));
  return (
    <div className="inline-flex items-center rounded-lg border border-ink-900/20 bg-white">
      <button
        type="button"
        onClick={() => set(value - 1)}
        disabled={value <= min}
        aria-label={`Decrease ${label.toLowerCase()}`}
        className="px-3 py-2 text-ink-500 hover:bg-cream-50 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) set(n);
        }}
        className="w-12 border-x border-ink-900/10 py-2 text-center text-sm font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => set(value + 1)}
        disabled={value >= max}
        aria-label={`Increase ${label.toLowerCase()}`}
        className="px-3 py-2 text-ink-500 hover:bg-cream-50 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
