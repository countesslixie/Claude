import { NOT_APPLICABLE_PILL, naGroupHeader } from "@/lib/workflow/naGroupHeader";

/**
 * D134 — eAFS's header on a filing with no Form 2307: "Pending" while step 2
 * is still open (nobody knows yet whether certificates will come), then a grey
 * "Not applicable" once step 2 is Done or Skipped. Never a green "Done".
 * Display only: how steps 11–15 are stored or set to NA (D93) is unchanged.
 * Returns null when the header should render as before (a certificate exists,
 * or the group still has applicable steps).
 */
export interface EafsHeaderDisplay {
  pillLabel: "Pending" | typeof NOT_APPLICABLE_PILL;
  text: string;
}

export function eafsHeaderDisplay(input: {
  step2Status: string | undefined;
  certificateCount: number;
  applicableStepCount: number;
}): EafsHeaderDisplay | null {
  if (input.certificateCount > 0 || input.applicableStepCount > 0) return null;
  const settled = input.step2Status === "DONE" || input.step2Status === "SKIPPED";
  return settled
    ? naGroupHeader("No Form 2307")
    : { pillLabel: "Pending", text: "Depends on Form 2307s (step 2)" };
}
