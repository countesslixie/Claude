import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClient, updateClient } from "@/lib/actions/clients";
import { manilaDateInputToJsDate, toManilaDateInputValue, formatManilaDateLong } from "@/lib/dates";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

/** Brief #6b (D143–D148) — the New/Edit client form's actions. */
describe("client form actions", () => {
  const ids: string[] = [];
  let n = 0;
  const stamp = Date.now();

  afterAll(async () => {
    // By code prefix, not just the ids we saw — a failed run must not leave clients behind.
    await prisma.client.deleteMany({ where: { OR: [{ id: { in: ids } }, { code: { startsWith: `form-test-${stamp}` } }] } });
  });

  function fd(overrides: Record<string, string | null> = {}): FormData {
    const f = new FormData();
    const base: Record<string, string> = {
      code: `form-test-${stamp}-${n++}`,
      registeredName: "Form Test Client",
      tin: "123456789",
      branchCode: "000",
      rdoCode: "040",
      registeredAddress: "1 Test St",
      birthDate: "1990-01-05",
      isActive: "on",
    };
    for (const [k, v] of Object.entries({ ...base, ...overrides })) if (v !== null) f.set(k, v);
    return f;
  }

  async function made(overrides: Record<string, string | null> = {}) {
    const f = fd(overrides);
    const state = await createClient({}, f);
    expect(state?.fieldErrors).toBeUndefined(); // success redirects (mocked), so no state comes back
    const c = await prisma.client.findUniqueOrThrow({ where: { code: f.get("code") as string } });
    ids.push(c.id);
    return c;
  }

  it("a new client is saved purely self-employed, on collections (D145)", async () => {
    const c = await made();
    expect(c.taxpayerType).toBe("PURELY_SELF_EMPLOYED");
    expect(c.recognitionBasis).toBe("COLLECTION");
    expect(c.civilStatus).toBeNull();
    expect(c.defaultWithholdingRateBps).toBeNull();
  });

  it("a submitted taxpayer type or recognition basis is ignored on create — the form does not ask", async () => {
    const c = await made({ taxpayerType: "MIXED_INCOME", recognitionBasis: "BILLING" });
    expect(c.taxpayerType).toBe("PURELY_SELF_EMPLOYED");
    expect(c.recognitionBasis).toBe("COLLECTION");
  });

  it("Birthday is required: a missing or blank one is refused and nothing is saved (D146)", async () => {
    const missing = fd({ birthDate: null });
    const r1 = await createClient({}, missing);
    expect(r1.fieldErrors?.birthDate).toBeDefined();
    const blank = fd({ birthDate: "" });
    const r2 = await createClient({}, blank);
    expect(r2.fieldErrors?.birthDate).toBeDefined();
    const junk = fd({ birthDate: "not-a-date" });
    const r3 = await createClient({}, junk);
    expect(r3.fieldErrors?.birthDate).toBeDefined();
    for (const f of [missing, blank, junk]) {
      expect(await prisma.client.findUnique({ where: { code: f.get("code") as string } })).toBeNull();
    }
  });

  it("the birthday is stored as the Manila calendar date, the same way every other date is (manilaDateInputToJsDate)", async () => {
    const c = await made({ birthDate: "1990-01-05" });
    expect(c.birthDate!.getTime()).toBe(manilaDateInputToJsDate("1990-01-05").getTime());
    expect(toManilaDateInputValue(c.birthDate)).toBe("1990-01-05");
    expect(formatManilaDateLong(c.birthDate)).toBe("January 5, 1990");
  });

  it("an existing client with no birthday cannot be saved on Edit until one is entered", async () => {
    const c = await made();
    await prisma.client.update({ where: { id: c.id }, data: { birthDate: null } });
    const refused = await updateClient(c.id, {}, fd({ code: c.code, birthDate: "" }));
    expect(refused.fieldErrors?.birthDate).toBeDefined();
    expect((await prisma.client.findUniqueOrThrow({ where: { id: c.id } })).birthDate).toBeNull();
    const saved = await updateClient(c.id, {}, fd({ code: c.code, birthDate: "1985-12-31" }));
    expect(saved?.fieldErrors).toBeUndefined();
    expect(toManilaDateInputValue((await prisma.client.findUniqueOrThrow({ where: { id: c.id } })).birthDate)).toBe("1985-12-31");
  });

  it("Edit leaves the hidden fields exactly as stored (D145), including on a mixed-income client", async () => {
    const c = await made();
    const hidden = {
      taxpayerType: "MIXED_INCOME" as const,
      recognitionBasis: "BILLING" as const,
      civilStatus: "MARRIED" as const,
      defaultWithholdingRateBps: 500,
      booksType: "CAS" as const,
      booksRegistrationDate: manilaDateInputToJsDate("2020-02-02"),
      booksPermitNumber: "PERMIT-1",
      swornDeclarationOnFile: true,
      swornDeclarationYear: 2025,
      eBIRFormsEmail: "ebir@example.com",
      eFPSEnrolled: true,
    };
    await prisma.client.update({ where: { id: c.id }, data: hidden });

    // Even a stray submitted value for a hidden field must not reach the row.
    const state = await updateClient(
      c.id,
      {},
      fd({ code: c.code, registeredName: "Renamed", birthDate: "1991-02-03", taxpayerType: "PURELY_SELF_EMPLOYED", defaultWithholdingRateBps: "0", booksType: "MANUAL" }),
    );
    expect(state?.fieldErrors).toBeUndefined();

    const after = await prisma.client.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.registeredName).toBe("Renamed");
    expect(after.taxpayerType).toBe("MIXED_INCOME");
    expect(after.recognitionBasis).toBe("BILLING");
    expect(after.civilStatus).toBe("MARRIED");
    expect(after.defaultWithholdingRateBps).toBe(500);
    expect(after.booksType).toBe("CAS");
    expect(after.booksRegistrationDate!.getTime()).toBe(hidden.booksRegistrationDate.getTime());
    expect(after.booksPermitNumber).toBe("PERMIT-1");
    expect(after.swornDeclarationOnFile).toBe(true);
    expect(after.swornDeclarationYear).toBe(2025);
    expect(after.eBIRFormsEmail).toBe("ebir@example.com");
    expect(after.eFPSEnrolled).toBe(true);
  });

  it("Edit still keeps whatever code is posted and refuses one already in use", async () => {
    const a = await made();
    const b = await made();
    const clash = await updateClient(b.id, {}, fd({ code: a.code }));
    expect(clash.fieldErrors?.code?.[0]).toMatch(/already exists/);
  });

  it("a suggested code that is already taken shows the existing 'already exists' error — no number is appended", async () => {
    const a = await made();
    const state = await createClient({}, fd({ code: a.code }));
    expect(state.fieldErrors?.code?.[0]).toMatch(/already exists/);
  });
});
