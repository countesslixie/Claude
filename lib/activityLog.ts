import { prisma } from "@/lib/prisma";
import type { ActivityAction } from "@prisma/client";

/**
 * Append-only audit trail. Every create/update/delete of a tracked entity
 * writes a row here; rows are never hard-deleted (see SPEC.md sections 5, 14).
 */
export async function logActivity(params: {
  entityType: string;
  entityId: string;
  action: ActivityAction;
  before?: unknown;
  after?: unknown;
  actorId: string;
}) {
  await prisma.activityLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      beforeJson: params.before === undefined ? undefined : JSON.stringify(params.before),
      afterJson: params.after === undefined ? undefined : JSON.stringify(params.after),
      actorId: params.actorId,
    },
  });
}
