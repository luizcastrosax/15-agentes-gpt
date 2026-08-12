"use client";

import { QRCode } from "./QRCode";
import { CopyButton } from "./ui";

export function ShareLink({
  url,
  title,
  description,
  whatsappMessage,
  compact,
}: {
  url: string;
  title: string;
  description?: string;
  whatsappMessage?: string;
  compact?: boolean;
}) {
  const waHref = `https://wa.me/?text=${encodeURIComponent(whatsappMessage || `${title}: ${url}`)}`;

  return (
    <div className={`flex flex-wrap items-center gap-4 ${compact ? "" : "sm:flex-nowrap"}`}>
      <QRCode value={url} size={compact ? 120 : 150} />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-[13px] font-semibold text-slate-800">{title}</p>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-600">{url}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={url} label="Copiar link" className="btn-primary btn-sm" />
          <a href={waHref} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
            Enviar no WhatsApp
          </a>
          <a href={url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
            Abrir
          </a>
        </div>
      </div>
    </div>
  );
}
