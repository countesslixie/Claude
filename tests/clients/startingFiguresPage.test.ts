import { describe, it, expect, afterAll, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import StartingFiguresPage from "@/app/(app)/clients/[id]/tax-years/[taxYearId]/starting-figures/page";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * D179 — the Starting figures page carries no grey explanation paragraph
 * under its heading (extends D158–D161's "no grey instructional text").
 */
describe("Starting figures page (D179)", () => {
  const clientIds: string[] = [];
  afterAll(async () => {
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  async function render(withRow: boolean) {
    const client = await prisma.client.create({
      data: {
        code: `sfp-${withRow}-${Date.now()}`,
        registeredName: "Starting Figures Page Test Client",
        tin: "111222334",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    clientIds.push(client.id);
    const ty = await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" },
    });
    if (withRow) {
      await prisma.startingFigures.create({
        data: { client: { connect: { id: client.id } }, clientTaxYear: { connect: { id: ty.id } }, taxableYear: 2026, latestOutsideReturn: "Q2", cumulativeIncomeCents: 500_000_00 },
      });
    }
    const el = await StartingFiguresPage({ params: Promise.resolve({ id: client.id, taxYearId: ty.id }) });
    return renderToStaticMarkup(el);
  }

  for (const withRow of [false, true]) {
    it(`has no "For a client joining mid-year" paragraph (${withRow ? "view" : "edit"} state)`, async () => {
      const html = await render(withRow);
      // D179 — two lines, no comma, the year on its own line in the same heading.
      expect(html).toMatch(/<h1[^>]*><span class="block">Starting figures — Starting Figures Page Test Client<\/span><span class="block">TY2026<\/span><\/h1>/);
      expect(html).not.toContain("Client, TY2026");
      expect(html).toContain("Back to client");
      expect(html).not.toContain("For a client joining mid-year");
      expect(html).not.toContain("no earlier-quarter sales");
    });
  }
});
