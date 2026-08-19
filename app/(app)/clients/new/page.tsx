import { ClientForm } from "@/components/client-form";
import { createClient } from "@/lib/actions/clients";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">New client</h1>
      <ClientForm action={createClient} submitLabel="Create client" />
    </div>
  );
}
