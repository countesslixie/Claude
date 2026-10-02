/**
 * D135 — the one place that decides what a group header shows when every step
 * in it is not applicable: a grey "Not applicable" pill (never the green
 * "Done"), with the group's own text beside it. eAFS (D134) and Pay both use it.
 * Display only: how the steps are stored or set to NA is unchanged.
 */
export const NOT_APPLICABLE_PILL = "Not applicable" as const;

export interface NaGroupHeader {
  pillLabel: typeof NOT_APPLICABLE_PILL;
  text: string;
}

export function naGroupHeader(text: string): NaGroupHeader {
  return { pillLabel: NOT_APPLICABLE_PILL, text };
}

/** Pay: "Nothing to pay …" (the existing label, or null when steps 8/9 are not both NA). */
export function payHeaderDisplay(nothingToPayLabel: string | null): NaGroupHeader | null {
  return nothingToPayLabel ? naGroupHeader(nothingToPayLabel) : null;
}
