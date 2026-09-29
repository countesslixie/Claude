import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { uploadDocument, deleteDocument } from "@/lib/actions/documents";
import { markStepDone, markStepInProgress, markStepWaitingExternal, skipStep, logFollowUp } from "@/lib/actions/workflowSteps";
import { parseDocSlots } from "@/lib/workflow/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #5o Parts 3-4 (D85-D89, D93) — the eAFS group. Fictitious fixture
 * data only. Steps 11-15 are locked until File and Pay are Done; step 11 has
 * two upload boxes and needs both; step 12 is Mark done only and saves its
 * email draft; step 13 waits on BIR automatically after 12 and completes on
 * upload; step 14 waits after 13; step 15 has no document and no Skip; and
 * the whole group (with 14) is NA when the filing has no Form 2307.
 */
describe("the eAFS group", () => {
  const clientIds: string[] = [];
  const codes: string[] = [];
  let n = 0;

  afterAll(async () => {
    await prisma.amendmentAlert.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.document.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    for (const c of codes) await rm(path.join(process.cwd(), "storage", c), { recursive: true, force: true });
  });

  async function setup(withCertificate = true) {
    const code = `eafs-test-${Date.now()}-${n++}`;
    codes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Corazon Mendoza",
        tin: "123456789",
        branchCode: "000",
        rdoCode: "050",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    clientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    if (withCertificate) await addCertificate(client.id, filing.id);
    return { client, filing };
  }
  async function addCertificate(clientId: string, filingId: string) {
    const cert = await prisma.form2307.create({
      data: {
        clientId, taxableYear: 2026, payorName: "Fixture Payor", payorTin: "111222333", periodFrom: new Date("2026-07-01T00:00:00.000Z"),
        periodTo: new Date("2026-09-30T00:00:00.000Z"), quarterCovered: 3, atcCode: "WI010", incomePaymentCents: 1_000_000,
        taxWithheldCents: 50_000, withholdingRateBps: 500, status: "RECORDED", claimedOnFilingId: filingId,
      },
    });
    const f = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
    await recomputeRequiresSawt(f.clientId, 2026, "Q3");
    return cert;
  }
  const step = (filingId: string, code: string) => prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: code } });
  const status = async (filingId: string, code: string) => (await step(filingId, code)).status;
  async function upload(filingId: string, code: string, slot: string, name = `${slot}.pdf`) {
    const s = await step(filingId, code);
    const fd = new FormData();
    fd.set("file", new File([`${code}-${slot}-${name}`], name));
    fd.set("workflowStepId", s.id);
    fd.set("docSlotCode", slot);
    fd.set("documentDate", "2026-09-29");
    return uploadDocument(fd);
  }
  /** File (5-7) and Pay (8-9) set Done directly — each has its own tests elsewhere. */
  async function openGate(filingId: string) {
    await prisma.workflowStep.updateMany({
      where: { filingId, stepCode: { in: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY", "MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } },
      data: { status: "DONE", completedAt: new Date() },
    });
  }
  const EAFS = ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"];

  it("is locked on the server until File and Pay are Done — uploads and Mark done both refused", async () => {
    const { filing } = await setup();
    const early = await upload(filing.id, "ALPHALIST_ENTRY", "generated_report");
    expect(early.ok).toBe(false);
    expect(early.error).toMatch(/Available once Pay is done/);
    expect((await markStepDone((await step(filing.id, "EAFS_SUBMIT")).id)).error).toBe("Available once Pay is done.");
    expect((await markStepDone((await step(filing.id, "EMAIL_DAT")).id)).ok).toBe(false);

    await prisma.workflowStep.updateMany({ where: { filingId: filing.id, stepCode: { in: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"] } }, data: { status: "DONE" } });
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "generated_report")).ok).toBe(false); // Pay still open
    await prisma.workflowStep.updateMany({ where: { filingId: filing.id, stepCode: { in: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } }, data: { status: "DONE" } });
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "generated_report")).ok).toBe(true);
  });

  it("Pay counts as Done when it's 'nothing to pay' (steps 8 and 9 NA)", async () => {
    const { filing } = await setup();
    await prisma.workflowStep.updateMany({ where: { filingId: filing.id, stepCode: { in: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"] } }, data: { status: "DONE" } });
    await prisma.workflowStep.updateMany({ where: { filingId: filing.id, stepCode: { in: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } }, data: { status: "NA" } });
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "dat_file", "x.dat")).ok).toBe(true);
  });

  it("step 11 needs BOTH files; replacing works per file; removing either returns it to Pending", async () => {
    const { filing } = await setup();
    await openGate(filing.id);
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "generated_report")).ok).toBe(true);
    expect(await status(filing.id, "ALPHALIST_ENTRY")).not.toBe("DONE");
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "dat_file", "batch.dat")).ok).toBe(true);
    expect(await status(filing.id, "ALPHALIST_ENTRY")).toBe("DONE");

    // Replace one file: still Done, one live document for that slot
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "dat_file", "batch2.dat")).ok).toBe(true);
    const live = await prisma.document.findMany({ where: { filingId: filing.id, docSlotCode: "dat_file", deletedAt: null } });
    expect(live).toHaveLength(1);
    expect(await status(filing.id, "ALPHALIST_ENTRY")).toBe("DONE");

    await deleteDocument(live[0].id, "wrong file");
    expect(await status(filing.id, "ALPHALIST_ENTRY")).toBe("PENDING");
  });

  it("step 12: Mark done only, locked until 11 is Done, saves the exact draft, then 13 waits on BIR at that moment", async () => {
    const { filing } = await setup();
    await openGate(filing.id);
    const email = await step(filing.id, "EMAIL_DAT");
    expect((await markStepDone(email.id)).error).toBe("Available once step 11 is done.");
    await upload(filing.id, "ALPHALIST_ENTRY", "generated_report");
    await upload(filing.id, "ALPHALIST_ENTRY", "dat_file", "batch.dat");
    expect((await markStepDone(email.id)).ok).toBe(true);

    const saved = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(saved.dataEmailTo).toBe("esubmission@bir.gov.ph"); // the TaxRuleSet setting, not a literal
    expect(saved.dataEmailSubject).toBe("SAWT 1701Q 09302026 CORAZON MENDOZA 123456789000");
    expect(saved.dataEmailBody).toBe("Name: Corazon Mendoza\nTIN: 123456789000\nRDO: 050\nPeriod: 09302026");
    expect(saved.dataEmailSavedAt).not.toBeNull();

    const ack = await step(filing.id, "SAWT_ACK");
    expect(ack.status).toBe("WAITING_EXTERNAL");
    expect(ack.waitingSince).not.toBeNull();
    const emailDone = await step(filing.id, "EMAIL_DAT");
    expect(Math.abs(ack.waitingSince!.getTime() - emailDone.completedAt!.getTime())).toBeLessThan(5000);
  });

  it("the 12 -> 13 -> 14 chain end to end; removing 13's only file returns it to waiting from step 12's completedAt", async () => {
    const { filing } = await setup();
    await openGate(filing.id);
    await upload(filing.id, "ALPHALIST_ENTRY", "generated_report");
    await upload(filing.id, "ALPHALIST_ENTRY", "dat_file", "batch.dat");
    await markStepDone((await step(filing.id, "EMAIL_DAT")).id);
    expect(await status(filing.id, "SAWT_VALIDATION")).toBe("PENDING"); // locked until 13 is Done
    expect((await upload(filing.id, "SAWT_VALIDATION", "validation_email")).ok).toBe(false);

    expect((await upload(filing.id, "SAWT_ACK", "acknowledgement")).ok).toBe(true);
    expect(await status(filing.id, "SAWT_ACK")).toBe("DONE");
    const validation = await step(filing.id, "SAWT_VALIDATION");
    expect(validation.status).toBe("WAITING_EXTERNAL");
    expect(validation.waitingSince).not.toBeNull();

    // remove 13's only file
    const doc = await prisma.document.findFirstOrThrow({ where: { filingId: filing.id, docSlotCode: "acknowledgement", deletedAt: null } });
    await deleteDocument(doc.id, "wrong file");
    const ack = await step(filing.id, "SAWT_ACK");
    const email = await step(filing.id, "EMAIL_DAT");
    expect(ack.status).toBe("WAITING_EXTERNAL");
    expect(ack.waitingSince!.getTime()).toBe(email.completedAt!.getTime());
  });

  it("refuses Start, Skip, Mark waiting, Mark done and Log follow-up exactly where the brief says", async () => {
    const { filing } = await setup();
    await openGate(filing.id);
    const s11 = (await step(filing.id, "ALPHALIST_ENTRY")).id;
    const s12 = (await step(filing.id, "EMAIL_DAT")).id;
    const s13 = (await step(filing.id, "SAWT_ACK")).id;
    const s15 = (await step(filing.id, "EAFS_SUBMIT")).id;
    for (const id of [s11, s12, s13, s15]) {
      expect((await markStepInProgress(id)).ok).toBe(false); // no Start
      expect((await skipStep(id, "because")).ok).toBe(false); // no Skip
    }
    expect((await markStepDone(s11)).ok).toBe(false); // 11 and 13: no Mark done
    expect((await markStepDone(s13)).ok).toBe(false);
    expect((await markStepWaitingExternal(s13)).ok).toBe(false); // 13: no Mark waiting
    expect((await logFollowUp(s13)).ok).toBe(false); // 13: no Log follow-up (D72)
    expect((await markStepDone(s15)).ok).toBe(true); // 15: Mark done works, nothing else needed
  });

  it("step 15 has no document slot — in the template and on existing rows — and is conditional", async () => {
    const template = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode: "EAFS_SUBMIT" } });
    expect(parseDocSlots(template.requiredDocSlots)).toEqual([]);
    expect(template.isConditional).toBe(true);
    const { filing } = await setup();
    expect(parseDocSlots((await step(filing.id, "EAFS_SUBMIT")).requiredDocSlots)).toEqual([]);
  });

  it("with no certificate, steps 11-15 (and 14) are all NA; adding one brings them back; removing it makes them NA again; after filing the state is fixed", async () => {
    const { client, filing } = await setup(false);
    for (const code of [...EAFS, "SAWT_VALIDATION"]) expect(await status(filing.id, code)).toBe("NA");

    const cert = await addCertificate(client.id, filing.id);
    for (const code of [...EAFS, "SAWT_VALIDATION"]) expect(await status(filing.id, code)).toBe("PENDING");

    await prisma.form2307.update({ where: { id: cert.id }, data: { deletedAt: new Date() } });
    await recomputeRequiresSawt(client.id, 2026, "Q3");
    for (const code of [...EAFS, "SAWT_VALIDATION"]) expect(await status(filing.id, code)).toBe("NA");

    // certificate back, then the return is filed: from then on the state is fixed
    await prisma.form2307.update({ where: { id: cert.id }, data: { deletedAt: null } });
    await recomputeRequiresSawt(client.id, 2026, "Q3");
    await prisma.workflowStep.updateMany({ where: { filingId: filing.id, stepCode: "FILE_RETURN" }, data: { status: "DONE" } });
    await prisma.form2307.update({ where: { id: cert.id }, data: { deletedAt: new Date() } });
    await recomputeRequiresSawt(client.id, 2026, "Q3");
    for (const code of EAFS) expect(await status(filing.id, code)).toBe("PENDING");
  });

  it("an NA eAFS step takes no upload and no Mark done", async () => {
    const { filing } = await setup(false);
    await openGate(filing.id);
    expect((await upload(filing.id, "ALPHALIST_ENTRY", "generated_report")).ok).toBe(false);
    expect((await markStepDone((await step(filing.id, "EAFS_SUBMIT")).id)).ok).toBe(false);
  });

  it("steps 10 and 14 are renamed in the template and on filings, and the eAFS validation short name is used", async () => {
    const t10 = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode: "RECEIVE_TRRC" } });
    const t14 = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode: "SAWT_VALIDATION" } });
    expect(t10.title).toBe("Save TRRC email");
    expect(t14.title).toBe("Save eAFS validation email");
    const { filing } = await setup();
    expect((await step(filing.id, "RECEIVE_TRRC")).title).toBe("Save TRRC email");
    expect((await step(filing.id, "SAWT_VALIDATION")).title).toBe("Save eAFS validation email");
    const { BIR_WAIT_SHORT_NAME } = await import("@/lib/workflow/aging");
    expect(BIR_WAIT_SHORT_NAME.SAWT_VALIDATION).toBe("eAFS validation");
  });
});
