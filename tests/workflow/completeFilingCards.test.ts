import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowStepCard } from "@/components/workflow-step-card";
import { Receive2307StepCard } from "@/components/receive-2307-step-card";
import { FileGroupDocStepCard } from "@/components/file-group-doc-step-card";
import { ClientPackageStepCard } from "@/components/client-package-step-card";
import { RecordSalesStepCard } from "@/components/record-sales-step-card";
import { MakePaymentStepCard } from "@/components/make-payment-step-card";
import { AdviceMessageCard } from "@/components/advice-message-card";
import { EmailDatStepCard } from "@/components/email-dat-step-card";
import { RECEIVE_2307_SKIPPED_TEXT } from "@/lib/workflow/receive2307";

const render = (component: unknown, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(component as never, props as never, null));

const stepData = {
  id: "s1", stepCode: "SOMETHING", sequence: 9, title: "A step", description: null, category: "OTHER",
  status: "SKIPPED", isWaitingState: false, waitingOnLabel: null, skippedReason: "Not needed",
  requiredDocSlots: [], documents: [], agingDaysWaiting: null, agingTone: null,
};

describe("D153 — a Complete filing's cards carry no control that changes anything", () => {
  it("a skipped step shows Undo skip normally and not when read-only", () => {
    expect(render(WorkflowStepCard, { step: stepData })).toContain("Undo skip");
    const ro = render(WorkflowStepCard, { step: stepData, readOnly: true });
    expect(ro).not.toContain("Undo skip");
    expect(ro).toContain("Skipped: Not needed");
  });

  it("step 2: no Undo skip, no tick, no Add, Replace or Remove when read-only; the saved scan still opens", () => {
    const cert = {
      id: "c1", payorName: "Payor", payorTin: "1", payorAddress: "x", incomePaymentCents: 100, taxWithheldCents: 5,
      atcCode: "WI010", withholdingRateBps: 500, rateOverridden: false, periodFrom: "a", periodTo: "b", notes: null,
      scans: [{ id: "d1", originalFilename: "scan.pdf" }],
    };
    const base = {
      stepId: "s2", sequence: 2, title: "Receive Form 2307", status: "DONE", skippedReason: null, certificates: [cert],
      allReceived: true, locked: true, addCertificateAction: async () => ({}), toggleAllReceivedAction: async () => {},
      defaultPeriodFrom: "", defaultPeriodTo: "", payors: [], atcCodes: [], onSaveNewPayor: async () => ({ ok: false, error: "" }),
      onFillPayorDetail: async () => ({ ok: false, error: "" }),
    };
    const open = { ...base, readOnly: true };
    // expanded view needs a not-yet-resolved status to render the rows by default
    const ro = render(Receive2307StepCard, { ...open, status: "WAITING_EXTERNAL" });
    expect(ro).toContain("scan.pdf");
    for (const gone of ["All certificates received", "Add certificate", "Replace scan", "Remove", "Attach scan", "Skip"]) {
      expect(ro).not.toContain(gone);
    }
    const skipped = render(Receive2307StepCard, { ...open, status: "SKIPPED", certificates: [], skippedReason: "None" });
    expect(skipped).not.toContain("Undo skip");
    expect(render(Receive2307StepCard, { ...base, status: "SKIPPED", certificates: [], skippedReason: "None", locked: false })).toContain("Undo skip");
  });

  it("an upload step shows the saved file but no upload box or Replace when read-only", () => {
    const props = {
      stepId: "s6", sequence: 6, title: "Submission screenshot", status: "DONE", isUnlocked: true, lockedMessage: "",
      slots: [{ slotCode: "x", label: "X", documents: [{ id: "d1", originalFilename: "shot.pdf" }] }],
      waitingOnLabel: null, agingDaysWaiting: null, agingTone: null,
    };
    const normal = render(FileGroupDocStepCard, props);
    expect(normal).toContain("Replace");
    const ro = render(FileGroupDocStepCard, { ...props, readOnly: true });
    expect(ro).toContain("/api/documents/d1/download");
    expect(ro).toContain("shot.pdf");
    expect(ro).not.toContain("Replace");
    expect(ro).not.toContain('type="file"');
    expect(ro).not.toContain("Upload");
  });

  it("step 1 has no Go to income entry, step 16 no Undo skip", () => {
    const sales = { sequence: 1, title: "Record quarterly sales", status: "DONE", totalCents: 100, incomeHref: "/x" };
    expect(render(RecordSalesStepCard, sales)).toContain("Go to income entry");
    expect(render(RecordSalesStepCard, { ...sales, readOnly: true })).not.toContain("Go to income entry");

    const pkg = {
      stepId: "s16", clientId: "c", sequence: 16, title: "Email package", status: "SKIPPED", lockedMessage: null, to: null,
      subject: "s", body: "b", hasSavedEmail: false, doneDateLabel: null, savedAtLabel: null, skippedReason: "old", downloadHref: "/d",
    };
    expect(render(ClientPackageStepCard, pkg)).toContain("Undo skip");
    expect(render(ClientPackageStepCard, { ...pkg, readOnly: true })).not.toContain("Undo skip");
  });

  it("the payment card shows the saved payment without Edit when locked", () => {
    const pay = {
      stepId: "s8", sequence: 8, title: "Make payment", status: "DONE", isUnlocked: true, locked: true, action: async () => ({}),
      defaultAmountCents: 0, savedAmountCents: 10_000, savedPaymentDate: "2026-08-10", savedPaymentChannel: "GCash", previousChannels: [],
    };
    const html = render(MakePaymentStepCard, pay);
    expect(html).toContain("Paid");
    expect(html).not.toContain("Edit");
    expect(render(MakePaymentStepCard, { ...pay, locked: false })).toContain("Edit");

  });

  it("D156: a Complete filing's step 4, 12 and 16 texts have no Copy button and cannot be typed in; in-progress ones keep Copy", () => {
    const advice = { isDone: true, savedAtLabel: "Oct 3, 2026", isOverpayment: false, amountLabel: "₱1.00", subject: "S", body: "B" };
    const shown = (html: string) => html.replace(/Show message|Hide message/g, "");
    expect(render(AdviceMessageCard, { ...advice, readOnly: true })).toContain("Show message");
    expect(shown(render(AdviceMessageCard, { ...advice, readOnly: true }))).not.toContain("Copy");
    // the in-progress live preview keeps its Copy and stays editable
    const live = render(AdviceMessageCard, { ...advice, isDone: false });
    expect(live).toContain("Copy");
    expect(live).not.toMatch(/readonly/i);
    expect(render(AdviceMessageCard, { ...advice, isDone: false, readOnly: true })).not.toContain("Copy");

    const pkg = {
      stepId: "s16", clientId: "c", sequence: 16, title: "Email package", status: "PENDING", lockedMessage: null, to: "a@b.c",
      subject: "s", body: "b", hasSavedEmail: false, doneDateLabel: null, savedAtLabel: null, skippedReason: null, downloadHref: "/d",
    };
    expect(render(ClientPackageStepCard, pkg)).toContain("Copy");
    const ro = render(ClientPackageStepCard, { ...pkg, readOnly: true });
    expect(ro).not.toContain("Copy");
    expect(ro).toMatch(/readonly/i);

    const dat = { stepId: "s12", clientId: "c", sequence: 12, title: "Email DAT", status: "PENDING", lockedMessage: null, to: "t", subject: "s", body: "b", rdoMissing: false, datFile: null, savedAtLabel: null };
    expect(render(EmailDatStepCard, dat)).toContain("Copy");
    expect(render(EmailDatStepCard, { ...dat, readOnly: true })).not.toContain("Copy");
  });

  it("D157: a skipped step 2 reads exactly the one wording, whatever reason an older row stored", () => {
    const html = render(Receive2307StepCard, {
      stepId: "s2", sequence: 2, title: "Receive Form 2307 from client", status: "SKIPPED",
      skippedReason: "No withholding agents — no Form 2307 expected for this client.", certificates: [], allReceived: false, locked: false,
      addCertificateAction: async () => ({}), toggleAllReceivedAction: async () => {}, defaultPeriodFrom: "", defaultPeriodTo: "", payors: [], atcCodes: [],
      onSaveNewPayor: async () => ({ ok: false, error: "" }), onFillPayorDetail: async () => ({ ok: false, error: "" }),
    });
    expect(RECEIVE_2307_SKIPPED_TEXT).toBe("No Form 2307 received from this client.");
    expect(html).toContain("No Form 2307 received from this client.");
    expect(html).not.toContain("No withholding agents");
    expect(html).not.toContain("Skipped:");
    expect(html).not.toContain("Skip reason");
  });
});
