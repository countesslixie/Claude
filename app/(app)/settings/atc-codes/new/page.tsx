import { AtcCodeForm } from "@/components/atc-code-form";
import { createAtcCode } from "@/lib/actions/atcCodes";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

export default function NewAtcCodePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">New ATC</h1>
      <AtcCodeForm cancelHref="/settings/atc-codes" action={createAtcCode} initialValues={{ isActive: "on" }} submitLabel="Create ATC" />
    </div>
  );
}
