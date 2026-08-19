"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { holidaySchema } from "@/lib/validation/holiday";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";

export type HolidayFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export async function createHoliday(
  _prevState: HolidayFormState,
  formData: FormData,
): Promise<HolidayFormState> {
  const values = {
    date: String(formData.get("date") ?? ""),
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? ""),
    scope: String(formData.get("scope") ?? "NATIONAL"),
    localScope: String(formData.get("localScope") ?? ""),
  };

  const parsed = holidaySchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const actorId = await getActorId();
  try {
    const holiday = await prisma.holiday.create({
      data: {
        date: manilaDateInputToJsDate(parsed.data.date),
        name: parsed.data.name,
        type: parsed.data.type,
        scope: parsed.data.scope,
        localScope: parsed.data.localScope ?? null,
        actorId,
      },
    });
    await logActivity({
      entityType: "Holiday",
      entityId: holiday.id,
      action: "CREATE",
      after: holiday,
      actorId,
    });
  } catch {
    return {
      fieldErrors: { date: ["A holiday with this date and scope already exists."] },
      values,
    };
  }

  revalidatePath("/settings/holidays");
  return {};
}

export async function deleteHoliday(id: string): Promise<void> {
  const actorId = await getActorId();
  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) return;
  await prisma.holiday.delete({ where: { id } });
  await logActivity({
    entityType: "Holiday",
    entityId: id,
    action: "DELETE",
    before,
    actorId,
  });
  revalidatePath("/settings/holidays");
}
