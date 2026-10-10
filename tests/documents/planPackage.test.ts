import { describe, it, expect } from "vitest";
import { planPackageDocuments, packageZipName, type PackageNaming } from "@/lib/documents/filingPackage";

const naming: PackageNaming = { registeredName: "Rosario Garcia", formType: "F1701Q", period: "Q3", taxableYear: 2026 };

/** D103 (brief #5r) — the package's one document list: flat names, unique, labelled; the email's list and the zip both come from it. */
describe("planPackageDocuments", () => {
  const slots = JSON.stringify([{ slotCode: "proof", label: "Proof of payment", required: true, acceptedTypes: [] }]);
  const steps = [
    { id: "s9", stepCode: "SAVE_PROOF_PAYMENT", sequence: 9, title: "Save proof of payment", requiredDocSlots: slots },
    { id: "s2", stepCode: "RECEIVE_2307", sequence: 2, title: "Receive Form 2307", requiredDocSlots: "[]" },
  ];

  it("orders by step, gives standard names (D111), labels by slot and by payor for certificates", () => {
    const docs = planPackageDocuments(steps, [
      { id: "d1", workflowStepId: "s9", docSlotCode: "proof", originalFilename: "proof.pdf", storedPath: "a" },
      { id: "d2", workflowStepId: "s2", docSlotCode: "form2307_scan", originalFilename: "scan.pdf", storedPath: "b", form2307PayorName: "Sample Payor Inc." },
    ], naming);
    expect(docs.map((d) => d.zipName)).toEqual([
      "Rosario Garcia - 1701Q Q3 2026 - Form 2307 - Sample Payor Inc.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - Proof of payment.pdf",
    ]);
    expect(docs.map((d) => d.label)).toEqual(["Form 2307 (Sample Payor Inc.)", "Proof of payment"]);
    for (const d of docs) expect(d.zipName).not.toContain("/");
  });

  it("adds (2) when two certificates share a payor, and strips characters Windows disallows (D111)", () => {
    const docs = planPackageDocuments(steps, [
      { id: "d1", workflowStepId: "s2", docSlotCode: "form2307_scan", originalFilename: "one.PDF", storedPath: "a", form2307PayorName: "Acme" },
      { id: "d2", workflowStepId: "s2", docSlotCode: "form2307_scan", originalFilename: "two.pdf", storedPath: "b", form2307PayorName: "Acme" },
      { id: "d3", workflowStepId: "s2", docSlotCode: "form2307_scan", originalFilename: "three.png", storedPath: "c", form2307PayorName: 'A/B: "C"?' },
    ], naming);
    expect(docs.map((d) => d.zipName)).toEqual([
      "Rosario Garcia - 1701Q Q3 2026 - Form 2307 - Acme.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - Form 2307 - Acme (2).pdf",
      "Rosario Garcia - 1701Q Q3 2026 - Form 2307 - AB C.png",
    ]);
  });

  it("the Annual uses 1701A Annual [year]", () => {
    const docs = planPackageDocuments(steps, [{ id: "d1", workflowStepId: "s9", docSlotCode: "proof", originalFilename: "x.pdf", storedPath: "a" }], {
      registeredName: "Rosario Garcia", formType: "F1701A", period: "ANNUAL", taxableYear: 2026,
    });
    expect(docs[0].zipName).toBe("Rosario Garcia - 1701A Annual 2026 - Proof of payment.pdf");
  });
});

/** D108 (brief #5s) -- only the filed return, proof of payment, TRRC, SAWT acknowledgement and Form 2307 scans go to the client. */
describe("what the client package holds (D108)", () => {
  const step = (id: string, stepCode: string, sequence: number) => ({ id, stepCode, sequence, title: stepCode, requiredDocSlots: "[]" });
  const allSteps = [
    step("t2", "RECEIVE_2307", 2),
    step("t3", "PREPARE_RETURN", 3),
    step("t6", "SAVE_SUBMISSION_SS", 6),
    step("t7", "SAVE_FORM_COPY", 7),
    step("t9", "SAVE_PROOF_PAYMENT", 9),
    step("t10", "RECEIVE_TRRC", 10),
    step("t11", "ALPHALIST_ENTRY", 11),
    step("t13", "SAWT_ACK", 13),
    step("t14", "SAWT_VALIDATION", 14),
  ];
  const doc = (id: string, stepId: string, slot: string, name: string, payor?: string) => ({
    id, workflowStepId: stepId, docSlotCode: slot, originalFilename: name, storedPath: id, form2307PayorName: payor ?? null,
  });
  const everything = [
    doc("a", "t2", "form2307_scan", "cert.pdf", "Sample Payor Inc."),
    doc("b", "t3", "draft_computation", "computation.html"),
    doc("c", "t6", "submission_screenshot", "screenshot.pdf"),
    doc("d", "t7", "filed_form", "filed.pdf"),
    doc("e", "t9", "proof", "proof.pdf"),
    doc("f", "t10", "trrc", "trrc.pdf"),
    doc("g", "t11", "generated_report", "report.pdf"),
    doc("h", "t11", "dat_file", "file.dat"),
    doc("i", "t13", "acknowledgement", "ack.pdf"),
    doc("j", "t14", "validation_email", "validation.pdf"),
  ];

  it("a certificate filing lists all five kinds and nothing else", () => {
    const docs = planPackageDocuments(allSteps, everything, naming);
    expect(docs.map((d) => d.zipName)).toEqual([
      "Rosario Garcia - 1701Q Q3 2026 - Form 2307 - Sample Payor Inc.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - Filed return.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - Proof of payment.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - TRRC.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - SAWT acknowledgement.pdf",
    ]);
    expect(docs.map((d) => d.label)).toEqual([
      "Form 2307 (Sample Payor Inc.)",
      "Filed return",
      "Proof of payment",
      "BIR confirmation (TRRC)",
      "SAWT acknowledgement email",
    ]);
  });

  it("a no-certificate overpayment filing lists only the filed return and the TRRC, with no placeholder lines", () => {
    const docs = planPackageDocuments(allSteps, everything.filter((d) => ["b", "c", "d", "f"].includes(d.id)), naming);
    expect(docs.map((d) => d.label)).toEqual(["Filed return", "BIR confirmation (TRRC)"]);
    expect(docs.map((d) => d.zipName)).toEqual(["Rosario Garcia - 1701Q Q3 2026 - Filed return.pdf", "Rosario Garcia - 1701Q Q3 2026 - TRRC.pdf"]);
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

/** D194 -- step 7's two pages go in the zip under page names; the email lists "Filed return" once. */
describe("the filed return's two pages (D194)", () => {
  const slots = JSON.stringify([
    { slotCode: "filed_form", label: "Page 1", required: true, acceptedTypes: ["pdf"] },
    { slotCode: "filed_form_page2", label: "Page 2", required: true, acceptedTypes: ["pdf"] },
  ]);
  const steps = [{ id: "t7", stepCode: "SAVE_FORM_COPY", sequence: 7, title: "Download and save filed form", requiredDocSlots: slots }];
  const doc = (id: string, slot: string, name: string) => ({ id, workflowStepId: "t7", docSlotCode: slot, originalFilename: name, storedPath: id });

  it("two pages: 'Filed return page 1' / 'page 2', original extension kept, one 'Filed return' in the email list", () => {
    const docs = planPackageDocuments(steps, [doc("a", "filed_form", "p1.PDF"), doc("b", "filed_form_page2", "p2.png")], naming);
    expect(docs.map((d) => d.zipName)).toEqual([
      "Rosario Garcia - 1701Q Q3 2026 - Filed return page 1.pdf",
      "Rosario Garcia - 1701Q Q3 2026 - Filed return page 2.png",
    ]);
    expect(docs.filter((d) => d.inEmailList).map((d) => d.label)).toEqual(["Filed return"]);
  });

  it("an older filing with the one old file keeps 'Filed return' and its single email line", () => {
    const docs = planPackageDocuments(steps, [doc("a", "filed_form", "old.pdf")], naming);
    expect(docs.map((d) => d.zipName)).toEqual(["Rosario Garcia - 1701Q Q3 2026 - Filed return.pdf"]);
    expect(docs.filter((d) => d.inEmailList).map((d) => d.label)).toEqual(["Filed return"]);
  });
});
