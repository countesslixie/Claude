import { describe, it, expect } from "vitest";
import { formatDays } from "@/lib/formatDays";

describe("formatDays (D117)", () => {
  it("spells the count out, singular only for one", () => {
    expect(formatDays(0)).toBe("0 days");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(2)).toBe("2 days");
    expect(formatDays(46)).toBe("46 days");
  });
});
