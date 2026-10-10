import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatTin } from "@/lib/formatTin";
import { formatManilaDateLong } from "@/lib/dates";

/**
 * D154 — the client page's two cards, side by side (stacked on a narrow
 * screen) and the same height: Registration (three columns) and Contact &
 * business (two). Only these fields are shown; the registered name is the
 * page heading, and taxpayer type, civil status, default WHT rate, revenue
 * recognition and the whole Books & compliance card are gone from the page
 * (the columns stay in the database).
 */
export interface ClientDetails {
  tin: string;
  branchCode: string | null;
  rdoCode: string | null;
  tradeName: string | null;
  registeredAddress: string | null;
  birthDate: Date | null;
  code: string;
  email: string | null;
  mobile: string | null;
  lineOfBusiness: string | null;
  psicCode: string | null;
  engagedSince: Date | null;
  notes: string | null;
}

function Field({ label, value, mono = false, className }: { label: string; value: string | null | undefined; mono?: boolean; className?: string }) {
  const empty = value == null || value.trim() === "" || value === "—";
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${empty ? "text-faint" : "text-ink"} ${mono && !empty ? "font-mono" : ""}`}>
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

export function ClientDetailsCards({ client }: { client: ClientDetails }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="h-full" data-card="registration">
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Registration</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="TIN" value={formatTin(client.tin)} mono />
            <Field label="Branch code" value={client.branchCode} />
            <Field label="RDO code" value={client.rdoCode} />
            <Field label="Trade name" value={client.tradeName} className="sm:col-span-3" />
            <Field label="Registered address" value={client.registeredAddress} className="sm:col-span-3" />
            <Field label="Birthday" value={formatManilaDateLong(client.birthDate)} />
            <Field label="Client code" value={client.code} mono className="sm:col-span-2" />
          </dl>
        </CardBody>
      </Card>

      <Card className="h-full" data-card="contact">
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Contact &amp; business</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email" value={client.email} />
            <Field label="Mobile phone number" value={client.mobile} />
            <Field label="Line of business" value={client.lineOfBusiness} />
            <Field label="PSIC code" value={client.psicCode} />
            <Field label="Engaged since" value={formatManilaDateLong(client.engagedSince)} />
            <Field label="Notes" value={client.notes} className="whitespace-pre-wrap" />
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
