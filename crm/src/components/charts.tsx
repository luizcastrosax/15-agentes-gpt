"use client";

import React from "react";

/** Barras verticais simples, sem dependencias externas. */
export function BarChart({
  data,
  height = 170,
  format = (v: number) => String(v),
  color = "#4f46e5",
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (v: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[11px] font-medium text-slate-600 opacity-0 transition group-hover:opacity-100">
            {format(d.value)}
          </span>
          <div
            className="w-full rounded-t-md transition-all"
            style={{
              height: `${Math.max(3, (d.value / max) * (height - 42))}px`,
              background: color,
              opacity: 0.85,
            }}
            title={`${d.label}: ${format(d.value)}`}
          />
          <span className="w-full truncate text-center text-[10px] text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Barras horizontais (ranking). */
export function HBarChart({
  data,
  format = (v: number) => String(v),
  color = "#4f46e5",
}: {
  data: { label: string; value: number }[];
  format?: (v: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-400">Sem dados.</p>;
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
            <span className="truncate text-slate-600">{d.label}</span>
            <span className="shrink-0 font-medium text-slate-800">{format(d.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(d.value / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rosca com legenda. */
export function DonutChart({
  data,
  size = 150,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f5f9" strokeWidth="18" />
          {total > 0 &&
            data.map((d, i) => {
              const len = (d.value / total) * c;
              const el = (
                <circle
                  key={i}
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth="18"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold text-slate-900">{centerValue ?? total}</span>
          {centerLabel && <span className="text-[11px] text-slate-500">{centerLabel}</span>}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{d.label}</span>
            <span className="font-medium text-slate-800">{d.value}</span>
            <span className="w-10 text-right text-slate-400">
              {total ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Funil de vendas em degraus. */
export function FunnelChart({
  data,
  format = (v: number) => String(v),
}: {
  data: { label: string; value: number; color: string }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-[12px] text-slate-600">{d.label}</span>
          <div className="h-7 flex-1 overflow-hidden rounded-md bg-slate-50">
            <div
              className="flex h-full items-center justify-end rounded-md px-2 text-[11px] font-semibold text-white transition-all"
              style={{
                width: `${Math.max(6, (d.value / max) * 100)}%`,
                background: d.color,
              }}
            >
              {format(d.value)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barra de progresso com rotulo. */
export function ProgressBar({
  value,
  color = "#4f46e5",
  height = 8,
}: {
  value: number;
  color?: string;
  height?: number;
}) {
  return (
    <div className="overflow-hidden rounded-full bg-slate-100" style={{ height }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }}
      />
    </div>
  );
}
