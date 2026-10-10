import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientDetailsBox } from "@/components/client-details-box";
import { formatManilaDateMDY } from "@/lib/dates";

describe("formatManilaDateMDY (D185)", () => {
  it("shows the Manila day as MM/DD/YYYY", () => {
    expect(formatManilaDateMDY(new Date("1990-01-05T00:00:00.000Z"))).toBe("01/05/1990");
  });
  it("does not roll back a day for Manila midnight (16:00 UTC the day before)", () => {
    expect(formatManilaDateMDY(new Date("1990-01-04T16:00:00.000Z"))).toBe("01/05/1990");
  });
  it("null/undefined → —", () => {
    expect(formatManilaDateMDY(null)).toBe("—");
    expect(formatManilaDateMDY(undefined)).toBe("—");
  });
});

const html = (p: Parameters<typeof ClientDetailsBox>[0]) => renderToStaticMarkup(createElement(ClientDetailsBox, p));

describe("Client details box (D185)", () => {
  it("shows dashed TIN, branch code and MM/DD/YYYY birthday", () => {
    const h = html({ tin: "123456789", branchCode: "000", birthDate: new Date("1990-01-04T16:00:00.000Z") });
    expect(h).toContain("Client details");
    expect(h).toContain("123-456-789");
    expect(h).toContain(">000<");
    expect(h).toContain("01/05/1990");
    expect(h).not.toContain("<button");
    expect(h).not.toContain("<a ");
  });
  it("shows — for a missing birthday or branch", () => {
    const h = html({ tin: "123456789", branchCode: null, birthDate: null });
    expect((h.match(/>—</g) ?? []).length).toBe(2);
  });
  it("is placed on step 3 only, above item 55", () => {
    const src = readFileSync("app/(app)/clients/[id]/filings/[filingId]/page.tsx", "utf8");
    expect((src.match(/<ClientDetailsBox/g) ?? []).length).toBe(1);
    const prepare = src.slice(src.indexOf("const prepareReturnExtra"), src.indexOf("const adviseClientExtra"));
    expect(prepare.indexOf("<ClientDetailsBox")).toBeGreaterThan(-1);
    expect(prepare.indexOf("<ClientDetailsBox")).toBeLessThan(prepare.indexOf("item 55)"));
  });
});
