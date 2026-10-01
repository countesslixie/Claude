/** D129 — on screen a period reads "Q3" or "Annual", never "ANNUAL". */
export function periodLabel(period: string): string {
  return period === "ANNUAL" ? "Annual" : period;
}
