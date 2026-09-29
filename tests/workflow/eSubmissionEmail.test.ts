import { describe, it, expect } from "vitest";
import { buildESubmissionEmail, periodEndMMDDYYYY, twelveDigitTin } from "@/lib/workflow/eSubmissionEmail";

/** D87 (brief #5o) — fictitious fixture data only. */
const base = {
  toAddress: "esubmission@example.test",
  period: "Q3" as const,
  taxableYear: 2026,
  formType: "F1701Q",
  registeredName: "Corazon Mendoza",
  tin: "123456789",
  branchCode: "000",
  rdoCode: "050",
};

describe("buildESubmissionEmail", () => {
  it("builds the subject and body in her sent-email format", () => {
    const email = buildESubmissionEmail(base);
    expect(email.to).toBe("esubmission@example.test");
    expect(email.subject).toBe("SAWT 1701Q 09302026 CORAZON MENDOZA 123456789000");
    expect(email.body).toBe("Name: Corazon Mendoza\nTIN: 123456789000\nRDO: 050\nPeriod: 09302026");
    expect(email.rdoMissing).toBe(false);
  });

  it("uses the period end as MMDDYYYY for every period", () => {
    expect(periodEndMMDDYYYY("Q1", 2026)).toBe("03312026");
    expect(periodEndMMDDYYYY("Q2", 2026)).toBe("06302026");
    expect(periodEndMMDDYYYY("Q3", 2026)).toBe("09302026");
    expect(periodEndMMDDYYYY("ANNUAL", 2026)).toBe("12312026");
  });

  it("names the form 1701Q, 1701A or 1701", () => {
    expect(buildESubmissionEmail({ ...base, period: "ANNUAL", formType: "F1701A" }).subject).toContain("SAWT 1701A 12312026");
    expect(buildESubmissionEmail({ ...base, period: "ANNUAL", formType: "F1701" }).subject).toContain("SAWT 1701 12312026");
  });

  it("makes a 12-digit TIN: 9 digits plus the 3-digit branch code, no dashes", () => {
    expect(twelveDigitTin("123-456-789", "0")).toBe("123456789000");
    expect(twelveDigitTin("123456789", "001")).toBe("123456789001");
    expect(buildESubmissionEmail({ ...base, tin: "123-456-789", branchCode: "002" }).subject).toMatch(/ 123456789002$/);
  });

  it("flags a missing RDO code without blocking the draft", () => {
    const email = buildESubmissionEmail({ ...base, rdoCode: "  " });
    expect(email.rdoMissing).toBe(true);
    expect(email.body).toContain("RDO: \n");
  });
});
