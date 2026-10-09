"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { birLoginSchema, BIR_LOGIN_FIELDS } from "@/lib/validation/birLogin";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";

export type BirLoginResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * D180 — save one client's six login fields. The activity log gets a plain note
 * naming the client and NOTHING else: no before/after JSON, no value, ever.
 * Nothing here writes to the console, and error text never contains a value.
 */
export async function saveBirLogins(clientId: string, values: Record<string, string>): Promise<BirLoginResult> {
  const raw: Record<string, string> = {};
  for (const key of BIR_LOGIN_FIELDS) raw[key] = typeof values[key] === "string" ? values[key] : "";

  const parsed = birLoginSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, error: "Please fix the highlighted boxes.", fieldErrors };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, registeredName: true } });
  if (!client) return { ok: false, error: "Client not found." };

  const actorId = await getActorId();
  await prisma.clientBirLogin.upsert({
    where: { clientId },
    create: { clientId, ...parsed.data },
    update: parsed.data,
  });
  await logActivity({
    entityType: "ClientBirLogin",
    entityId: clientId,
    action: "UPDATE",
    note: `BIR logins updated for ${client.registeredName}`,
    actorId,
  });

  revalidatePath("/settings/bir-logins");
  return { ok: true };
}
