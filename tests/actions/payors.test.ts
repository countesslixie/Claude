import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPayor, updatePayor, createPayorInline, listActivePayors } from "@/lib/actions/payors";
import type { PayorFormState } from "@/lib/actions/payors";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

/**
 * Brief #5a — "Customers / payors": one saved list per client. Picking a
 * saved entry is what lets step 1's customer field and step 2's
 * certificate form fill TIN/address/ATC from a single source of truth
 * instead of typing (and possibly misspelling) the same company twice.
 * These tests cover the data layer that fill depends on — the actual
 * autofill itself runs in the browser (components/payor-name-field.tsx),
 * outside what this suite's tooling can exercise.
 */
describe("Payor actions — Customers / payors", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.payor.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  async function makeClient(codePrefix: string) {
    const client = await prisma.client.create({
      data: {
        code: `${codePrefix}-${Date.now()}`,
        registeredName: "Payor Action Test Client",
        tin: "999888777",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    return client;
  }

  it("a saved payor carries TIN, address and usual ATC code for the picker to fill from", async () => {
    const client = await makeClient("payor-fill");

    const result = await createPayorInline(client.id, {
      name: "Acme Test Corp.",
      tin: "123123123",
      address: "1 Test St.",
      usualAtcCode: "WI010",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payor.tin).toBe("123123123");
    expect(result.payor.address).toBe("1 Test St.");
    expect(result.payor.usualAtcCode).toBe("WI010");

    const listed = await listActivePayors(client.id);
    const found = listed.find((p) => p.name === "Acme Test Corp.");
    expect(found).toBeTruthy();
    expect(found?.tin).toBe("123123123");
    expect(found?.address).toBe("1 Test St.");
    expect(found?.usualAtcCode).toBe("WI010");
  });

  it("createPayorInline is idempotent for an exact name already saved — returns the existing entry instead of erroring", async () => {
    const client = await makeClient("payor-idempotent");

    const first = await createPayorInline(client.id, { name: "Repeat Client" });
    const second = await createPayorInline(client.id, { name: "Repeat Client", tin: "should-be-ignored" });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.payor.id).toBe(first.payor.id);
      // The second call's TIN was never applied — createPayorInline found the
      // existing row and returned it as-is, rather than overwriting it.
      expect(second.payor.tin).toBeNull();
    }

    const count = await prisma.payor.count({ where: { clientId: client.id, name: "Repeat Client" } });
    expect(count).toBe(1);
  });

  it("listActivePayors excludes deactivated entries", async () => {
    const client = await makeClient("payor-inactive");
    await createPayorInline(client.id, { name: "Will Be Deactivated" });
    const payor = await prisma.payor.findFirstOrThrow({ where: { clientId: client.id, name: "Will Be Deactivated" } });

    await updatePayor(payor.id, client.id, {} as PayorFormState, buildFormData({ name: "Will Be Deactivated", isActive: "" }));

    const active = await listActivePayors(client.id);
    expect(active.find((p) => p.id === payor.id)).toBeUndefined();

    const stillThere = await prisma.payor.findUniqueOrThrow({ where: { id: payor.id } });
    expect(stillThere.isActive).toBe(false);
  });

  it("createPayor refuses a duplicate name for the same client", async () => {
    const client = await makeClient("payor-duplicate");
    await createPayor(client.id, {} as PayorFormState, buildFormData({ name: "Dup Co." }));

    const result = await createPayor(client.id, {} as PayorFormState, buildFormData({ name: "Dup Co." }));
    expect(result.fieldErrors?.name).toBeTruthy();

    const count = await prisma.payor.count({ where: { clientId: client.id, name: "Dup Co." } });
    expect(count).toBe(1);
  });
});

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
