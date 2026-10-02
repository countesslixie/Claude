/**
 * D126/D129/D137 — the dashboard's sections, in order (Missing documents and the election alerts are gone). "Upcoming deadlines" is gone:
 * every unfiled return already shows under one of the first three.
 */
export const DASHBOARD_SECTIONS = [
  "Needs my action now",
  "Waiting on client",
  "Waiting on BIR",
  "3M Threshold Alert",
] as const;

/** D129 — every dashboard table: earliest due date first, then client name. */
export function sortByDueThenClient<T extends { dueDate: Date; clientName: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.clientName.localeCompare(b.clientName),
  );
}
