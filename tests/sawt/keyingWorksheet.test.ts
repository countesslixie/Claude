import { describe, it, expect } from "vitest";
import { buildKeyingWorksheet, type CertificateForWorksheet } from "@/lib/sawt/keyingWorksheet";

function cert(overrides: Partial<CertificateForWorksheet> = {}): CertificateForWorksheet {
  return {
    id: "cert-1",
    payorTin: "987654321",
    payorName: "Acme Publishing Corp.",
    payorAddress: "123 Makati Ave.",
    atcCode: "WI010",
    atcDescription: "Professional fees — individual",
    incomePaymentCents: 100000,
    taxWithheldCents: 5000,
    ...overrides,
  };
}

describe("buildKeyingWorksheet", () => {
  it("brief #4d: rows are ordered by payorName, numbered from 1 (dateReceived is gone)", () => {
    const worksheet = buildKeyingWorksheet({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      certificates: [
        cert({ id: "later-alphabetically", payorName: "Zenith Corp." }),
        cert({ id: "earlier-alphabetically", payorName: "Acme Publishing Corp." }),
      ],
    });
    expect(worksheet.rows.map((r) => r.certificateId)).toEqual(["earlier-alphabetically", "later-alphabetically"]);
    expect(worksheet.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it("brief #4d: ties on payorName break on payorTin", () => {
    const worksheet = buildKeyingWorksheet({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      certificates: [
        cert({ id: "higher-tin", payorName: "Acme Publishing Corp.", payorTin: "999999999" }),
        cert({ id: "lower-tin", payorName: "Acme Publishing Corp.", payorTin: "111111111" }),
      ],
    });
    expect(worksheet.rows.map((r) => r.certificateId)).toEqual(["lower-tin", "higher-tin"]);
  });

  it("rowCount and totals are the two numbers to check against the module after entry", () => {
    const worksheet = buildKeyingWorksheet({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      certificates: [
        cert({ id: "a", incomePaymentCents: 100000, taxWithheldCents: 5000 }),
        cert({ id: "b", incomePaymentCents: 200000, taxWithheldCents: 10000 }),
      ],
    });
    expect(worksheet.rowCount).toBe(2);
    expect(worksheet.totals).toEqual({ incomePaymentCents: 300000, taxWithheldCents: 15000 });
  });

  it("a null payorTin/payorAddress renders as an empty string, not null, for the exported sheet", () => {
    const worksheet = buildKeyingWorksheet({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      certificates: [cert({ payorTin: null, payorAddress: null })],
    });
    expect(worksheet.rows[0].payorTin).toBe("");
    expect(worksheet.rows[0].payorAddress).toBe("");
  });

  it("no certificates produces an empty worksheet with zero totals", () => {
    const worksheet = buildKeyingWorksheet({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      certificates: [],
    });
    expect(worksheet.rowCount).toBe(0);
    expect(worksheet.totals).toEqual({ incomePaymentCents: 0, taxWithheldCents: 0 });
  });
});
