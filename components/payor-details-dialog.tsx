"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AtcCodeSelect, type SelectableAtcCode } from "@/components/atc-code-select";
import type { SavedPayor } from "@/lib/actions/payors";

/**
 * Brief #5b — "Save … to payors" opens this dialog instead of saving the
 * name alone, so TIN/address/usual ATC can be captured right away when
 * she already has them. Only the name is required — she often records
 * income long before she has a payor's TIN, and a blank field here is
 * saved blank. Cancel (the X, the Cancel button, or Escape) leaves
 * whatever she'd already typed in the row untouched and unsaved, same as
 * "Not now". One dialog serves both step 1 (name only, TIN/address/ATC
 * left blank) and step 2 (she can fill them here if she already knows
 * them, or leave them for the fill-back offer once she types them on the
 * certificate itself).
 *
 * Built with a native `<dialog>` element — Escape-to-close and focus
 * containment come from the browser for free, no Radix (installed but
 * unused in this codebase) and no new dependency.
 */
export function PayorDetailsDialog({
  open,
  initialName,
  atcCodes,
  onSave,
  onClose,
}: {
  open: boolean;
  initialName: string;
  atcCodes: SelectableAtcCode[];
  onSave: (draft: {
    name: string;
    tin?: string;
    address?: string;
    usualAtcCode?: string;
  }) => Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [tin, setTin] = useState("");
  const [address, setAddress] = useState("");
  const [usualAtcCode, setUsualAtcCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setName(initialName);
      setTin("");
      setAddress("");
      setUsualAtcCode("");
      setError(null);
      dlg.showModal();
      firstFieldRef.current?.focus();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, initialName]);

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    const result = await onSave({
      name: trimmedName,
      tin: tin.trim() || undefined,
      address: address.trim() || undefined,
      usualAtcCode: usualAtcCode || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 m-auto w-full max-w-sm rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/30"
    >
      <div className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Save to payors</h2>
        <div className="mt-3 flex flex-col gap-3">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-col gap-1">
            <Label htmlFor="payor-dialog-name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="payor-dialog-name"
              ref={firstFieldRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="payor-dialog-tin">TIN</Label>
            <Input id="payor-dialog-tin" value={tin} onChange={(e) => setTin(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="payor-dialog-address">Address</Label>
            <Input id="payor-dialog-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="payor-dialog-atc">Usual ATC code</Label>
            <AtcCodeSelect
              id="payor-dialog-atc"
              name="usualAtcCode"
              atcCodes={atcCodes}
              value={usualAtcCode}
              onChange={setUsualAtcCode}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <button type="button" onClick={onClose} className="text-xs text-slate-400 underline">
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
