import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ClientsPage from "@/app/(app)/clients/page";
import { prisma } from "@/lib/prisma";

async function render(params: { status?: string; q?: string }) {
  const el = await ClientsPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(createElement(() => el));
}
const heads = (h: string) => [...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);

describe("Clients list (D183/D184)", () => {
  it("columns are Code · Registered name · TIN · Branch · RDO · Status", async () => {
    expect(heads(await render({ status: "all" }))).toEqual(["Code", "Registered name", "TIN", "Branch", "RDO", "Status"]);
  });

  it("shows the TIN with dashes and the branch code beside it; search finds it with or without dashes", async () => {
    const c = await prisma.client.findFirstOrThrow();
    const dashed = `${c.tin.slice(0, 3)}-${c.tin.slice(3, 6)}-${c.tin.slice(6)}`;
    for (const q of [c.tin, dashed]) {
      const h = await render({ status: "all", q });
      expect(h).toContain(dashed);
      expect(h).toContain(c.registeredName);
    }
    expect(await render({ status: "all", q: "999-999-999" })).toContain("No clients found.");
  });
});
