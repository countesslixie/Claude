"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BackToSettings } from "@/components/back-to-settings";
import { HolidayForm } from "@/components/holiday-form";

/**
 * D169 — the Holidays page's header: the title, an Add holiday button (primary)
 * and Back on the right. The add form stays hidden until Add holiday is clicked,
 * opens above the table, and closes on Save or Cancel (same as Payors, D161).
 */
export function HolidaysHeader() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink">Holidays</h1>
        <div className="flex flex-wrap gap-2">
          {!open && (
            <Button type="button" onClick={() => setOpen(true)}>
              Add holiday
            </Button>
          )}
          <BackToSettings />
        </div>
      </div>
      {open && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-4">
          <HolidayForm onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
