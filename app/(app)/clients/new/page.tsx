import { ClientForm } from "@/components/client-form";
import { createClient } from "@/lib/actions/clients";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">New client</h1>
      <ClientForm action={createClient} submitLabel="Create client" cancelHref="/clients" suggestCode />
    </div>
  );
}
