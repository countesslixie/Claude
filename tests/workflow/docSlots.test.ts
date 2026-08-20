import { describe, it, expect } from "vitest";
import {
  canCompleteStep,
  missingRequiredSlots,
  checkSendClientPackageReadiness,
  type StepForPackageCheck,
  type AttachedDocument,
} from "@/lib/workflow/docSlots";

const REQUIRED_SLOT = { slotCode: "form", label: "Filed form PDF", required: true, acceptedTypes: ["pdf"] };
const OPTIONAL_SLOT = { slotCode: "notes", label: "Notes scan", required: false, acceptedTypes: ["pdf"] };

/** SPEC.md §16 item 13: a step with an empty required doc slot cannot be set DONE. */
describe("canCompleteStep", () => {
  it("cannot complete when a required slot has no document", () => {
    expect(canCompleteStep([REQUIRED_SLOT], [])).toBe(false);
  });

  it("can complete once the required slot has a document", () => {
    const docs: AttachedDocument[] = [{ docSlotCode: "form", deletedAt: null }];
    expect(canCompleteStep([REQUIRED_SLOT], docs)).toBe(true);
  });

  it("a soft-deleted document does not count as filling the slot", () => {
    const docs: AttachedDocument[] = [{ docSlotCode: "form", deletedAt: new Date() }];
    expect(canCompleteStep([REQUIRED_SLOT], docs)).toBe(false);
  });

  it("optional slots never block completion", () => {
    expect(canCompleteStep([OPTIONAL_SLOT], [])).toBe(true);
  });

  it("missingRequiredSlots names exactly the unfilled required slots, not optional ones", () => {
    const missing = missingRequiredSlots([REQUIRED_SLOT, OPTIONAL_SLOT], []);
    expect(missing).toEqual([REQUIRED_SLOT]);
  });
});

/**
 * SPEC.md §16 item 14: SEND_CLIENT_PACKAGE blocks and names the specific
 * missing document when any of steps 7/9/10/14 lacks its document.
 */
describe("checkSendClientPackageReadiness", () => {
  const FORM_SLOT = { slotCode: "form", label: "Filed form PDF", required: true, acceptedTypes: ["pdf"] };
  const PROOF_SLOT = { slotCode: "proof", label: "Payment confirmation", required: true, acceptedTypes: ["pdf"] };
  const TRRC_SLOT = { slotCode: "trrc", label: "TRRC email/PDF", required: true, acceptedTypes: ["pdf", "eml"] };
  const VALIDATION_SLOT = {
    slotCode: "validation",
    label: "Validation email",
    required: true,
    acceptedTypes: ["eml"],
  };

  function steps(overrides: Partial<Record<string, string>> = {}): StepForPackageCheck[] {
    return [
      { stepCode: "SAVE_FORM_COPY", status: overrides.SAVE_FORM_COPY ?? "DONE", requiredDocSlots: [FORM_SLOT] },
      {
        stepCode: "SAVE_PROOF_PAYMENT",
        status: overrides.SAVE_PROOF_PAYMENT ?? "DONE",
        requiredDocSlots: [PROOF_SLOT],
      },
      { stepCode: "RECEIVE_TRRC", status: overrides.RECEIVE_TRRC ?? "DONE", requiredDocSlots: [TRRC_SLOT] },
      {
        stepCode: "SAWT_VALIDATION",
        status: overrides.SAWT_VALIDATION ?? "DONE",
        requiredDocSlots: [VALIDATION_SLOT],
      },
    ];
  }

  it("ready when all four dependency steps have their document", () => {
    const docs = new Map<string, AttachedDocument[]>([
      ["SAVE_FORM_COPY", [{ docSlotCode: "form", deletedAt: null }]],
      ["SAVE_PROOF_PAYMENT", [{ docSlotCode: "proof", deletedAt: null }]],
      ["RECEIVE_TRRC", [{ docSlotCode: "trrc", deletedAt: null }]],
      ["SAWT_VALIDATION", [{ docSlotCode: "validation", deletedAt: null }]],
    ]);
    const result = checkSendClientPackageReadiness(steps(), docs);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("names the specific missing document when step 10 (RECEIVE_TRRC) lacks its file", () => {
    const docs = new Map<string, AttachedDocument[]>([
      ["SAVE_FORM_COPY", [{ docSlotCode: "form", deletedAt: null }]],
      ["SAVE_PROOF_PAYMENT", [{ docSlotCode: "proof", deletedAt: null }]],
      ["RECEIVE_TRRC", []], // missing
      ["SAWT_VALIDATION", [{ docSlotCode: "validation", deletedAt: null }]],
    ]);
    const result = checkSendClientPackageReadiness(steps(), docs);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ stepCode: "RECEIVE_TRRC", slotCode: "trrc" });
  });

  it("names every missing document when multiple of steps 7/9/10/14 lack theirs", () => {
    const docs = new Map<string, AttachedDocument[]>([
      ["SAVE_FORM_COPY", []],
      ["SAVE_PROOF_PAYMENT", [{ docSlotCode: "proof", deletedAt: null }]],
      ["RECEIVE_TRRC", []],
      ["SAWT_VALIDATION", [{ docSlotCode: "validation", deletedAt: null }]],
    ]);
    const result = checkSendClientPackageReadiness(steps(), docs);
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.stepCode).sort()).toEqual(["RECEIVE_TRRC", "SAVE_FORM_COPY"]);
  });

  it("a step 14 marked NA (no SAWT requirement) is not treated as missing", () => {
    const docs = new Map<string, AttachedDocument[]>([
      ["SAVE_FORM_COPY", [{ docSlotCode: "form", deletedAt: null }]],
      ["SAVE_PROOF_PAYMENT", [{ docSlotCode: "proof", deletedAt: null }]],
      ["RECEIVE_TRRC", [{ docSlotCode: "trrc", deletedAt: null }]],
      // SAWT_VALIDATION has no document at all, but is NA below.
    ]);
    const result = checkSendClientPackageReadiness(steps({ SAWT_VALIDATION: "NA" }), docs);
    expect(result.ok).toBe(true);
  });
});
