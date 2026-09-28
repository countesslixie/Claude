import { TaxRuleSetForm } from "@/components/tax-rule-set-form";
import { createTaxRuleSet } from "@/lib/actions/taxRuleSets";

export default function NewTaxRuleSetPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">New tax rule set</h1>
      <TaxRuleSetForm action={createTaxRuleSet} submitLabel="Create rule set" />
    </div>
  );
}
