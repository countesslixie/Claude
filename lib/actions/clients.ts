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
    "email",
    "mobile",
    "taxpayerType",
    "lineOfBusiness",
    "psicCode",
    "civilStatus",
    "booksType",
    "booksRegistrationDate",
    "booksPermitNumber",
    "swornDeclarationYear",
    "eBIRFormsEmail",
    "defaultWithholdingRateBps",
    "recognitionBasis",
    "engagedSince",
    "notes",
  ]) {
    values[key] = str(formData, key);
  }

  return {
    raw: {
      ...values,
      branchCode: values.branchCode || "000",
      recognitionBasis: values.recognitionBasis || "COLLECTION",
      swornDeclarationOnFile: formData.get("swornDeclarationOnFile") === "on",
      eFPSEnrolled: formData.get("eFPSEnrolled") === "on",
      isActive: formData.get("isActive") === "on",
    },
    values: {
      ...values,
      swornDeclarationOnFile: formData.get("swornDeclarationOnFile") === "on" ? "on" : "",
      eFPSEnrolled: formData.get("eFPSEnrolled") === "on" ? "on" : "",
      isActive: formData.get("isActive") === "on" ? "on" : "",
    },
  };
}

function toDbData(input: z.infer<typeof clientSchema>) {
  return {
    code: input.code,
    registeredName: input.registeredName,
    tradeName: input.tradeName ?? null,
    tin: input.tin,
    branchCode: input.branchCode,
    rdoCode: input.rdoCode,
    registeredAddress: input.registeredAddress,
    email: input.email ?? null,
    mobile: input.mobile ?? null,
    taxpayerType: input.taxpayerType,
    lineOfBusiness: input.lineOfBusiness ?? null,
    psicCode: input.psicCode ?? null,
    civilStatus: input.civilStatus ?? null,
    booksType: input.booksType,
    booksRegistrationDate: input.booksRegistrationDate
      ? manilaDateInputToJsDate(input.booksRegistrationDate)
      : null,
    booksPermitNumber: input.booksPermitNumber ?? null,
    swornDeclarationOnFile: input.swornDeclarationOnFile,
    swornDeclarationYear: input.swornDeclarationYear ?? null,
    eBIRFormsEmail: input.eBIRFormsEmail ?? null,
    eFPSEnrolled: input.eFPSEnrolled,
    defaultWithholdingRateBps: input.defaultWithholdingRateBps ?? null,
    recognitionBasis: input.recognitionBasis,
    isActive: input.isActive,
    engagedSince: input.engagedSince ? manilaDateInputToJsDate(input.engagedSince) : null,
    notes: input.notes ?? null,
  };
}

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
    data: { ...toDbData(parsed.data), actorId },
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
    data: { ...toDbData(parsed.data), actorId },
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
