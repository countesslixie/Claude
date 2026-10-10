import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdviceMessageCard } from "@/components/advice-message-card";
import { ClientDetailsBox } from "@/components/client-details-box";
import { Form2307sOnReturn, sortForm2307List } from "@/components/form-2307s-on-return";
import { FileGroupDocStepCard } from "@/components/file-group-doc-step-card";

const render = (c: unknown, p: Record<string, unknown>) => renderToStaticMarkup(createElement(c as never, p as never, null));

const advice = (over: Record<string, unknown> = {}) =>
  render(AdviceMessageCard, {
    clientId: "c1", clientEmail: "sample.client@example.com", isDone: false, savedAtLabel: null, isOverpayment: false,
    amountLabel: "₱1.00", subject: "Subject line", body: "Body text", ...over,
  });

const copies = (h: string) => (h.match(/>Copy</g) ?? []).length;

describe("D191/D198 — step 4's To and Subject rows, each with Copy (the same rows as step 16)", () => {
  it("shows To and Subject rows, each with its own Copy, plus the body's Copy; To sits above Subject", () => {
    const h = advice();
    expect(h).toContain("sample.client@example.com");
    expect(h.indexOf(">To<")).toBeLessThan(h.indexOf(">Subject<"));
    expect(h).toContain("Subject line");
    expect(copies(h)).toBe(3);
    expect(h).not.toContain("mailto:");
  });
  it("a client with no email shows the muted missing line, linking to the client page, and no Copy on To", () => {
    const h = advice({ clientEmail: null });
    expect(h).toContain("Client email missing");
    expect(h).toContain("/clients/c1/edit");
    expect(h).not.toContain(">To<");
    expect(copies(h)).toBe(2); // Subject + body
  });
  it("a Complete filing has no Copy anywhere, saved or not — as step 16", () => {
    expect(copies(advice({ readOnly: true }))).toBe(0);
    const saved = render(AdviceMessageCard, {
      clientId: "c1", clientEmail: "sample.client@example.com", isDone: true, savedAtLabel: "Oct 1, 2026", isOverpayment: false,
      amountLabel: "₱1.00", subject: "S", body: "B", readOnly: true,
    });
    expect(copies(saved)).toBe(0);
  });
  it("step 16 and step 4 use the one shared row component", () => {
    for (const f of ["components/client-package-step-card.tsx", "components/advice-message-card.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain("CopyRow");
    }
  });
});

describe("D197 — step 3's Client details box: content-sized items, each value centred under its label", () => {
  it("items sit side by side from the left (wrapping flex, ~40px gap), each item centred; no equal-width grid", () => {
    const h = render(ClientDetailsBox, { tin: "123456789", branchCode: "000", birthDate: new Date("1990-01-04T16:00:00.000Z") });
    expect(h).toMatch(/<dl class="[^"]*\bflex\b[^"]*\bflex-wrap\b[^"]*\bgap-x-10\b/);
    expect(h).not.toContain("grid-cols-3");
    expect((h.match(/<div class="text-center">/g) ?? []).length).toBe(3);
    expect(h).toContain("123-456-789");
  });
});

describe("D199 — the filing page's \"Filing details\" disclosure is gone", () => {
  const src = readFileSync("app/(app)/clients/[id]/filings/[filingId]/page.tsx", "utf8");
  it("renders neither the disclosure nor the working-calendar line", () => {
    expect(src).not.toContain("Filing details");
    expect(src).not.toContain("Working calendar");
    expect(src).not.toContain("<details");
  });
  it("the header's due date is still shown", () => {
    expect(src).toContain("- due {formatManilaDateLong(filing.adjustedDueDate)}");
  });
});

const certs = [
  { id: "b", payorName: "Zeta Corp", payorTin: "123456789012", atcCode: "WC158", incomePaymentCents: 20_000_00, taxWithheldCents: 400_00 },
  { id: "a", payorName: "Alpha Inc", payorTin: "999888777", atcCode: "WI010", incomePaymentCents: 10_000_00, taxWithheldCents: 500_00 },
  { id: "c", payorName: "Alpha Inc", payorTin: "111222333", atcCode: "WI011", incomePaymentCents: 5_000_00, taxWithheldCents: 250_00 },
];

describe("D195 — Form 2307s on this return (step 11)", () => {
  it("orders by payor name then TIN", () => {
    expect(sortForm2307List(certs).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
  it("shows dashed TINs (12-digit with branch), amounts, centred cells, and no buttons or links", () => {
    const h = render(Form2307sOnReturn, { rows: certs });
    expect(h).toContain("Form 2307s on this return");
    for (const t of ["111-222-333", "999-888-777", "123-456-789-012", "WI010", "₱10,000.00", "₱500.00"]) expect(h).toContain(t);
    expect(h).not.toContain("<button");
    expect(h).not.toContain("<a ");
    const headCells = h.match(/<th [^>]*>/g) ?? [];
    expect(headCells).toHaveLength(5);
    for (const c of [...headCells, ...(h.match(/<td [^>]*>/g) ?? [])]) expect(c).toContain("text-center");
  });

  const card = (status: string, extra: Record<string, unknown> = {}) =>
    render(FileGroupDocStepCard, {
      stepId: "s", sequence: 11, title: "Alphalist data entry + validation", status, isUnlocked: true, lockedMessage: "",
      slots: [{ slotCode: "generated_report", label: "Generated report", documents: [] }],
      waitingOnLabel: null, agingDaysWaiting: null, agingTone: null,
      aboveSlots: createElement(Form2307sOnReturn, { rows: certs }), ...extra,
    });
  it("sits above the upload boxes; shown when locked and when Complete; absent when the step is NA", () => {
    const open = card("PENDING");
    expect(open.indexOf("Form 2307s on this return")).toBeLessThan(open.indexOf("Generated report"));
    expect(card("PENDING", { isUnlocked: false, lockedMessage: "Available once step 8 is done." })).toContain("Form 2307s on this return");
    expect(card("DONE", { readOnly: true })).toContain("Form 2307s on this return");
    expect(card("NA")).not.toContain("Form 2307s on this return");
  });
});
