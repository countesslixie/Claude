import { describe, it, expect, afterAll, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { createAtcCode, updateAtcCode } from "@/lib/actions/atcCodes";
import { AtcCodeForm } from "@/components/atc-code-form";
import { AtcCodeSelect } from "@/components/atc-code-select";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));

const CODE = `ZT${Date.now()}`;

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe("ATC form (D164/D165)", () => {
  afterAll(async () => {
    await prisma.atcCode.deleteMany({ where: { code: { startsWith: "ZT" } } });
  });

  it("creating a code with no payee type saves Individual and the schema's verified default", async () => {
    await createAtcCode({}, form({ code: CODE, description: "Test", ratePercent: "5", isActive: "on" }));
    const row = await prisma.atcCode.findUniqueOrThrow({ where: { code: CODE } });
    expect(row.payeeType).toBe("Individual");
    expect(row.verifiedAgainstIssuance).toBe(false);
    expect(row.rateBps).toBe(500);
  });

  it("editing leaves the stored payee type and verified flag unchanged", async () => {
    const row = await prisma.atcCode.findUniqueOrThrow({ where: { code: CODE } });
    await prisma.atcCode.update({ where: { id: row.id }, data: { payeeType: "Corporate", verifiedAgainstIssuance: true } });
    await updateAtcCode(row.id, {}, form({ code: CODE, description: "Changed", ratePercent: "5", notes: "n" }));
    const after = await prisma.atcCode.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.description).toBe("Changed");
    expect(after.isActive).toBe(false);
    expect(after.payeeType).toBe("Corporate");
    expect(after.verifiedAgainstIssuance).toBe(true);
  });

  it("renders no Unverified text, payee type, verified checkbox, and a Cancel button", () => {
    const h = renderToStaticMarkup(
      createElement(AtcCodeForm, { action: createAtcCode, initialValues: { isActive: "on" }, submitLabel: "Create ATC", cancelHref: "/settings/atc-codes" }),
    );
    expect(h).not.toMatch(/unverified/i);
    expect(h).not.toMatch(/verified/i);
    expect(h).not.toContain("Payee type");
    expect(h).toContain("Cancel");
    expect(h).toContain("Create ATC");
    expect(h).not.toContain("offered on the certificate picker");
  });

  it("the certificate picker shows no Unverified text, even for a code stored as unverified", () => {
    const h = renderToStaticMarkup(
      createElement(AtcCodeSelect, {
        atcCodes: [{ code: "WI010", description: "Professional fees", rateBps: 500, verifiedAgainstIssuance: false } as never],
        name: "atcCode",
        value: "",
        onChange: () => {},
      }),
    );
    expect(h).toContain("WI010");
    expect(h).not.toMatch(/unverified/i);
  });
});
