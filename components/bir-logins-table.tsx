"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBirLogins } from "@/lib/actions/birLogins";

/**
 * D180/D181 — every active client's eAFS, Alphalist and ORUS logins in one table: a
 * Username and a Password column under each login. Passwords are always shown in plain
 * text (her decision). Edit turns the row into six boxes in place; only one row is in Edit
 * at a time. Same table look as the ATC and Holidays pages.
 */
export interface BirLoginRow {
  clientId: string;
  name: string;
  eafsUsername: string;
  eafsPassword: string;
  alphalistUsername: string;
  alphalistPassword: string;
  orusUsername: string;
  orusPassword: string;
}

type Kind = "eafs" | "alphalist" | "orus";
const KINDS: { kind: Kind; title: string }[] = [
  { kind: "eafs", title: "eAFS" },
  { kind: "alphalist", title: "Alphalist" },
  { kind: "orus", title: "ORUS" },
];
const PARTS = ["Username", "Password"] as const;
const key = (kind: Kind, part: (typeof PARTS)[number]) => `${kind}${part}` as keyof BirLoginRow & string;

// A thin divider before each login group.
const GROUP_EDGE = "border-l border-line";

function Cell({ value, first }: { value: string; first: boolean }) {
  return (
    <td className={`break-all font-mono text-sm ${first ? GROUP_EDGE : ""}`}>
      {value || <span className="font-sans text-faint">—</span>}
    </td>
  );
}

function RowView({ row, onEdit }: { row: BirLoginRow; onEdit: () => void }) {
  return (
    <tr>
      <td>
        <Link href={`/clients/${row.clientId}`} className="font-medium text-ink hover:underline">
          {row.name}
        </Link>
      </td>
      {KINDS.flatMap(({ kind }) =>
        PARTS.map((part) => <Cell key={`${kind}${part}`} value={row[key(kind, part)] as string} first={part === "Username"} />),
      )}
      <td>
        <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </td>
    </tr>
  );
}

function RowEdit({ row, onDone }: { row: BirLoginRow; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const { kind } of KINDS) for (const part of PARTS) v[key(kind, part)] = row[key(kind, part)] as string;
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
      <td>
        <span className="font-medium text-ink">{row.name}</span>
        {error && <p className="mt-1 text-xs text-red">{error}</p>}
      </td>
      {KINDS.flatMap(({ kind, title }) =>
        PARTS.map((part) => {
          const k = key(kind, part);
          return (
            <td key={k} className={part === "Username" ? GROUP_EDGE : ""}>
              <Input
                value={values[k]}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                aria-label={`${title} ${part.toLowerCase()} for ${row.name}`}
                className="h-8 min-w-0 px-2 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
              {fieldErrors[k] && <span className="text-xs text-red">{fieldErrors[k]}</span>}
            </td>
          );
        }),
      )}
      <td>
        <div className="flex flex-col items-center gap-1">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function BirLoginsTable({ rows }: { rows: BirLoginRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <table className="data-table data-table-centered data-table-tight">
        <thead>
          <tr>
            <th rowSpan={2} style={{ width: "16%" }}>
              Client
            </th>
            {KINDS.map(({ kind, title }) => (
              <th key={kind} colSpan={2} className={GROUP_EDGE}>
                {title}
              </th>
            ))}
            <th rowSpan={2} style={{ width: "12%" }}></th>
          </tr>
          <tr>
            {KINDS.flatMap(({ kind }) =>
              PARTS.map((part) => (
                <th key={`${kind}${part}`} className={part === "Username" ? GROUP_EDGE : ""}>
                  {part}
                </th>
              )),
            )}
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
              <td colSpan={8} className="py-8 text-center text-sm text-faint">
                No active clients.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
