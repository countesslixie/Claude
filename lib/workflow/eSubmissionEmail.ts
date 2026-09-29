import type { Period } from "@/lib/tax/types";

/**
 * D87 (brief #5o §4) — step 12's ready-to-copy email to BIR eSubmission,
 * built the same way as step 4's client message: a pure function, no I/O,
 * so what she sees and what gets saved when the step is marked Done can
 * never drift apart. Format taken from her own sent emails:
 *
 *   Subject: SAWT {form} {period end MMDDYYYY} {REGISTERED NAME} {12-digit TIN}
 *   Body:    Name / TIN / RDO / Period — one line each.
 *
 * The subject uses the client's registered name in capitals (her decision —
 * not a separately stored surname); the draft is editable text, so she can
 * shorten it by hand. The TIN is the 9-digit TIN plus the 3-digit branch
 * code, no dashes. The recipient address is a setting (TaxRuleSet.eSubmissionEmail,
 * D4 — never a literal here).
 */
export interface ESubmissionEmailInput {
  /** TaxRuleSet.eSubmissionEmail. */
  toAddress: string;
  period: Period;
  taxableYear: number;
  /** "F1701Q" | "F1701A" | "F1701" — Filing.formType. */
  formType: string;
  registeredName: string;
  tin: string;
  branchCode: string;
  rdoCode: string | null | undefined;
}

export interface ESubmissionEmail {
  to: string;
  subject: string;
  body: string;
  /** "" when the client has no RDO code — the card shows a muted note instead of a value. */
  rdoMissing: boolean;
}

/** MMDD of each period's last day — a fixed table, so no date arithmetic (D20) is needed. */
const PERIOD_END_MMDD: Record<Period, string> = { Q1: "0331", Q2: "0630", Q3: "0930", ANNUAL: "1231" };

export function periodEndMMDDYYYY(period: Period, taxableYear: number): string {
  return `${PERIOD_END_MMDD[period]}${taxableYear}`;
}

export function formLabel(formType: string): string {
  return formType.replace(/^F/, "");
}

/** 9-digit TIN + 3-digit branch code, digits only (any dashes or spaces in the stored values are dropped). */
export function twelveDigitTin(tin: string, branchCode: string): string {
  const digits = (v: string) => v.replace(/\D/g, "");
  return `${digits(tin)}${digits(branchCode).padStart(3, "0")}`;
}

export function buildESubmissionEmail(input: ESubmissionEmailInput): ESubmissionEmail {
  const periodEnd = periodEndMMDDYYYY(input.period, input.taxableYear);
  const tin12 = twelveDigitTin(input.tin, input.branchCode);
  const rdo = (input.rdoCode ?? "").trim();
  return {
    to: input.toAddress,
    subject: `SAWT ${formLabel(input.formType)} ${periodEnd} ${input.registeredName.trim().toUpperCase()} ${tin12}`,
    body: [
      `Name: ${input.registeredName.trim()}`,
      `TIN: ${tin12}`,
      `RDO: ${rdo}`,
      `Period: ${periodEnd}`,
    ].join("\n"),
    rdoMissing: rdo === "",
  };
}
