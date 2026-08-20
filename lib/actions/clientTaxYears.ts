"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clientTaxYearSchema } from "@/lib/validation/clientTaxYear";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents } from "@/lib/money";

export type ClientTaxYearFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

const FIELDS = [
  "taxableYear",
  "regime",
  "electionStatus",
  "priorYearExcessCredit",
  "yearEndCreditElection",
] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  return values;
}

export async function createClientTaxYear(
  clientId: string,
  _prevState: ClientTaxYearFormState,
  formData: FormData,
): Promise<ClientTaxYearFormState> {
  const values = rawFromFormData(formData);
  const parsed = clientTaxYearSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { error: "Client not found." };

  const existing = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId, taxableYear: parsed.data.taxableYear } },
  });
  if (existing) {
    return {
      fieldErrors: { taxableYear: ["This client already has a tax year row for that year."] },
      values,
    };
  }

  const actorId = await getActorId();
  const taxYear = await prisma.clientTaxYear.create({
    data: {
      clientId,
      taxableYear: parsed.data.taxableYear,
      regime: parsed.data.regime,
      electionStatus: parsed.data.electionStatus,
      priorYearExcessCreditCents: pesosToCents(parsed.data.priorYearExcessCredit),
      yearEndCreditElection: parsed.data.yearEndCreditElection,
      actorId,
    },
  });

  await logActivity({
    entityType: "ClientTaxYear",
    entityId: taxYear.id,
    action: "CREATE",
    after: taxYear,
    actorId,
  });

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function updateClientTaxYear(
  id: string,
  _prevState: ClientTaxYearFormState,
  formData: FormData,
): Promise<ClientTaxYearFormState> {
  const values = rawFromFormData(formData);
  const parsed = clientTaxYearSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const before = await prisma.clientTaxYear.findUnique({ where: { id } });
  if (!before) return { error: "Tax year not found." };

  if (parsed.data.taxableYear !== before.taxableYear) {
    const taken = await prisma.clientTaxYear.findUnique({
      where: {
        clientId_taxableYear: { clientId: before.clientId, taxableYear: parsed.data.taxableYear },
      },
    });
    if (taken) {
      return {
        fieldErrors: { taxableYear: ["This client already has a tax year row for that year."] },
        values,
      };
    }
  }

  const actorId = await getActorId();
  const taxYear = await prisma.clientTaxYear.update({
    where: { id },
    data: {
      taxableYear: parsed.data.taxableYear,
      regime: parsed.data.regime,
      electionStatus: parsed.data.electionStatus,
      priorYearExcessCreditCents: pesosToCents(parsed.data.priorYearExcessCredit),
      yearEndCreditElection: parsed.data.yearEndCreditElection,
      actorId,
    },
  });

  await logActivity({
    entityType: "ClientTaxYear",
    entityId: taxYear.id,
    action: "UPDATE",
    before,
    after: taxYear,
    actorId,
  });

  revalidatePath(`/clients/${before.clientId}`);
  redirect(`/clients/${before.clientId}`);
}
