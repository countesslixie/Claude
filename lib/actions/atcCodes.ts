"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { atcCodeSchema } from "@/lib/validation/atcCode";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { percentToBps } from "@/lib/money";

export type AtcCodeFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

const FIELDS = ["code", "description", "ratePercent", "notes"] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  values.isActive = formData.get("isActive") === "on" ? "on" : "";
  return values;
}

function parse(formData: FormData) {
  const raw = rawFromFormData(formData);
  return {
    raw,
    parsed: atcCodeSchema.safeParse({
      ...raw,
      isActive: raw.isActive === "on",
    }),
  };
}

/**
 * Brief #5a — the ATC maintenance screen (Settings, alongside holidays and
 * tax rule sets), backed by the existing AtcCode table (D19). Add, edit
 * and deactivate only — no hard delete, since a code already used on a
 * saved certificate must keep meaning what it meant when it was chosen.
 */
export async function createAtcCode(
  _prevState: AtcCodeFormState,
  formData: FormData,
): Promise<AtcCodeFormState> {
  const { raw: values, parsed } = parse(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const existing = await prisma.atcCode.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return { fieldErrors: { code: ["An ATC code with this code already exists."] }, values };
  }

  const actorId = await getActorId();
  const atcCode = await prisma.atcCode.create({
    data: {
      code: parsed.data.code,
      description: parsed.data.description,
      rateBps: percentToBps(parsed.data.ratePercent),
      // D164 — corporations are not on the 8% option, so a new code is always Individual.
      // verifiedAgainstIssuance takes the schema default (D165).
      payeeType: "Individual",
      isActive: parsed.data.isActive,
      notes: parsed.data.notes ?? null,
    },
  });

  await logActivity({ entityType: "AtcCode", entityId: atcCode.id, action: "CREATE", after: atcCode, actorId });

  revalidatePath("/settings/atc-codes");
  redirect("/settings/atc-codes");
}

export async function updateAtcCode(
  id: string,
  _prevState: AtcCodeFormState,
  formData: FormData,
): Promise<AtcCodeFormState> {
  const { raw: values, parsed } = parse(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const before = await prisma.atcCode.findUnique({ where: { id } });
  if (!before) return { error: "ATC code not found." };

  if (parsed.data.code !== before.code) {
    const taken = await prisma.atcCode.findUnique({ where: { code: parsed.data.code } });
    if (taken) {
      return { fieldErrors: { code: ["An ATC code with this code already exists."] }, values };
    }
  }

  const actorId = await getActorId();
  const atcCode = await prisma.atcCode.update({
    where: { id },
    data: {
      code: parsed.data.code,
      description: parsed.data.description,
      rateBps: percentToBps(parsed.data.ratePercent),
      // payeeType and verifiedAgainstIssuance are left as stored (D164/D165).
      isActive: parsed.data.isActive,
      notes: parsed.data.notes ?? null,
    },
  });

  await logActivity({ entityType: "AtcCode", entityId: id, action: "UPDATE", before, after: atcCode, actorId });

  revalidatePath("/settings/atc-codes");
  redirect("/settings/atc-codes");
}
