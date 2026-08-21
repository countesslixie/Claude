import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { getPeriodReconciliation } from "@/lib/reconciliation";
import { generateSawtBatch } from "@/lib/actions/sawt";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * §16 item 20: ALPHALIST_ENTRY is blocked when cumulative CWT claimed on
 * the filing disagrees with cumulative certificates batched through the
 * period, naming the specific unbatched certificates responsible — not
 * blocked, and not falsely blocked, when they agree.
 */
describe("SAWT reconciliation check 3 and the ALPHALIST_ENTRY block it drives", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.sawtBatch.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    for (const code of clientCodes) {
      await rm(path.join(process.cwd(), "storage", code), { recursive: true, force: true });
    }
  });

  async function makeClientWithQ2CertificateAndFilings() {
    const code = `sawt-recon-test-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "SAWT Reconciliation Test Client",
        tin: "444555666",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    createdClientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);

    const certificate = await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        payorName: "Acme Publishing Corp.",
        payorTin: "987654321",
        payorAddress: "123 Makati Ave.",
        periodFrom: new Date("2026-04-01T00:00:00.000Z"),
        periodTo: new Date("2026-04-30T00:00:00.000Z"),
        quarterCovered: 2,
        atcCode: "WI010",
        incomePaymentCents: 100000,
        taxWithheldCents: 5000,
        withholdingRateBps: 500,
        dateReceived: new Date("2026-04-15T00:00:00.000Z"),
        status: "RECORDED",
      },
    });

    await recomputeRequiresSawt(client.id, 2026, "Q2");

    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    return { client, filing, certificate };
  }

  it("check 3 reports a variance and names the specific unbatched certificate", async () => {
    const { client, certificate } = await makeClientWithQ2CertificateAndFilings();

    const reconciliation = await getPeriodReconciliation(client.id, 2026, "Q2");
    expect(reconciliation.hasVariance).toBe(true);
    expect(reconciliation.cumulativeCwtCentsOnFiling).toBe(5000);
    expect(reconciliation.sawtBatchCwtCents).toBe(0);
    expect(reconciliation.varianceCents).toBe(5000);
    expect(reconciliation.unbatchedCertificates.map((c) => c.id)).toEqual([certificate.id]);
  });

  it("markStepDone blocks ALPHALIST_ENTRY on the variance, then allows it once the batch is generated and required documents are attached", async () => {
    const { client, filing } = await makeClientWithQ2CertificateAndFilings();
    const alphalistStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "ALPHALIST_ENTRY" },
    });
    expect(alphalistStep.status).toBe("PENDING"); // un-NA'd by recomputeRequiresSawt

    const blocked = await markStepDone(alphalistStep.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("SAWT variance");
    expect(blocked.error).toContain("Acme Publishing Corp.");

    const generateResult = await generateSawtBatch(client.id, 2026, "Q2");
    expect(generateResult.ok).toBe(true);
    expect(generateResult.batchedCount).toBe(1);

    const reconciliationAfter = await getPeriodReconciliation(client.id, 2026, "Q2");
    expect(reconciliationAfter.hasVariance).toBe(false);

    // The variance is gone, but ALPHALIST_ENTRY still has its own two
    // required doc slots (generated_report, dat_file) unfilled -- the
    // NEXT block, unrelated to SAWT variance, proving the first block
    // was specifically about the variance and nothing else.
    const stillBlockedOnDocs = await markStepDone(alphalistStep.id);
    expect(stillBlockedOnDocs.ok).toBe(false);
    expect(stillBlockedOnDocs.error).not.toContain("SAWT variance");

    for (const slotCode of ["generated_report", "dat_file"]) {
      const formData = new FormData();
      formData.set("file", new File(["bytes"], `${slotCode}.pdf`, { type: "application/pdf" }));
      formData.set("workflowStepId", alphalistStep.id);
      formData.set("docSlotCode", slotCode);
      formData.set("documentDate", "2026-08-01");
      await uploadDocument(formData);
    }

    const allowed = await markStepDone(alphalistStep.id);
    expect(allowed.ok).toBe(true);
    const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: alphalistStep.id } });
    expect(updated.status).toBe("DONE");
  });
});
