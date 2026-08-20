"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { form2307Schema } from "@/lib/validation/form2307";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";
import { pesosToCents } from "@/lib/money";

export type Form2307FormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

const FIELDS = [
  "payorName",
  "payorTin",
  "payorAddress",
  "periodFrom",
  "periodTo",
  "quarterCovered",
  "atcCode",
  "incomePayment",
  "taxWithheld",
  "withholdingRateBps",
  "dateReceived",
  "notes",
] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  return values;
}

export async function createForm2307(
  clientId: string,
  taxableYear: number,
  _prevState: Form2307FormState,
  formData: FormData,
): Promise<Form2307FormState> {
  const values = rawFromFormData(formData);
  const parsed = form2307Schema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { error: "Client not found." };

  const actorId = await getActorId();
  const cert = await prisma.form2307.create({
    data: {
      clientId,
      taxableYear,
      payorName: parsed.data.payorName,
      payorTin: parsed.data.payorTin ?? null,
      payorAddress: parsed.data.payorAddress ?? null,
      periodFrom: manilaDateInputToJsDate(parsed.data.periodFrom),
      periodTo: manilaDateInputToJsDate(parsed.data.periodTo),
      quarterCovered: parsed.data.quarterCovered,
      atcCode: parsed.data.atcCode,
      incomePaymentCents: pesosToCents(parsed.data.incomePayment),
      taxWithheldCents: pesosToCents(parsed.data.taxWithheld),
      withholdingRateBps: parsed.data.withholdingRateBps,
      dateReceived: parsed.data.dateReceived ? manilaDateInputToJsDate(parsed.data.dateReceived) : null,
      status: "RECEIVED",
      notes: parsed.data.notes ?? null,
      actorId,
    },
  });

  await logActivity({
    entityType: "Form2307",
    entityId: cert.id,
    action: "CREATE",
    after: cert,
    actorId,
  });

  revalidatePath(`/clients/${clientId}/form-2307`);
  redirect(`/clients/${clientId}/form-2307?year=${taxableYear}&quarter=${parsed.data.quarterCovered}`);
}
