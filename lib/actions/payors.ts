"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { payorSchema } from "@/lib/validation/payor";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";

export type PayorFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export interface SavedPayor {
  id: string;
  name: string;
  tin: string | null;
  address: string | null;
  usualAtcCode: string | null;
}

/** Active payors for a client, for the step 1/step 2 pickers. */
export async function listActivePayors(clientId: string): Promise<SavedPayor[]> {
  const rows = await prisma.payor.findMany({
    where: { clientId, isActive: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, tin: r.tin, address: r.address, usualAtcCode: r.usualAtcCode }));
}

const FIELDS = ["name", "tin", "address", "usualAtcCode"] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  values.isActive = formData.get("isActive") === "on" ? "on" : "";
  return values;
}

/**
 * Brief #5a — "Customers / payors": one saved list per client, added
 * inline (right from step 1/step 2, see createPayorInline below) or from
 * the small maintenance screen this action backs. A duplicate name for
 * the same client is refused rather than silently creating a second,
 * possibly-different entry with the same name (D19-adjacent: the app
 * should never let two records claim the same identity quietly).
 */
export async function createPayor(
  clientId: string,
  _prevState: PayorFormState,
  formData: FormData,
): Promise<PayorFormState> {
  const values = rawFromFormData(formData);
  const parsed = payorSchema.safeParse({ ...values, isActive: values.isActive === "on" });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const existing = await prisma.payor.findUnique({
    where: { clientId_name: { clientId, name: parsed.data.name } },
  });
  if (existing) {
    return { fieldErrors: { name: ["Already on this client's saved list."] }, values };
  }

  const actorId = await getActorId();
  const payor = await prisma.payor.create({
    data: {
      clientId,
      name: parsed.data.name,
      tin: parsed.data.tin ?? null,
      address: parsed.data.address ?? null,
      usualAtcCode: parsed.data.usualAtcCode ?? null,
      isActive: parsed.data.isActive,
      actorId,
    },
  });

  await logActivity({ entityType: "Payor", entityId: payor.id, action: "CREATE", after: payor, actorId });

  revalidatePath(`/clients/${clientId}/payors`);
  return {};
}

export async function updatePayor(
  id: string,
  clientId: string,
  _prevState: PayorFormState,
  formData: FormData,
): Promise<PayorFormState> {
  const values = rawFromFormData(formData);
  const parsed = payorSchema.safeParse({ ...values, isActive: values.isActive === "on" });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const before = await prisma.payor.findUnique({ where: { id } });
  if (!before || before.clientId !== clientId) return { error: "Not found." };

  if (parsed.data.name !== before.name) {
    const taken = await prisma.payor.findUnique({ where: { clientId_name: { clientId, name: parsed.data.name } } });
    if (taken) return { fieldErrors: { name: ["Already on this client's saved list."] }, values };
  }

  const actorId = await getActorId();
  const payor = await prisma.payor.update({
    where: { id },
    data: {
      name: parsed.data.name,
      tin: parsed.data.tin ?? null,
      address: parsed.data.address ?? null,
      usualAtcCode: parsed.data.usualAtcCode ?? null,
      isActive: parsed.data.isActive,
      actorId,
    },
  });

  await logActivity({ entityType: "Payor", entityId: id, action: "UPDATE", before, after: payor, actorId });

  revalidatePath(`/clients/${clientId}/payors`);
  redirect(`/clients/${clientId}/payors`);
}

/**
 * Brief #5a — "typing a name that isn't on the list offers to save it,
 * right there": called directly from the step 1 customer-name field and
 * step 2's certificate form, not as a <form action>, so it returns a
 * plain result instead of redirecting. If the name is somehow already
 * saved (e.g. a second row typed the same new name before the page
 * re-fetched its payor list), this returns the existing entry instead of
 * erroring — the offer was to make sure it's saved, and it already is.
 */
export async function createPayorInline(
  clientId: string,
  data: { name: string; tin?: string; address?: string; usualAtcCode?: string },
): Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }> {
  const parsed = payorSchema.safeParse({ ...data, isActive: true });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().fieldErrors.name?.[0] ?? "Could not save." };
  }

  const existing = await prisma.payor.findUnique({
    where: { clientId_name: { clientId, name: parsed.data.name } },
  });
  if (existing) {
    return {
      ok: true,
      payor: { id: existing.id, name: existing.name, tin: existing.tin, address: existing.address, usualAtcCode: existing.usualAtcCode },
    };
  }

  const actorId = await getActorId();
  const payor = await prisma.payor.create({
    data: {
      clientId,
      name: parsed.data.name,
      tin: parsed.data.tin ?? null,
      address: parsed.data.address ?? null,
      usualAtcCode: parsed.data.usualAtcCode ?? null,
      actorId,
    },
  });

  await logActivity({ entityType: "Payor", entityId: payor.id, action: "CREATE", after: payor, actorId });

  revalidatePath(`/clients/${clientId}/payors`);
  return {
    ok: true,
    payor: { id: payor.id, name: payor.name, tin: payor.tin, address: payor.address, usualAtcCode: payor.usualAtcCode },
  };
}
