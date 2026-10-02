"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientSchema } from "@/lib/validation/client";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";

export type ClientFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of [
    "code",
    "registeredName",
    "tradeName",
    "tin",
    "branchCode",
    "rdoCode",
    "registeredAddress",
    "birthDate",
    "email",
    "mobile",
    "lineOfBusiness",
    "psicCode",
    "engagedSince",
    "notes",
  ]) {
    values[key] = str(formData, key);
  }

  return {
    raw: {
      ...values,
      branchCode: values.branchCode || "000",
      isActive: formData.get("isActive") === "on",
    },
    values: {
      ...values,
      isActive: formData.get("isActive") === "on" ? "on" : "",
    },
  };
}

/**
 * The fields the form shows. Used by both create and update. (D145) Nothing
 * the form no longer asks for is in here, so an update can never overwrite
 * taxpayer type, recognition basis, civil status, default WHT rate or the
 * books fields.
 */
function formFieldsToDbData(input: z.infer<typeof clientSchema>) {
  return {
    code: input.code,
    registeredName: input.registeredName,
    tradeName: input.tradeName ?? null,
    tin: input.tin,
    branchCode: input.branchCode,
    rdoCode: input.rdoCode,
    registeredAddress: input.registeredAddress,
    birthDate: manilaDateInputToJsDate(input.birthDate),
    email: input.email ?? null,
    mobile: input.mobile ?? null,
    lineOfBusiness: input.lineOfBusiness ?? null,
    psicCode: input.psicCode ?? null,
    isActive: input.isActive,
    engagedSince: input.engagedSince ? manilaDateInputToJsDate(input.engagedSince) : null,
    notes: input.notes ?? null,
  };
}

/**
 * Brief #6b (D145) — every new client is purely self-employed (₱250,000
 * deduction, 1701A) and reports on collections. booksType is a required
 * column with no schema default, so it gets the same "Manual" the sample
 * clients carry; the form never asks. Everything else stays empty / at its
 * schema default.
 */
const NEW_CLIENT_FIXED_VALUES = {
  taxpayerType: "PURELY_SELF_EMPLOYED",
  recognitionBasis: "COLLECTION",
  booksType: "MANUAL",
} as const;

export async function createClient(
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const { raw, values } = rawFromFormData(formData);
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const existing = await prisma.client.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return {
      fieldErrors: { code: ["A client with this code already exists."] },
      values,
    };
  }

  const actorId = await getActorId();
  const client = await prisma.client.create({
    data: { ...formFieldsToDbData(parsed.data), ...NEW_CLIENT_FIXED_VALUES, actorId },
  });
  await logActivity({
    entityType: "Client",
    entityId: client.id,
    action: "CREATE",
    after: client,
    actorId,
  });

  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(
  id: string,
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const { raw, values } = rawFromFormData(formData);
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const before = await prisma.client.findUnique({ where: { id } });
  if (!before) {
    return { error: "Client not found." };
  }
  if (parsed.data.code !== before.code) {
    const codeTaken = await prisma.client.findUnique({ where: { code: parsed.data.code } });
    if (codeTaken) {
      return { fieldErrors: { code: ["A client with this code already exists."] }, values };
    }
  }

  const actorId = await getActorId();
  const client = await prisma.client.update({
    where: { id },
    data: { ...formFieldsToDbData(parsed.data), actorId },
  });
  await logActivity({
    entityType: "Client",
    entityId: client.id,
    action: "UPDATE",
    before,
    after: client,
    actorId,
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${client.id}`);
}
