import { AtcCodeForm } from "@/components/atc-code-form";
import { createAtcCode } from "@/lib/actions/atcCodes";

export default function NewAtcCodePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">New ATC code</h1>
      <AtcCodeForm action={createAtcCode} initialValues={{ isActive: "on" }} submitLabel="Create ATC code" />
    </div>
  );
}
