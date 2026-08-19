import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { centsToPesos, bpsToPercentLabel } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";

export default async function TaxRuleSetsPage() {
  const ruleSets = await prisma.taxRuleSet.findMany({ orderBy: { taxableYear: "desc" } });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Tax rule sets</h1>
          <p className="text-sm text-slate-500">
            Every rate, threshold, and deadline the tax engine uses — versioned by taxable year,
            never hardcoded (SPEC.md section 3).
          </p>
        </div>
        <Link href="/settings/tax-rule-sets/new">
          <Button>New rule set</Button>
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Taxable year</th>
              <th>Effective</th>
              <th>Rate</th>
              <th>VAT threshold</th>
              <th>Deduction</th>
              <th>Q1 / Q2 / Q3 / Annual due</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ruleSets.map((rs) => (
              <tr key={rs.id}>
                <td className="font-medium">{rs.taxableYear}</td>
                <td>
                  {formatManilaDate(rs.effectiveFrom)}
                  {rs.effectiveTo ? ` – ${formatManilaDate(rs.effectiveTo)}` : " – open"}
                </td>
                <td>{bpsToPercentLabel(rs.incomeTaxRateBps)}</td>
                <td>{centsToPesos(rs.vatThresholdCents, { withSymbol: true })}</td>
                <td>{centsToPesos(rs.allowableDeductionCents, { withSymbol: true })}</td>
                <td className="font-mono text-xs">
                  {rs.q1DueMonthDay} / {rs.q2DueMonthDay} / {rs.q3DueMonthDay} / {rs.annualDueMonthDay}
                </td>
                <td>
                  <Link href={`/settings/tax-rule-sets/${rs.id}`} className="text-sm text-slate-600 hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {ruleSets.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-400">
                  No rule sets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
