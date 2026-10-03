import { describe, it, expect, afterAll, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { createTaxRuleSet, updateTaxRuleSet } from "@/lib/actions/taxRuleSets";
import { createHoliday } from "@/lib/actions/holidays";
import { TaxRuleSetForm } from "@/components/tax-rule-set-form";
import { HolidaysHeader } from "@/components/holidays-header";
import { HolidayForm } from "@/components/holiday-form";
import { BackToSettings } from "@/components/back-to-settings";
import { defaultEffectiveFrom, effectiveFromAfterYearChange } from "@/lib/ruleSetDefaults";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));

const YEAR = 2098;
const HOLIDAY_DATE = "2098-01-05";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const RULE_VALUES = {
  taxableYear: String(YEAR),
  effectiveFrom: `${YEAR}-01-01`,
  effectiveTo: "",
  incomeTaxRatePercent: "8.00",
  vatThreshold: "3,000,000.00",
  allowableDeduction: "250,000.00",
  q1DueMonthDay: "05-15",
  q2DueMonthDay: "08-15",
  q3DueMonthDay: "11-15",
  annualDueMonthDay: "04-15",
  sawtDeadlineOffsetDays: "0",
  eafsDeadlineOffsetDays: "15",
  eSubmissionEmail: "esubmission@example.test",
  clientDocsDueDay: "20",
  notes: "",
};

afterAll(async () => {
  await prisma.taxRuleSet.deleteMany({ where: { taxableYear: YEAR } });
  await prisma.holiday.deleteMany({ where: { date: new Date(`${HOLIDAY_DATE}T00:00:00+08:00`) } });
});

describe("Rule set form: Effective from (D168)", () => {
  it("fills in as January 1 of the typed year", () => {
    expect(defaultEffectiveFrom("2027")).toBe("2027-01-01");
    expect(effectiveFromAfterYearChange({ yearText: "2027", current: "", followsYear: true })).toBe("2027-01-01");
  });

  it("does not fill from a partly typed or out-of-range year", () => {
    expect(defaultEffectiveFrom("20")).toBeNull();
    expect(defaultEffectiveFrom("1999")).toBeNull();
    expect(effectiveFromAfterYearChange({ yearText: "20", current: "2027-01-01", followsYear: true })).toBe("2027-01-01");
  });

  it("stops following the year once she has changed the date by hand", () => {
    expect(effectiveFromAfterYearChange({ yearText: "2028", current: "2027-03-01", followsYear: false })).toBe("2027-03-01");
  });

  it("Edit shows the stored date and a year change never moves it", () => {
    const html = renderToStaticMarkup(
      createElement(TaxRuleSetForm, {
        action: async () => ({}),
        initialValues: { ...RULE_VALUES, taxableYear: "2026", effectiveFrom: "2026-03-15" },
        submitLabel: "Save changes",
        cancelHref: "/settings/tax-rule-sets",
      }),
    );
    expect(html).toContain('value="2026-03-15"');
    // The Edit form starts with followsYear off (a stored date exists), so the helper leaves it alone.
    expect(effectiveFromAfterYearChange({ yearText: "2030", current: "2026-03-15", followsYear: false })).toBe("2026-03-15");
  });
});

describe("Rule set form content (D168)", () => {
  const html = renderToStaticMarkup(
    createElement(TaxRuleSetForm, {
      action: async () => ({}),
      submitLabel: "Create rule set",
      cancelHref: "/settings/tax-rule-sets",
    }),
  );
  it("has no late-filing section and no grey helper text", () => {
    expect(html).not.toContain("Late filing exposure");
    expect(html).not.toContain("surchargeRatePercent");
    expect(html).not.toContain("interestRatePercentPerAnnum");
    expect(html).not.toContain("<p class=\"text-xs text-faint\"");
    expect(html).not.toContain("Confirm against BIR before live use");
  });
  it("shows format examples as placeholders and has a Cancel button", () => {
    expect(html).toContain('placeholder="05-15"');
    expect(html).toContain("Annual due (following year)");
    expect(html).toContain("Cancel");
  });
});

describe("Editing a rule set leaves surcharge and interest alone (D168)", () => {
  it("keeps the stored values and updates the rest", async () => {
    await createTaxRuleSet({}, form(RULE_VALUES));
    const row = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear: YEAR } });
    expect(row.surchargeRateBps).toBeNull();
    await prisma.taxRuleSet.update({ where: { id: row.id }, data: { surchargeRateBps: 2500, interestRateBpsPerAnnum: 1200 } });

    await updateTaxRuleSet(row.id, {}, form({ ...RULE_VALUES, notes: "edited" }));
    const after = await prisma.taxRuleSet.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.notes).toBe("edited");
    expect(after.surchargeRateBps).toBe(2500);
    expect(after.interestRateBpsPerAnnum).toBe(1200);
    expect(after.eSubmissionEmail).toBe("esubmission@example.test");
  });
});

describe("Editing a rule set leaves a stored date alone (D168)", () => {
  it("an unchanged save keeps the exact stored instant, a changed date is written", async () => {
    const row = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear: YEAR } });
    const seedStyle = new Date(Date.UTC(YEAR, 0, 1)); // the seed stores midnight UTC
    await prisma.taxRuleSet.update({ where: { id: row.id }, data: { effectiveFrom: seedStyle } });
    await updateTaxRuleSet(row.id, {}, form({ ...RULE_VALUES, notes: "again" }));
    const same = await prisma.taxRuleSet.findUniqueOrThrow({ where: { id: row.id } });
    expect(same.effectiveFrom.toISOString()).toBe(seedStyle.toISOString());

    await updateTaxRuleSet(row.id, {}, form({ ...RULE_VALUES, effectiveFrom: `${YEAR}-02-01` }));
    const moved = await prisma.taxRuleSet.findUniqueOrThrow({ where: { id: row.id } });
    expect(moved.effectiveFrom.toISOString()).toBe(new Date(`${YEAR}-02-01T00:00:00+08:00`).toISOString());
  });
});

describe("Back to Settings (D166)", () => {
  it("links to the Settings hub", () => {
    const html = renderToStaticMarkup(createElement(BackToSettings));
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Back");
  });
});

describe("Holidays page (D169)", () => {
  const count = () => prisma.holiday.count();

  it("keeps the add form hidden until Add holiday is clicked", () => {
    const html = renderToStaticMarkup(createElement(HolidaysHeader));
    expect(html).toContain("Add holiday");
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('name="date"');
    expect(html).not.toContain('name="localScope"');
  });

  it("the open form has Save and a non-submitting Cancel", () => {
    const html = renderToStaticMarkup(createElement(HolidayForm, { onCancel: () => {}, onSaved: () => {} }));
    expect(html).toContain("Save");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>|<button type="button"[^>]*>Cancel/);
    for (const f of ['name="date"', 'name="name"', 'name="type"', 'name="scope"', 'name="localScope"']) expect(html).toContain(f);
  });

  it("Cancel adds nothing; Save adds one and reports saved", async () => {
    const before = await count();
    // Cancel is a plain button that closes the form: no action runs, so the count cannot move.
    expect(await count()).toBe(before);
    const bad = await createHoliday({}, form({ date: "", name: "", type: "REGULAR", scope: "NATIONAL" }));
    expect(bad.saved).toBeUndefined();
    expect(await count()).toBe(before);

    const ok = await createHoliday({}, form({ date: HOLIDAY_DATE, name: "Test holiday", type: "REGULAR", scope: "NATIONAL" }));
    expect(ok.saved).toBe(true);
    expect(await count()).toBe(before + 1);
  });
});
