"use client";

import { useState, useRef, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createQuickTransaction } from "@/lib/actions/salesTransactions";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Row = {
  transactionDate: string;
  orNumber: string;
  payorName: string;
  payorTin: string;
  grossAmount: string;
  withholdingRateBps: string;
  withholdingAmount: string;
  netReceivedOverride: string;
  incomeType: "OPERATING" | "NON_OPERATING";
  description: string;
};

function emptyRow(defaultRateBps: number, carriedDate: string): Row {
  return {
    transactionDate: carriedDate,
    orNumber: "",
    payorName: "",
    payorTin: "",
    grossAmount: "",
    withholdingRateBps: String(defaultRateBps),
    withholdingAmount: "",
    netReceivedOverride: "",
    incomeType: "OPERATING",
    description: "",
  };
}

function parsePesos(value: string): number {
  const n = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fast keyboard-first manual entry (SPEC.md WORKFLOW CHANGE item 2 — the
 * exception path for receipts with no Form 2307). No modal, no save
 * button: Tab moves across fields (native DOM order), Enter commits the
 * row and starts a new one with the date carried over.
 */
export function TransactionQuickEntry({
  clientId,
  defaultWithholdingRateBps,
}: {
  clientId: string;
  defaultWithholdingRateBps: number;
}) {
  const router = useRouter();
  const [row, setRow] = useState<Row>(() => emptyRow(defaultWithholdingRateBps, ""));
  const [message, setMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const payorNameRef = useRef<HTMLInputElement>(null);

  const grossNum = parsePesos(row.grossAmount);
  const explicitWhtNum = row.withholdingAmount ? parsePesos(row.withholdingAmount) : null;
  const rateNum = parseFloat(row.withholdingRateBps) || 0;
  const autoWhtNum = explicitWhtNum ?? Math.round(((grossNum * rateNum) / 10000) * 100) / 100;
  const derivedNetNum = Math.round((grossNum - autoWhtNum) * 100) / 100;
  const netOverrideNum = row.netReceivedOverride ? parsePesos(row.netReceivedOverride) : null;
  const netMismatch = netOverrideNum !== null && Math.abs(netOverrideNum - derivedNetNum) > 0.001;

  function update<K extends keyof Row>(key: K, value: Row[K]) {
    setRow((r) => ({ ...r, [key]: value }));
  }

  function commit() {
    if (!row.transactionDate || !row.payorName || !row.grossAmount) {
      setMessage({ tone: "error", text: "Date, payor, and gross amount are required." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await createQuickTransaction(clientId, {
        transactionDate: row.transactionDate,
        orNumber: row.orNumber,
        payorName: row.payorName,
        payorTin: row.payorTin,
        grossAmount: row.grossAmount,
        withholdingRateBps: row.withholdingRateBps,
        withholdingAmount: row.withholdingAmount,
        netReceivedOverride: row.netReceivedOverride,
        incomeType: row.incomeType,
        description: row.description,
      });

      if (!result.ok) {
        setMessage({ tone: "error", text: result.error || "Could not save that row — check the fields." });
        return;
      }

      if (result.duplicateOrWarning || result.netReceivedMismatchWarning) {
        setMessage({
          tone: "warning",
          text: [result.duplicateOrWarning, result.netReceivedMismatchWarning].filter(Boolean).join(" "),
        });
      } else {
        setMessage(null);
      }

      // Date carries over to the next row; everything else resets.
      setRow(emptyRow(defaultWithholdingRateBps, row.transactionDate));
      router.refresh();
      payorNameRef.current?.focus();
    });
  }

  function onEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-9 gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        <span>Date</span>
        <span>OR #</span>
        <span className="col-span-2">Payor</span>
        <span>TIN</span>
        <span>Gross</span>
        <span>WHT</span>
        <span>Net</span>
        <span>Type</span>
      </div>
      <div className="mt-1 grid grid-cols-9 gap-2">
        <Input
          type="date"
          value={row.transactionDate}
          onChange={(e) => update("transactionDate", e.target.value)}
          onKeyDown={onEnter}
        />
        <Input
          placeholder="OR #"
          value={row.orNumber}
          onChange={(e) => update("orNumber", e.target.value)}
          onKeyDown={onEnter}
        />
        <Input
          ref={payorNameRef}
          className="col-span-2"
          placeholder="Payor name"
          value={row.payorName}
          onChange={(e) => update("payorName", e.target.value)}
          onKeyDown={onEnter}
        />
        <Input
          placeholder="TIN"
          value={row.payorTin}
          onChange={(e) => update("payorTin", e.target.value)}
          onKeyDown={onEnter}
        />
        <Input
          placeholder="0.00"
          value={row.grossAmount}
          onChange={(e) => update("grossAmount", e.target.value)}
          onKeyDown={onEnter}
        />
        <Input
          placeholder={autoWhtNum.toFixed(2)}
          value={row.withholdingAmount}
          onChange={(e) => update("withholdingAmount", e.target.value)}
          onKeyDown={onEnter}
          title={`Auto: gross × ${(rateNum / 100).toFixed(2)}% = ${autoWhtNum.toFixed(2)}. Editable.`}
        />
        <Input
          placeholder={derivedNetNum.toFixed(2)}
          value={row.netReceivedOverride}
          onChange={(e) => update("netReceivedOverride", e.target.value)}
          onKeyDown={onEnter}
          className={netMismatch ? "border-amber-400" : undefined}
        />
        <Select
          value={row.incomeType}
          onChange={(e) => update("incomeType", e.target.value as Row["incomeType"])}
        >
          <option value="OPERATING">Operating</option>
          <option value="NON_OPERATING">Non-operating</option>
        </Select>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Press Enter in any field to save the row and start the next one. Rate defaults to{" "}
          {(defaultWithholdingRateBps / 100).toFixed(2)}% — override the WHT amount if different.
        </p>
        {isPending && <span className="text-xs text-slate-400">Saving…</span>}
      </div>
      {message && (
        <p
          className={`mt-2 rounded-md px-3 py-2 text-sm ${
            message.tone === "warning" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}
      {netMismatch && !message && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Net received doesn&apos;t match gross − withholding (expected {derivedNetNum.toFixed(2)}). It will
          be saved as entered.
        </p>
      )}
    </div>
  );
}
