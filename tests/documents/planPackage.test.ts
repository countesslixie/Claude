import { describe, it, expect } from "vitest";
import { planPackageDocuments, packageZipName } from "@/lib/documents/filingPackage";

/** D103 (brief #5r) — the package's one document list: flat names, unique, labelled; the email's list and the zip both come from it. */
describe("planPackageDocuments", () => {
  const slots = JSON.stringify([{ slotCode: "proof", label: "Proof of payment", required: true, acceptedTypes: [] }]);
  const steps = [
    { id: "s9", sequence: 9, title: "Save proof of payment", requiredDocSlots: slots },
    { id: "s2", sequence: 2, title: "Receive Form 2307", requiredDocSlots: "[]" },
  ];

  it("orders by step, keeps saved names, labels by slot and by payor for certificates", () => {
    const docs = planPackageDocuments(steps, [
      { id: "d1", workflowStepId: "s9", docSlotCode: "proof", originalFilename: "proof.pdf", storedPath: "a" },
      { id: "d2", workflowStepId: "s2", docSlotCode: "form2307_scan", originalFilename: "scan.pdf", storedPath: "b", form2307PayorName: "Sample Payor Inc." },
    ]);
    expect(docs.map((d) => d.zipName)).toEqual(["scan.pdf", "proof.pdf"]);
    expect(docs.map((d) => d.label)).toEqual(["Form 2307 — Sample Payor Inc.", "Proof of payment"]);
    for (const d of docs) expect(d.zipName).not.toContain("/");
  });

  it("adds a short suffix instead of overwriting when two names collide", () => {
    const docs = planPackageDocuments(steps, [
      { id: "d1", workflowStepId: "s2", docSlotCode: null, originalFilename: "scan.pdf", storedPath: "a" },
      { id: "d2", workflowStepId: "s9", docSlotCode: "proof", originalFilename: "scan.pdf", storedPath: "b" },
      { id: "d3", workflowStepId: "s9", docSlotCode: "proof", originalFilename: "SCAN.pdf", storedPath: "c" },
    ]);
    expect(docs.map((d) => d.zipName)).toEqual(["scan.pdf", "scan (2).pdf", "SCAN (3).pdf"]);
  });
});

describe("packageZipName", () => {
  it("is plain: client, form, period, year", () => {
    expect(packageZipName({ registeredName: "Rosario Garcia", formType: "F1701Q", period: "Q3", taxableYear: 2026 })).toBe("Rosario Garcia - 1701Q Q3 2026.zip");
    expect(packageZipName({ registeredName: "Rosario Garcia", formType: "F1701A", period: "ANNUAL", taxableYear: 2026 })).toBe("Rosario Garcia - 1701A Annual 2026.zip");
  });
  it("drops characters a file name cannot hold", () => {
    expect(packageZipName({ registeredName: 'A/B: "C"', formType: "F1701Q", period: "Q1", taxableYear: 2026 })).toBe("AB C - 1701Q Q1 2026.zip");
  });
});
