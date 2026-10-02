import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { compareRegisterRows, registerPeriodLabel, planRegisterZip, register2307ZipName, loadRegisterRows } from "@/lib/form2307Register";

describe("Form 2307 register (D160)", () => {
  it("labels a quarter and the Annual with the year", () => {
    expect(registerPeriodLabel("Q3", 2026)).toBe("Q3 2026");
    expect(registerPeriodLabel("ANNUAL", 2026)).toBe("Annual 2026");
    expect(registerPeriodLabel(null, 2026)).toBe("—");
  });

  it("sorts by period (Q1, Q2, Q3, Annual) then by the day entered", () => {
    const d = (day: number) => new Date(Date.UTC(2026, 9, day));
    const rows = [
      { id: "annual", period: "ANNUAL", enteredAt: d(1) },
      { id: "q3-late", period: "Q3", enteredAt: d(9) },
      { id: "q1", period: "Q1", enteredAt: d(20) },
      { id: "q3-early", period: "Q3", enteredAt: d(2) },
      { id: "none", period: null, enteredAt: d(1) },
      { id: "q2", period: "Q2", enteredAt: d(5) },
    ];
    expect([...rows].sort(compareRegisterRows).map((r) => r.id)).toEqual(["q1", "q2", "q3-early", "q3-late", "annual", "none"]);
  });

  it("names the zip plainly and keeps saved file names, adding (2) on a collision", () => {
    expect(register2307ZipName("Gloria Tolentino", 2026)).toBe("Gloria Tolentino - Form 2307s 2026.zip");
    const planned = planRegisterZip([{ originalFilename: "scan.pdf" }, { originalFilename: "Scan.pdf" }, { originalFilename: "scan.pdf" }, { originalFilename: "other.png" }]);
    expect(planned.map((p) => p.zipName)).toEqual(["scan.pdf", "Scan (2).pdf", "scan (3).pdf", "other.png"]);
  });

  describe("loading", () => {
    const ids: string[] = [];
    afterAll(async () => {
      await prisma.document.deleteMany({ where: { clientId: { in: ids } } });
      await prisma.form2307.deleteMany({ where: { clientId: { in: ids } } });
      await prisma.client.deleteMany({ where: { id: { in: ids } } });
    });

    it("offers only the current scan — a replaced (soft-deleted) one is never listed", async () => {
      const actorId = (await prisma.user.findFirstOrThrow()).id;
      const c = await prisma.client.create({
        data: { code: `d160-${Date.now()}`, registeredName: "Register Test", tin: "1", rdoCode: "1", registeredAddress: "N/A", taxpayerType: "PURELY_SELF_EMPLOYED", booksType: "MANUAL" },
      });
      ids.push(c.id);
      const cert = await prisma.form2307.create({
        data: { clientId: c.id, taxableYear: 2026, payorName: "P", payorTin: "1", periodFrom: new Date(), periodTo: new Date(), quarterCovered: 3, atcCode: "WI010", incomePaymentCents: 100, taxWithheldCents: 5, withholdingRateBps: 500, status: "RECORDED" },
      });
      const doc = (name: string, deletedAt: Date | null, at: number) =>
        prisma.document.create({
          data: { clientId: c.id, form2307Id: cert.id, category: "OTHER", originalFilename: name, storedPath: `x/${name}`, mimeType: "application/pdf", sizeBytes: 1, sha256: name.padEnd(64, "0"), documentDate: new Date(), uploadedAt: new Date(at), deletedAt, actorId },
        });
      await doc("old.pdf", new Date(), 1000);
      await doc("current.pdf", null, 2000);
      const rows = await loadRegisterRows(c.id, 2026);
      expect(rows).toHaveLength(1);
      expect(rows[0].scan?.originalFilename).toBe("current.pdf");
    });
  });
});
