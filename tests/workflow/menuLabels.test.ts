import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TOP, WORK, SETTINGS } from "@/components/nav";

describe("D140 — left menu names and order", () => {
  it("reads Dashboard · Kanban · Clients · Tax Rules · ATC · Holidays · BIR Logins", () => {
    const labels = [TOP, ...WORK, ...SETTINGS].map((l) => l.label);
    expect(labels).toEqual(["Dashboard", "Kanban", "Clients", "Tax Rules", "ATC", "Holidays", "BIR Logins"]);
  });

  it("keeps the old URLs", () => {
    expect([TOP, ...WORK, ...SETTINGS].map((l) => l.href)).toEqual([
      "/", "/filings", "/clients", "/settings/tax-rule-sets", "/settings/atc-codes", "/settings/holidays", "/settings/bir-logins",
    ]);
  });

  it("page headings match the menu", () => {
    const h1 = (p: string) => readFileSync(p, "utf8").match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
    expect(h1("app/(app)/filings/page.tsx")).toBe("Kanban");
    expect(h1("app/(app)/settings/tax-rule-sets/page.tsx")).toBe("Tax Rules");
    expect(h1("app/(app)/settings/atc-codes/page.tsx")).toBe("ATC");
    expect(h1("app/(app)/settings/bir-logins/page.tsx")).toBe("BIR Logins");
  });
});

describe("D142 — the client page's Taxable years table", () => {
  it("has no Regime column", () => {
    const src = readFileSync("app/(app)/clients/[id]/page.tsx", "utf8");
    expect(src).not.toMatch(/<th>Regime<\/th>/);
    const body = src.slice(src.indexOf("Taxable years"));
    const heads = [...body.slice(0, body.indexOf("</thead>")).matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Year", "Threshold breached", "", ""]);
  });

  it("the tax year form has no Regime field", () => {
    expect(readFileSync("components/client-tax-year-form.tsx", "utf8")).not.toMatch(/regime/i);
  });
});
