import { prisma } from "@/lib/prisma";

let cachedActorId: string | null = null;

/**
 * Single-operator MVP: every mutation records an actorId, defaulted to the
 * one seeded User (see SPEC.md section 2). This keeps the schema ready for
 * multi-user without building auth-per-user now.
 */
export async function getActorId(): Promise<string> {
  if (cachedActorId) return cachedActorId;
  const user = await prisma.user.findFirstOrThrow();
  cachedActorId = user.id;
  return cachedActorId;
}
