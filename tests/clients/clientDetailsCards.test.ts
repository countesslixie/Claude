import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientDetailsCards, type ClientDetails } from "@/components/client-details-cards";

const client: ClientDetails = {
  tin: "123456789",
  branchCode: "000",
  rdoCode: "039",
  tradeName: "Pixel Studio",
  registeredAddress: "18 Maginhawa St, Quezon City",
  birthDate: new Date("1990-01-05T00:00:00.000Z"),
  code: "pangilinan-a",
  email: "a@example.com",
  mobile: "0917-000-0102",
  lineOfBusiness: "Video editing",
  psicCode: "5911",
  engagedSince: new Date("2026-01-15T00:00:00.000Z"),
  notes: "Sample note",
};

const html = (c: ClientDetails) => renderToStaticMarkup(createElement(ClientDetailsCards, { client: c }));
const labels = (h: string) => [...h.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1]);

describe("client page cards (D154)", () => {
  it("shows exactly the fields of the two cards, in order, with the written labels", () => {
    const h = html(client);
    expect(labels(h)).toEqual([
      "TIN", "Branch code", "RDO code", "Trade name", "Registered address", "Birthday", "Client code",
      "Email", "Mobile phone number", "Line of business", "PSIC code", "Engaged since", "Notes",
    ]);
    expect(h).toContain("Registration");
    expect(h).toContain("Contact &amp; business");
  });

  it("does not render the removed fields or the Books & compliance card", () => {
    const h = html(client);
    for (const gone of [
      "Books &amp; compliance", "Books type", "Books registration date", "Books permit number", "Sworn declaration",
      "eBIRForms", "eFPS", "Taxpayer type", "Civil status", "Default WHT rate", "Revenue recognition",
    ]) {
      expect(h).not.toContain(gone);
    }
    expect(labels(h)).not.toContain("Mobile");
  });

  it("writes dates with full month names and shows a muted dash for an empty value", () => {
    const h = html(client);
    expect(h).toContain("January 5, 1990");
    expect(h).toContain("January 15, 2026");

    const empty = html({ ...client, tradeName: null, birthDate: null, engagedSince: null, notes: "", psicCode: null });
    expect(empty.match(/text-faint[^"]*">—<\/dd>/g)?.length).toBe(5);
  });

  it("keeps the TIN and client code in monospace, and stacks the cards on a narrow screen", () => {
    const h = html(client);
    expect(h).toMatch(/font-mono[^>]*>123456789</);
    expect(h).toMatch(/font-mono[^>]*>pangilinan-a</);
    expect(h).toContain("grid-cols-1");
    expect(h).toContain("lg:grid-cols-[3fr_2fr]");
  });
});
