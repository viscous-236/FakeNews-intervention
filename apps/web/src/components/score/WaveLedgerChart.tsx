import React from 'react';
import type { LedgerRow } from '../../types';
import { copy } from '../../copy';

/**
 * The product's signature element: Q drawn as a step line across finalized
 * waves, with the open wave's projected Q as a dashed last step. All values
 * come from the API as strings; parsing here is for pixel positions only.
 */
export function WaveLedgerChart({
  rows,
  projected,
  width = 640,
  height = 160,
}: {
  rows: LedgerRow[];
  projected?: { waveNumber: number; q: string } | null;
  width?: number;
  height?: number;
}): React.ReactElement {
  const sorted = [...rows].sort((a, b) => a.waveNumber - b.waveNumber);
  const points: Array<{ wave: number; q: number; dashed?: boolean }> = [
    { wave: sorted[0] ? sorted[0].waveNumber - 1 : 0, q: 0 },
    ...sorted.map((r) => ({ wave: r.waveNumber, q: Number(r.qAfter) })),
  ];
  if (projected) points.push({ wave: projected.waveNumber, q: Number(projected.q), dashed: true });

  const pad = { l: 44, r: 16, t: 12, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const qs = points.map((p) => p.q);
  const min = Math.min(0, ...qs);
  const max = Math.max(0, ...qs);
  const span = max - min || 1;
  const step = Math.max(niceStep(span), 0.5);
  const yMin = Math.floor(min / step) * step;
  const yTop = Math.ceil(max / step) * step;
  const yMax = yTop === max ? yTop + step : yTop; // the top tick sits above the maximum
  const ySpan = yMax - yMin || 1;
  const xOf = (i: number) =>
    pad.l + (points.length > 1 ? (innerW * i) / (points.length - 1) : innerW / 2);
  const yOf = (q: number) => pad.t + innerH - ((q - yMin) / ySpan) * innerH;

  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Number(v.toFixed(3)));

  const solid = points.filter((p) => !p.dashed);
  const path = solid
    .map((p, i) => {
      const x = xOf(i);
      const y = yOf(p.q);
      if (i === 0) return `M ${x} ${y}`;
      return `H ${x} V ${y}`;
    })
    .join(' ');
  const last = solid[solid.length - 1];
  const dashedPath =
    projected && last
      ? `M ${xOf(solid.length - 1)} ${yOf(last.q)} H ${xOf(points.length - 1)} V ${yOf(projected ? Number(projected.q) : 0)}`
      : null;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={copy.score.ledgerChartTitle}
        className="h-auto w-full"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={t === 0 ? '#cdced1' : '#e5e5e5'}
              strokeWidth={t === 0 ? 1.5 : 1}
            />
            <text
              x={pad.l - 8}
              y={yOf(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="12"
              fill="#5d5f60"
              fontFamily="inherit"
            >
              {Number(t.toFixed(2))}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text
            key={`${p.wave}-${i}`}
            x={xOf(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="12"
            fill={p.dashed ? '#1b6c80' : '#5d5f60'}
            fontFamily="inherit"
          >
            {p.wave === 0 && i === 0 ? '' : `w${p.wave}`}
          </text>
        ))}
        <path d={path} fill="none" stroke="#1b6c80" strokeWidth={2} strokeLinejoin="round" />
        {dashedPath ? (
          <path d={dashedPath} fill="none" stroke="#1b6c80" strokeWidth={2} strokeDasharray="4 4" />
        ) : null}
        {solid.map((p, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(p.q)} r={3} fill="#1b6c80" />
        ))}
        {projected ? (
          <circle
            cx={xOf(points.length - 1)}
            cy={yOf(Number(projected.q))}
            r={3.5}
            fill="#ffffff"
            stroke="#1b6c80"
            strokeWidth={2}
          />
        ) : null}
      </svg>
    </figure>
  );
}

function niceStep(span: number): number {
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}
