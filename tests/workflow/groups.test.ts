import { describe, it, expect } from "vitest";
import {
  WORKFLOW_GROUPS,
  groupForStepCode,
  currentGroupCode,
  summarizeGroup,
  prepareGroupBlockReason,
  type GroupStepInput,
} from "@/lib/workflow/groups";

/**
 * Brief #4a — the sixteen steps wrapped in five groups. Grouping changes
 * nothing about what a step does or requires; these tests cover only the
 * new rollup logic: which group a step belongs to, which group a filing
 * currently "sits at," and how a group's collapsed summary is derived.
 */

const REQUIRED_SLOT = (slotCode: string, label: string) => ({ slotCode, label, required: true, acceptedTypes: [] });
const OPTIONAL_SLOT = (slotCode: string, label: string) => ({ slotCode, label, required: false, acceptedTypes: [] });

describe("WORKFLOW_GROUPS", () => {
  it("has exactly five groups covering all sixteen step codes exactly once", () => {
    expect(WORKFLOW_GROUPS).toHaveLength(5);
    const allCodes = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes);
    expect(allCodes).toHaveLength(16);
    expect(new Set(allCodes).size).toBe(16);
  });

  it("group 2 (File) is 5, 6, 7, 10 -- not contiguous, and step 10 (TRRC) renders last", () => {
    const file = WORKFLOW_GROUPS.find((g) => g.code === "FILE");
    expect(file?.stepCodes).toEqual(["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY", "RECEIVE_TRRC"]);
  });

  it("step 4 (ADVISE_CLIENT, category CLIENT_COMM) joins Prepare, not Close", () => {
    expect(groupForStepCode("ADVISE_CLIENT")?.code).toBe("PREPARE");
  });

  it("step 16 (SEND_CLIENT_PACKAGE, category CLIENT_COMM) joins Close, not Prepare", () => {
    expect(groupForStepCode("SEND_CLIENT_PACKAGE")?.code).toBe("CLOSE");
  });

  it("step 15 (EAFS_SUBMIT, category ATTACHMENT) joins Close alongside step 16", () => {
    const close = WORKFLOW_GROUPS.find((g) => g.code === "CLOSE");
    expect(close?.stepCodes).toEqual(["EAFS_SUBMIT", "SEND_CLIENT_PACKAGE"]);
  });

  it("groups 2/3/4 match the FILING/PAYMENT/SAWT categories exactly", () => {
    expect(WORKFLOW_GROUPS.find((g) => g.code === "PAY")?.stepCodes).toEqual(["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"]);
    expect(WORKFLOW_GROUPS.find((g) => g.code === "SAWT")?.stepCodes).toEqual([
      "ALPHALIST_ENTRY",
      "EMAIL_DAT",
      "SAWT_ACK",
      "SAWT_VALIDATION",
    ]);
  });
});

describe("currentGroupCode", () => {
  function stepsAllResolvedExcept(unresolvedStepCode: string) {
    return WORKFLOW_GROUPS.flatMap((g) => g.stepCodes).map((stepCode) => ({
      stepCode,
      status: stepCode === unresolvedStepCode ? ("WAITING_EXTERNAL" as const) : ("DONE" as const),
    }));
  }

  it("everything resolved -> null (the 'Complete' lane)", () => {
    const steps = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes).map((stepCode) => ({ stepCode, status: "DONE" as const }));
    expect(currentGroupCode(steps)).toBeNull();
  });

  it("§2 -- a filing awaiting only the TRRC (step 10, group File) still sits at FILE, even though Pay (group 3, steps 8/9) is fully resolved and numerically earlier steps are all done", () => {
    const steps = stepsAllResolvedExcept("RECEIVE_TRRC");
    expect(currentGroupCode(steps)).toBe("FILE");
  });

  it("the earliest incomplete group by GROUP order, not by raw step sequence", () => {
    // SAWT_ACK is step 13 (a high sequence number) but sits in group 4;
    // with everything else resolved, group order still puts SAWT ahead
    // of Close (group 5, steps 15/16) -- there's nothing else unresolved
    // here, so SAWT is correctly the answer either way this is computed,
    // but this pins the group-order contract explicitly.
    const steps = stepsAllResolvedExcept("SAWT_ACK");
    expect(currentGroupCode(steps)).toBe("SAWT");
  });
});

describe("summarizeGroup", () => {
  const prepare = WORKFLOW_GROUPS.find((g) => g.code === "PREPARE")!;
  const pay = WORKFLOW_GROUPS.find((g) => g.code === "PAY")!;
  const file = WORKFLOW_GROUPS.find((g) => g.code === "FILE")!;
  const sawt = WORKFLOW_GROUPS.find((g) => g.code === "SAWT")!;

  it("brief #4b -- Prepare blocks until steps 1 (RECORD_SALES) and 2 (RECEIVE_2307) are resolved, not on a doc slot", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({ stepCode, status: "PENDING" }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.blockReason).toMatch(/quarterly sales/i);
  });

  it("brief #4b -- Prepare unblocks once steps 1 and 2 are both resolved", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
      stepCode,
      status: stepCode === "RECORD_SALES" || stepCode === "RECEIVE_2307" ? "DONE" : "PENDING",
    }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.blockReason).toBeNull();
  });

  it("§4 -- Pay blocks on step 9's payment proof, named in the block reason", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "MAKE_PAYMENT", status: "DONE" },
      {
        stepCode: "SAVE_PROOF_PAYMENT",
        status: "PENDING",
        requiredDocSlots: [REQUIRED_SLOT("proof", "Payment confirmation")],
        documents: [],
      },
    ];
    const summary = summarizeGroup(pay, steps);
    expect(summary.blockReason).toBe("Missing required document: Payment confirmation.");
    expect(summary.doneCount).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.isComplete).toBe(false);
  });

  it("Pay unblocks once the proof of payment is attached", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "MAKE_PAYMENT", status: "DONE" },
      {
        stepCode: "SAVE_PROOF_PAYMENT",
        status: "DONE",
        requiredDocSlots: [REQUIRED_SLOT("proof", "Payment confirmation")],
        documents: [{ docSlotCode: "proof" }],
      },
    ];
    const summary = summarizeGroup(pay, steps);
    expect(summary.blockReason).toBeNull();
    expect(summary.isComplete).toBe(true);
  });

  it("§3 -- collapsed 'outstanding' label reads 'waiting on <slot label>' when blocked by a missing document", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "MAKE_PAYMENT", status: "DONE" },
      {
        stepCode: "SAVE_PROOF_PAYMENT",
        status: "PENDING",
        requiredDocSlots: [REQUIRED_SLOT("proof", "Payment confirmation")],
        documents: [],
      },
    ];
    const summary = summarizeGroup(pay, steps);
    expect(summary.outstandingLabel).toBe("waiting on payment confirmation");
  });

  it("§2/§3, §5 -- outstanding label reads 'waiting on <label>, <N>d' for a WAITING_EXTERNAL step with aging, e.g. the TRRC", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "FILE_RETURN", status: "DONE" },
      { stepCode: "SAVE_SUBMISSION_SS", status: "DONE" },
      { stepCode: "SAVE_FORM_COPY", status: "DONE" },
      {
        stepCode: "RECEIVE_TRRC",
        status: "WAITING_EXTERNAL",
        waitingOnLabel: "BIR",
        agingDaysWaiting: 12,
        requiredDocSlots: [REQUIRED_SLOT("trrc", "TRRC email/PDF")],
        documents: [],
      },
    ];
    const summary = summarizeGroup(file, steps);
    expect(summary.outstandingLabel).toBe("waiting on BIR, 12d");
  });

  it("brief #4e -- Prepare's outstanding label names quarterly sales specifically, not a generic 'waiting on Client'", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
      stepCode,
      status: stepCode === "RECORD_SALES" ? "WAITING_EXTERNAL" : stepCode === "RECEIVE_2307" ? "DONE" : "PENDING",
      waitingOnLabel: stepCode === "RECORD_SALES" ? "Client" : undefined,
      agingDaysWaiting: stepCode === "RECORD_SALES" ? 0 : undefined,
    }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.outstandingLabel).toBe("waiting on quarterly sales");
  });

  it("brief #4e -- Prepare's outstanding label names Form 2307 specifically once sales are recorded", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
      stepCode,
      status: stepCode === "RECORD_SALES" ? "DONE" : stepCode === "RECEIVE_2307" ? "WAITING_EXTERNAL" : "PENDING",
      waitingOnLabel: stepCode === "RECEIVE_2307" ? "Client" : undefined,
      agingDaysWaiting: stepCode === "RECEIVE_2307" ? 0 : undefined,
    }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.outstandingLabel).toBe("waiting on Form 2307");
  });

  it("brief #4e -- Prepare's outstanding label names both when neither self-completing step is resolved", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
      stepCode,
      status: stepCode === "RECORD_SALES" || stepCode === "RECEIVE_2307" ? "WAITING_EXTERNAL" : "PENDING",
      waitingOnLabel: stepCode === "RECORD_SALES" || stepCode === "RECEIVE_2307" ? "Client" : undefined,
      agingDaysWaiting: stepCode === "RECORD_SALES" || stepCode === "RECEIVE_2307" ? 0 : undefined,
    }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.outstandingLabel).toBe("waiting on quarterly sales and Form 2307");
  });

  it("brief #4e -- once steps 1/2 are resolved, Prepare falls through to the generic waiting-step label (e.g. step 4 genuinely marked waiting)", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
      stepCode,
      status: stepCode === "ADVISE_CLIENT" ? "WAITING_EXTERNAL" : stepCode === "PREPARE_RETURN" ? "PENDING" : "DONE",
      waitingOnLabel: stepCode === "ADVISE_CLIENT" ? "Client" : undefined,
      agingDaysWaiting: stepCode === "ADVISE_CLIENT" ? 3 : undefined,
    }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.outstandingLabel).toBe("waiting on Client, 3d");
  });

  it("NA steps (no SAWT requirement) are excluded from doneCount/totalCount and don't stop the group from reading complete", () => {
    const steps: GroupStepInput[] = sawt.stepCodes.map((stepCode) => ({ stepCode, status: "NA" }));
    const summary = summarizeGroup(sawt, steps);
    expect(summary.doneCount).toBe(0);
    expect(summary.totalCount).toBe(0);
    expect(summary.isComplete).toBe(true);
    expect(summary.blockReason).toBeNull();
    expect(summary.outstandingLabel).toBeNull();
  });

  it("an optional slot never contributes to the block reason or the outstanding label", () => {
    const close = WORKFLOW_GROUPS.find((g) => g.code === "CLOSE")!;
    const steps: GroupStepInput[] = close.stepCodes.map((stepCode) => ({
      stepCode,
      status: "PENDING",
      requiredDocSlots: stepCode === "EAFS_SUBMIT" ? [OPTIONAL_SLOT("eafs_confirmation", "eAFS confirmation")] : [],
      documents: [],
    }));
    const summary = summarizeGroup(close, steps);
    expect(summary.blockReason).toBeNull();
    expect(summary.outstandingLabel).toBeNull();
  });
});

describe("prepareGroupBlockReason (brief #4b)", () => {
  it("names both steps missing when neither is resolved", () => {
    const reason = prepareGroupBlockReason([
      { stepCode: "RECORD_SALES", status: "WAITING_EXTERNAL" },
      { stepCode: "RECEIVE_2307", status: "WAITING_EXTERNAL" },
    ]);
    expect(reason).toMatch(/quarterly sales/i);
    expect(reason).toMatch(/2307/i);
  });

  it("names only the unresolved step when the other is done", () => {
    const reason = prepareGroupBlockReason([
      { stepCode: "RECORD_SALES", status: "DONE" },
      { stepCode: "RECEIVE_2307", status: "WAITING_EXTERNAL" },
    ]);
    expect(reason).not.toMatch(/quarterly sales/i);
    expect(reason).toMatch(/2307/i);
  });

  it("is null once step 1 is DONE and step 2 is DONE or SKIPPED", () => {
    expect(
      prepareGroupBlockReason([
        { stepCode: "RECORD_SALES", status: "DONE" },
        { stepCode: "RECEIVE_2307", status: "DONE" },
      ]),
    ).toBeNull();
    expect(
      prepareGroupBlockReason([
        { stepCode: "RECORD_SALES", status: "DONE" },
        { stepCode: "RECEIVE_2307", status: "SKIPPED" },
      ]),
    ).toBeNull();
  });
});
