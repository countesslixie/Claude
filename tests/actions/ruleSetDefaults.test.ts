import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { RULE_SET_DEFAULTS } from "@/lib/ruleSetDefaults";
import { TaxRuleSetForm } from "@/components/tax-rule-set-form";
import { centsToPesos } from "@/lib/money";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));

function valueOf(html: string, name: string): string {
  const tag = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
  return /value="([^"]*)"/.exec(tag)?.[1] ?? "";
}

describe("New rule set form defaults (D171)", () => {
  const html = renderToStaticMarkup(
    createElement(TaxRuleSetForm, { action: async () => ({}), submitLabel: "Create rule set", cancelHref: "/x" }),
  );

  it("Q1 is May 15, not April 15", () => {
    expect(valueOf(html, "q1DueMonthDay")).toBe("05-15");
  });

  it("every default the form shows equals the seeded 2026 rule set", async () => {
    const seeded = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear: 2026 } });
    const shown = (n: string) => valueOf(html, n);
    expect(shown("q1DueMonthDay")).toBe(seeded.q1DueMonthDay);
    expect(shown("q2DueMonthDay")).toBe(seeded.q2DueMonthDay);
    expect(shown("q3DueMonthDay")).toBe(seeded.q3DueMonthDay);
    expect(shown("annualDueMonthDay")).toBe(seeded.annualDueMonthDay);
    expect(shown("incomeTaxRatePercent")).toBe((seeded.incomeTaxRateBps / 100).toFixed(2));
    expect(shown("vatThreshold")).toBe(centsToPesos(seeded.vatThresholdCents).replace("₱", ""));
    expect(shown("allowableDeduction")).toBe(centsToPesos(seeded.allowableDeductionCents).replace("₱", ""));
    expect(shown("sawtDeadlineOffsetDays")).toBe(String(seeded.sawtDeadlineOffsetDays));
    expect(shown("eafsDeadlineOffsetDays")).toBe(String(seeded.eafsDeadlineOffsetDays));
    expect(shown("eSubmissionEmail")).toBe(seeded.eSubmissionEmail);
    expect(shown("clientDocsDueDay")).toBe(String(seeded.clientDocsDueDay));
    // and the list itself (what the form reads) is what the seed holds
    expect(RULE_SET_DEFAULTS.q1DueMonthDay).toBe(seeded.q1DueMonthDay);
  });
});
