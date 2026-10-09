"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBirLogins } from "@/lib/actions/birLogins";

/**
 * D180 — every active client's eAFS and Alphalist logins on one page. Passwords are
 * always shown in plain text (her decision). Each login's three values stack inside its
 * cell so the table never needs a sideways scroll. Edit opens the row's six boxes in place.
 */
export interface BirLoginRow {
  clientId: string;
  name: string;
  eafsUsername: string;
  eafsPassword: string;
  eafsNotes: string;
  alphalistUsername: string;
  alphalistPassword: string;
  alphalistNotes: string;
}

type Kind = "eafs" | "alphalist";
const KINDS: { kind: Kind; title: string }[] = [
  { kind: "eafs", title: "eAFS" },
  { kind: "alphalist", title: "Alphalist" },
];
const key = (kind: Kind, part: "Username" | "Password" | "Notes") =>
  `${kind}${part}` as keyof BirLoginRow;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the value is on screen to select by hand */
    }
  }
  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Value({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <span className="text-xs text-faint">{label}</span>
      {value ? <span className="break-all font-mono text-sm text-ink">{value}</span> : <span className="text-faint">—</span>}
      {copy && value && <CopyButton value={value} label={label.toLowerCase()} />}
    </div>
  );
}

function RowView({ row, onEdit }: { row: BirLoginRow; onEdit: () => void }) {
  return (
    <tr>
      <td className="align-top">
        <Link href={`/clients/${row.clientId}`} className="font-medium text-ink hover:underline">
          {row.name}
        </Link>
        <div className="mt-2">
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </td>
      {KINDS.map(({ kind }) => (
        <td key={kind} className="space-y-1 align-top">
          <Value label="Username" value={row[key(kind, "Username")]} copy />
          <Value label="Password" value={row[key(kind, "Password")]} copy />
          <Value label="Notes" value={row[key(kind, "Notes")]} />
        </td>
      ))}
    </tr>
  );
}

function RowEdit({ row, onDone }: { row: BirLoginRow; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const { kind } of KINDS) for (const part of ["Username", "Password", "Notes"] as const) v[key(kind, part)] = row[key(kind, part)];
    return v;
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    const r = await saveBirLogins(row.clientId, values);
    setPending(false);
    if (r.ok) return onDone();
    setError(r.error);
    setFieldErrors(r.fieldErrors ?? {});
  }

  return (
    <tr>
      <td className="align-top">
        <span className="font-medium text-ink">{row.name}</span>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={save} disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red">{error}</p>}
      </td>
      {KINDS.map(({ kind, title }) => (
        <td key={kind} className="space-y-2 align-top">
          {(["Username", "Password", "Notes"] as const).map((part) => {
            const k = key(kind, part);
            return (
              <label key={part} className="block text-left">
                <span className="text-xs text-faint">{part}</span>
                <Input
                  value={values[k]}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  aria-label={`${title} ${part.toLowerCase()} for ${row.name}`}
                  autoComplete="off"
                  spellCheck={false}
                />
                {fieldErrors[k] && <span className="text-xs text-red">{fieldErrors[k]}</span>}
              </label>
            );
          })}
        </td>
      ))}
    </tr>
  );
}

export function BirLoginsTable({ rows }: { rows: BirLoginRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <table className="data-table data-table-centered" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: "24%" }}>Client</th>
            <th>eAFS</th>
            <th>Alphalist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            editing === row.clientId ? (
              <RowEdit key={row.clientId} row={row} onDone={() => setEditing(null)} />
            ) : (
              <RowView key={row.clientId} row={row} onEdit={() => setEditing(row.clientId)} />
            ),
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-8 text-center text-sm text-faint">
                No active clients.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
