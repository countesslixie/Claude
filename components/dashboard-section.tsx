"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * D126 — a dashboard section: white card, bold title, count chip, chevron.
 * Clicking the header line opens or closes it. It starts open when it has
 * entries and closed when it is empty (no saved state); an empty section,
 * once opened, says so in one muted line.
 */
export function DashboardSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-2 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-faint" /> : <ChevronRight className="h-4 w-4 text-faint" />}
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="inline-flex items-center justify-center rounded-full bg-line px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary">
          {count}
        </span>
      </button>
      {open && (
        <div className="border-t border-line">
          {count === 0 ? <p className="px-5 py-3 text-[13px] text-faint">Nothing here right now.</p> : children}
        </div>
      )}
    </Card>
  );
}
