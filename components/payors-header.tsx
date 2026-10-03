"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PayorForm } from "@/components/payor-form";
import type { SelectableAtcCode } from "@/components/atc-code-select";
import type { PayorFormState } from "@/lib/actions/payors";

/**
 * D161 — the Payors page's header: the title, an Add payor button (primary)
 * and Back to client on the right. The Add form stays hidden until Add payor
 * is clicked, opens above the table, and closes on Save or Cancel.
 */
export function PayorsHeader({
  title,
  clientId,
  atcCodes,
  action,
}: {
  title: string;
  clientId: string;
  atcCodes: SelectableAtcCode[];
  action: (state: PayorFormState, formData: FormData) => Promise<PayorFormState>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div id="client-page-header" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <div className="flex flex-wrap gap-2">
          {!open && (
            <Button type="button" onClick={() => setOpen(true)}>
              Add payor
            </Button>
          )}
          <Link href={`/clients/${clientId}`}>
            <Button variant="secondary">
              Back to client
            </Button>
          </Link>
        </div>
      </div>
      {open && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-4">
          <PayorForm
            action={action}
            atcCodes={atcCodes}
            submitLabel="Save"
            resetOnSuccess
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
