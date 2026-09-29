import { describe, it, expect } from "vitest";
import {
  WORKFLOW_GROUPS,
  groupForStepCode,
  currentGroupCode,
  currentStepCodeByGroupOrder,
  summarizeGroup,
  prepareGroupBlockReason,
  payGroupBlockReason,
  nextActionModeForStepCode,
  groupCounterLabel,
  nothingToPayLabel,
  type GroupStepInput,
} from "@/lib/workflow/groups";

/**
 * Brief #4a — the sixteen steps wrapped in groups; D70 (brief #5m §1) —
 * six of them, superseding D32's five. Grouping changes nothing about
 * what a step does or requires; these tests cover only the rollup logic:
 * which group a step belongs to, which group a filing currently "sits
 * at," and how a group's collapsed summary is derived.
 */

const REQUIRED_SLOT = (slotCode: string, label: string) => ({ slotCode, label, required: true, acceptedTypes: [] });
const OPTIONAL_SLOT = (slotCode: string, label: string) => ({ slotCode, label, required: false, acceptedTypes: [] });
const FILE_DONE_STEPS: GroupStepInput[] = [
  { stepCode: "FILE_RETURN", status: "DONE" },
  { stepCode: "SAVE_SUBMISSION_SS", status: "DONE" },
  { stepCode: "SAVE_FORM_COPY", status: "DONE" },
];

describe("WORKFLOW_GROUPS", () => {
  it("has exactly six groups covering all sixteen step codes exactly once", () => {
    expect(WORKFLOW_GROUPS).toHaveLength(6);
    const allCodes = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes);
    expect(allCodes).toHaveLength(16);
    expect(new Set(allCodes).size).toBe(16);
  });

  it("D70 -- group 2 (File) is 5, 6, 7 only -- step 10 (TRRC) moved to BIR Confirmations", () => {
    const file = WORKFLOW_GROUPS.find((g) => g.code === "FILE");
    expect(file?.stepCodes).toEqual(["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"]);
  });

  it("D70 -- BIR Confirmations holds exactly steps 10 and 14, in that order", () => {
    const bir = WORKFLOW_GROUPS.find((g) => g.code === "BIR_CONFIRMATIONS");
    expect(bir?.stepCodes).toEqual(["RECEIVE_TRRC", "SAWT_VALIDATION"]);
    expect(bir?.name).toBe("BIR Confirmations");
  });

  it("D70 -- eAFS holds 11, 12, 13, 15 and keeps its name despite also holding the SAWT steps", () => {
    const eafs = WORKFLOW_GROUPS.find((g) => g.code === "EAFS");
    expect(eafs?.stepCodes).toEqual(["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"]);
    expect(eafs?.name).toBe("eAFS");
  });

  it("D70 -- Client package holds only step 16, on its own", () => {
    const clientPackage = WORKFLOW_GROUPS.find((g) => g.code === "CLIENT_PACKAGE");
    expect(clientPackage?.stepCodes).toEqual(["SEND_CLIENT_PACKAGE"]);
    expect(clientPackage?.name).toBe("Client package");
  });

  it("step 4 (ADVISE_CLIENT, category CLIENT_COMM) joins Prepare, not Client package", () => {
    expect(groupForStepCode("ADVISE_CLIENT")?.code).toBe("PREPARE");
  });

  it("step 16 (SEND_CLIENT_PACKAGE, category CLIENT_COMM) joins Client package, not Prepare", () => {
    expect(groupForStepCode("SEND_CLIENT_PACKAGE")?.code).toBe("CLIENT_PACKAGE");
  });

  it("step 15 (EAFS_SUBMIT, category ATTACHMENT) now joins eAFS, not step 16's group (D70)", () => {
    expect(groupForStepCode("EAFS_SUBMIT")?.code).toBe("EAFS");
  });

  it("Pay still matches the PAYMENT category exactly", () => {
    expect(WORKFLOW_GROUPS.find((g) => g.code === "PAY")?.stepCodes).toEqual(["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"]);
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

  it("D70 -- a filing awaiting only the TRRC (step 10) now sits at BIR_CONFIRMATIONS, not FILE", () => {
    const steps = stepsAllResolvedExcept("RECEIVE_TRRC");
    expect(currentGroupCode(steps)).toBe("BIR_CONFIRMATIONS");
  });

  it("D70 -- a filing where everything of hers is done but the TRRC hasn't arrived sits at BIR_CONFIRMATIONS, even with Pay/eAFS fully resolved and numerically earlier steps done", () => {
    const steps = stepsAllResolvedExcept("RECEIVE_TRRC");
    expect(currentGroupCode(steps)).toBe("BIR_CONFIRMATIONS");
  });

  it("the earliest incomplete group by GROUP order, not by raw step sequence -- eAFS's own step 13 stays ahead of BIR Confirmations", () => {
    const steps = stepsAllResolvedExcept("SAWT_ACK");
    expect(currentGroupCode(steps)).toBe("EAFS");
  });
});

describe("currentStepCodeByGroupOrder (D74)", () => {
  it("picks the earliest unresolved step within the earliest incomplete GROUP, not by raw step sequence", () => {
    // Step 10 (BIR Confirmations, group 5) is numerically earlier than
    // step 11 (eAFS, group 4), but eAFS is the earlier GROUP -- so once
    // eAFS still has unresolved work, that's the answer, never step 10.
    const steps = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes).map((stepCode) => ({
      stepCode,
      status:
        stepCode === "RECEIVE_TRRC" || stepCode === "ALPHALIST_ENTRY"
          ? ("WAITING_EXTERNAL" as const)
          : ("DONE" as const),
    }));
    expect(currentStepCodeByGroupOrder(steps)).toBe("ALPHALIST_ENTRY");
  });

  it("null once everything is resolved", () => {
    const steps = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes).map((stepCode) => ({ stepCode, status: "DONE" as const }));
    expect(currentStepCodeByGroupOrder(steps)).toBeNull();
  });
});

describe("payGroupBlockReason (D75)", () => {
  it("blocks until File (5, 6, 7) is Done", () => {
    const reason = payGroupBlockReason([
      { stepCode: "FILE_RETURN", status: "DONE" },
      { stepCode: "SAVE_SUBMISSION_SS", status: "PENDING" },
      { stepCode: "SAVE_FORM_COPY", status: "PENDING" },
    ]);
    expect(reason).toBe("Available once File is done.");
  });

  it("is null once File is fully Done", () => {
    expect(payGroupBlockReason(FILE_DONE_STEPS)).toBeNull();
  });
});

describe("summarizeGroup", () => {
  const prepare = WORKFLOW_GROUPS.find((g) => g.code === "PREPARE")!;
  const pay = WORKFLOW_GROUPS.find((g) => g.code === "PAY")!;
  const file = WORKFLOW_GROUPS.find((g) => g.code === "FILE")!;
  const eafs = WORKFLOW_GROUPS.find((g) => g.code === "EAFS")!;
  const birConfirmations = WORKFLOW_GROUPS.find((g) => g.code === "BIR_CONFIRMATIONS")!;
  const clientPackage = WORKFLOW_GROUPS.find((g) => g.code === "CLIENT_PACKAGE")!;

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

  it("D75 -- Pay's block reason is 'Available once File is done' while File isn't Done, reading File's steps off the full step list, not Pay's own", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "FILE_RETURN", status: "DONE" },
      { stepCode: "SAVE_SUBMISSION_SS", status: "PENDING" },
      { stepCode: "SAVE_FORM_COPY", status: "PENDING" },
      { stepCode: "MAKE_PAYMENT", status: "PENDING" },
      { stepCode: "SAVE_PROOF_PAYMENT", status: "PENDING" },
    ];
    const summary = summarizeGroup(pay, steps);
    expect(summary.blockReason).toBe("Available once File is done.");
    expect(summary.outstandingLabel).toBeNull(); // D73 -- no "waiting on..." text for a step not yet reached
  });

  it("D75 -- once File is Done, Pay's block reason falls through to the ordinary missing-document reason", () => {
    const steps: GroupStepInput[] = [
      ...FILE_DONE_STEPS,
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

  it("D75 -- Pay's own outstanding label reads 'waiting on proof of payment' once step 8 is Done and step 9 isn't", () => {
    const steps: GroupStepInput[] = [
      ...FILE_DONE_STEPS,
      { stepCode: "MAKE_PAYMENT", status: "DONE" },
      {
        stepCode: "SAVE_PROOF_PAYMENT",
        status: "PENDING",
        requiredDocSlots: [REQUIRED_SLOT("proof", "Payment confirmation")],
        documents: [],
      },
    ];
    const summary = summarizeGroup(pay, steps);
    expect(summary.outstandingLabel).toBe("waiting on proof of payment");
  });

  it("Pay unblocks once the proof of payment is attached", () => {
    const steps: GroupStepInput[] = [
      ...FILE_DONE_STEPS,
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
    expect(summary.outstandingLabel).toBeNull();
  });

  it("D70/D71 -- BIR Confirmations' outstanding label reads 'waiting on TRRC, <N>d' for step 10 waiting", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "RECEIVE_TRRC", status: "WAITING_EXTERNAL", waitingOnLabel: "BIR", agingDaysWaiting: 12 },
      { stepCode: "SAWT_VALIDATION", status: "NA" },
    ];
    const summary = summarizeGroup(birConfirmations, steps);
    expect(summary.outstandingLabel).toBe("waiting on TRRC, 12d");
  });

  it("D70/D71 -- BIR Confirmations' outstanding label reads 'waiting on eAFS validation, <N>d' for step 14 waiting", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "RECEIVE_TRRC", status: "DONE" },
      { stepCode: "SAWT_VALIDATION", status: "WAITING_EXTERNAL", waitingOnLabel: "BIR", agingDaysWaiting: 3 },
    ];
    const summary = summarizeGroup(birConfirmations, steps);
    expect(summary.outstandingLabel).toBe("waiting on eAFS validation, 3d");
  });

  it("D70/D71 -- both steps 10 and 14 waiting at once combine with a single 'waiting on'", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "RECEIVE_TRRC", status: "WAITING_EXTERNAL", waitingOnLabel: "BIR", agingDaysWaiting: 0 },
      { stepCode: "SAWT_VALIDATION", status: "WAITING_EXTERNAL", waitingOnLabel: "BIR", agingDaysWaiting: 2 },
    ];
    const summary = summarizeGroup(birConfirmations, steps);
    expect(summary.outstandingLabel).toBe("waiting on TRRC, 0d · eAFS validation, 2d");
  });

  it("D73 -- BIR Confirmations shows no text while neither step has started waiting (both still locked/PENDING)", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "RECEIVE_TRRC", status: "PENDING" },
      { stepCode: "SAWT_VALIDATION", status: "PENDING" },
    ];
    const summary = summarizeGroup(birConfirmations, steps);
    expect(summary.outstandingLabel).toBeNull();
  });

  it("no certificates for this filing: BIR Confirmations only has step 10 applicable (14 is NA), and reads Done once 10 resolves", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "RECEIVE_TRRC", status: "DONE" },
      { stepCode: "SAWT_VALIDATION", status: "NA" },
    ];
    const summary = summarizeGroup(birConfirmations, steps);
    expect(summary.totalCount).toBe(1);
    expect(summary.doneCount).toBe(1);
    expect(summary.isComplete).toBe(true);
  });

  it("no certificates for this filing: eAFS only has step 15 applicable (11/12/13 are NA), and reads Done once 15 resolves", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "ALPHALIST_ENTRY", status: "NA" },
      { stepCode: "EMAIL_DAT", status: "NA" },
      { stepCode: "SAWT_ACK", status: "NA" },
      { stepCode: "EAFS_SUBMIT", status: "DONE" },
    ];
    const summary = summarizeGroup(eafs, steps);
    expect(summary.totalCount).toBe(1);
    expect(summary.doneCount).toBe(1);
    expect(summary.isComplete).toBe(true);
  });

  it("D73 -- eAFS names step 13 specifically when it's waiting, a fixed plain name, never the generic 'BIR' label", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "ALPHALIST_ENTRY", status: "DONE" },
      { stepCode: "EMAIL_DAT", status: "DONE" },
      { stepCode: "SAWT_ACK", status: "WAITING_EXTERNAL", waitingOnLabel: "BIR", agingDaysWaiting: 4 },
      { stepCode: "EAFS_SUBMIT", status: "PENDING" },
    ];
    const summary = summarizeGroup(eafs, steps);
    expect(summary.outstandingLabel).toBe("waiting on SAWT acknowledgement, 4d");
  });

  it("D73 -- eAFS shows no text for steps not yet reached (no missing-document fallback)", () => {
    const steps: GroupStepInput[] = eafs.stepCodes.map((stepCode) => ({
      stepCode,
      status: "PENDING",
      requiredDocSlots: [REQUIRED_SLOT("generated_report", "Generated report")],
      documents: [],
    }));
    const summary = summarizeGroup(eafs, steps);
    expect(summary.outstandingLabel).toBeNull();
  });

  it("D73 -- Client package (step 16 alone) never shows outstanding text -- it has no waiting state of its own", () => {
    const steps: GroupStepInput[] = [{ stepCode: "SEND_CLIENT_PACKAGE", status: "PENDING" }];
    const summary = summarizeGroup(clientPackage, steps);
    expect(summary.outstandingLabel).toBeNull();
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

  it("brief #5m -- once steps 1/2 are resolved, Prepare has nothing left to name (steps 3/4 have no waiting state of their own)", () => {
    const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
      stepCode,
      status: stepCode === "ADVISE_CLIENT" ? "PENDING" : stepCode === "PREPARE_RETURN" ? "PENDING" : "DONE",
    }));
    const summary = summarizeGroup(prepare, steps);
    expect(summary.outstandingLabel).toBeNull();
  });

  it("NA steps (no SAWT requirement) are excluded from doneCount/totalCount and don't stop the group from reading complete", () => {
    const steps: GroupStepInput[] = eafs.stepCodes.map((stepCode) => ({ stepCode, status: "NA" }));
    const summary = summarizeGroup(eafs, steps);
    expect(summary.doneCount).toBe(0);
    expect(summary.totalCount).toBe(0);
    expect(summary.isComplete).toBe(true);
    expect(summary.blockReason).toBeNull();
    expect(summary.outstandingLabel).toBeNull();
  });

  it("an optional slot never contributes to the block reason or the outstanding label", () => {
    const steps: GroupStepInput[] = eafs.stepCodes.map((stepCode) => ({
      stepCode,
      status: "PENDING",
      requiredDocSlots: stepCode === "EAFS_SUBMIT" ? [OPTIONAL_SLOT("eafs_confirmation", "eAFS confirmation")] : [],
      documents: [],
    }));
    const summary = summarizeGroup(eafs, steps);
    expect(summary.blockReason).toBeNull();
    expect(summary.outstandingLabel).toBeNull();
  });

  describe("brief #5i §4 -- doneCount counts Done + Skipped together, with a skippedCount alongside it", () => {
    it("a skipped step counts toward doneCount, and skippedCount reports how many of those were skipped", () => {
      const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
        stepCode,
        status: stepCode === "RECORD_SALES" ? "DONE" : stepCode === "RECEIVE_2307" ? "SKIPPED" : "DONE",
      }));
      const summary = summarizeGroup(prepare, steps);
      expect(summary.doneCount).toBe(4);
      expect(summary.totalCount).toBe(4);
      expect(summary.skippedCount).toBe(1);
      expect(summary.isComplete).toBe(true);
    });

    it("an unfinished group with one skip reports the partial count and the skip count separately", () => {
      const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
        stepCode,
        status: stepCode === "RECORD_SALES" ? "DONE" : stepCode === "RECEIVE_2307" ? "SKIPPED" : "PENDING",
      }));
      const summary = summarizeGroup(prepare, steps);
      expect(summary.doneCount).toBe(2);
      expect(summary.totalCount).toBe(4);
      expect(summary.skippedCount).toBe(1);
      expect(summary.isComplete).toBe(false);
    });

    it("no skips -- skippedCount is zero and doneCount behaves exactly as before", () => {
      const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({ stepCode, status: "DONE" }));
      const summary = summarizeGroup(prepare, steps);
      expect(summary.doneCount).toBe(4);
      expect(summary.skippedCount).toBe(0);
      expect(summary.isComplete).toBe(true);
    });

    it("NA steps are excluded from both doneCount and skippedCount, same as totalCount", () => {
      const steps: GroupStepInput[] = eafs.stepCodes.map((stepCode) => ({ stepCode, status: "NA" }));
      const summary = summarizeGroup(eafs, steps);
      expect(summary.doneCount).toBe(0);
      expect(summary.skippedCount).toBe(0);
      expect(summary.totalCount).toBe(0);
    });
  });

  describe("brief #5i §3 -- unresolvedSummary names the specific unresolved steps by number", () => {
    it("names both step 3 and step 4 by number when both are unresolved", () => {
      const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
        stepCode,
        status: stepCode === "RECORD_SALES" || stepCode === "RECEIVE_2307" ? "DONE" : "PENDING",
      }));
      const summary = summarizeGroup(prepare, steps);
      expect(summary.unresolvedSummary).toBe("Step 3 and step 4 not done.");
    });

    it("names only the one remaining unresolved step", () => {
      const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({
        stepCode,
        status: stepCode === "ADVISE_CLIENT" ? "PENDING" : stepCode === "RECEIVE_2307" ? "SKIPPED" : "DONE",
      }));
      const summary = summarizeGroup(prepare, steps);
      expect(summary.unresolvedSummary).toBe("Step 4 not done.");
    });

    it("is null once the group is complete", () => {
      const steps: GroupStepInput[] = prepare.stepCodes.map((stepCode) => ({ stepCode, status: "DONE" }));
      const summary = summarizeGroup(prepare, steps);
      expect(summary.unresolvedSummary).toBeNull();
    });
  });
});

describe("D69 (brief #5l §2), narrowed by D70: the File group's own summary line -- steps 6/7 only now", () => {
  const file = WORKFLOW_GROUPS.find((g) => g.code === "FILE")!;

  it("step 5 not done: no text at all, even though 6/7 are technically 'unresolved'", () => {
    const steps: GroupStepInput[] = file.stepCodes.map((stepCode) => ({ stepCode, status: "PENDING" }));
    const summary = summarizeGroup(file, steps);
    expect(summary.outstandingLabel).toBeNull();
  });

  it("step 5 done, 6 and 7 both still missing: fixed short names, step order, no lowercased slot labels", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "FILE_RETURN", status: "DONE" },
      { stepCode: "SAVE_SUBMISSION_SS", status: "PENDING" },
      { stepCode: "SAVE_FORM_COPY", status: "PENDING" },
    ];
    const summary = summarizeGroup(file, steps);
    expect(summary.outstandingLabel).toBe("waiting on submission screenshot, filed form");
  });

  it("step 5 done, only step 7 still missing", () => {
    const steps: GroupStepInput[] = [
      { stepCode: "FILE_RETURN", status: "DONE" },
      { stepCode: "SAVE_SUBMISSION_SS", status: "DONE" },
      { stepCode: "SAVE_FORM_COPY", status: "PENDING" },
    ];
    const summary = summarizeGroup(file, steps);
    expect(summary.outstandingLabel).toBe("waiting on filed form");
  });

  it("D70 -- File no longer mentions BIR at all -- that text lives on BIR Confirmations now", () => {
    const steps: GroupStepInput[] = FILE_DONE_STEPS;
    const summary = summarizeGroup(file, steps);
    expect(summary.isComplete).toBe(true);
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

describe("nextActionModeForStepCode (D77)", () => {
  it("self-completing/needs-fields steps get 'goToStep'", () => {
    for (const code of [
      "RECORD_SALES",
      "RECEIVE_2307",
      "SAVE_SUBMISSION_SS",
      "SAVE_FORM_COPY",
      "MAKE_PAYMENT",
      "SAVE_PROOF_PAYMENT",
      "RECEIVE_TRRC",
      "SAWT_VALIDATION",
    ]) {
      expect(nextActionModeForStepCode(code)).toBe("goToStep");
    }
  });

  it("markDoneOnly steps (3, 4, 5) keep the Mark done button, no Start", () => {
    for (const code of ["PREPARE_RETURN", "ADVISE_CLIENT", "FILE_RETURN"]) {
      expect(nextActionModeForStepCode(code)).toBe("markDoneOnly");
    }
  });

  it("every other step (11-13, 15, 16) keeps the full Start + Mark done pair", () => {
    for (const code of ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT", "SEND_CLIENT_PACKAGE"]) {
      expect(nextActionModeForStepCode(code)).toBe("full");
    }
  });
});

describe("all-NA group header (D81, brief #5n §4)", () => {
  const pay = WORKFLOW_GROUPS.find((g) => g.code === "PAY")!;
  const eafs = WORKFLOW_GROUPS.find((g) => g.code === "EAFS")!;
  const naSteps = (codes: string[]) => codes.map((stepCode) => ({ stepCode, status: "NA" as const, waitingOnLabel: null, agingDaysWaiting: null }));

  it("Pay with steps 8 and 9 both NA is complete with a 0-of-0 count — and the counter label is null", () => {
    const summary = summarizeGroup(pay, naSteps(["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"]));
    expect(summary.isComplete).toBe(true);
    expect(summary.totalCount).toBe(0);
    expect(groupCounterLabel(summary.doneCount, summary.totalCount, summary.skippedCount)).toBeNull();
  });

  it("applies to any group, not just Pay (eAFS with 11-13 and 15 all NA)", () => {
    const summary = summarizeGroup(eafs, naSteps(["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"]));
    expect(groupCounterLabel(summary.doneCount, summary.totalCount, summary.skippedCount)).toBeNull();
  });

  it("an ordinary group still shows its counter, with the skipped suffix", () => {
    expect(groupCounterLabel(4, 4, 0)).toBe("4 of 4");
    expect(groupCounterLabel(4, 4, 1)).toBe("4 of 4 · 1 skipped");
    expect(groupCounterLabel(0, 1, 0)).toBe("0 of 1");
  });

  it("Nothing to pay shows the amount for an overpayment, plain for exactly zero", () => {
    expect(nothingToPayLabel(true, 820000)).toBe("Nothing to pay — overpayment ₱8,200.00");
    expect(nothingToPayLabel(false, 0)).toBe("Nothing to pay");
    expect(nothingToPayLabel(true, 0)).toBe("Nothing to pay");
  });
});
