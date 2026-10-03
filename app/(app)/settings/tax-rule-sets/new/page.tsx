import { TaxRuleSetForm } from "@/components/tax-rule-set-form";
import { createTaxRuleSet } from "@/lib/actions/taxRuleSets";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

export default function NewTaxRuleSetPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">New tax rule set</h1>
      <TaxRuleSetForm action={createTaxRuleSet} submitLabel="Create rule set" cancelHref="/settings/tax-rule-sets" />
    </div>
  );
}
