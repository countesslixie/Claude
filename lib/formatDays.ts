/**
 * D117 — the one place a day count becomes words: "0 days", "1 day", "46 days".
 * Every on-screen day count goes through here so the wording is identical on
 * the filing page, the board and the dashboard.
 */
export function formatDays(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}
