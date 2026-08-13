"use client";

import { useEffect, useState } from "react";

/** Gera o QR code no navegador (biblioteca carregada sob demanda). */
export function QRCode({ value, size = 180 }: { value: string; size?: number }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    if (!value) return;
    import("qrcode")
      .then((mod) =>
        mod.toDataURL(value, { width: size * 2, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } }),
      )
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400"
        style={{ width: size, height: size }}
      >
        gerando...
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="QR code"
      width={size}
      height={size}
      className="rounded-lg border border-slate-200"
    />
  );
}
