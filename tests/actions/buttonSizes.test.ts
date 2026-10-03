import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { BackToSettings } from "@/components/back-to-settings";
import { HolidaysHeader } from "@/components/holidays-header";
import { HolidayForm } from "@/components/holiday-form";
import { PayorsHeader } from "@/components/payors-header";
import { PayorForm } from "@/components/payor-form";
import { AtcCodeForm } from "@/components/atc-code-form";
import { TaxRuleSetForm } from "@/components/tax-rule-set-form";
import { ClientForm } from "@/components/client-form";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));

/** The classes that set a button's size — never its colour. */
const SIZE_CLASS = /^(h-|px-|py-|text-(xs|sm|base|lg))/;

/** Size classes of every <button> in the markup, keyed by its visible text. */
function buttonSizes(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const cls = /class="([^"]*)"/.exec(m[1])?.[1] ?? "";
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    out[text] = cls.split(/\s+/).filter((c) => SIZE_CLASS.test(c)).sort().join(" ");
  }
  return out;
}

const noopAction = async () => ({});

describe("Matching button sizes (D170)", () => {
  const standard = buttonSizes(renderToStaticMarkup(createElement(Button, null, "New ATC")))["New ATC"];

  it("the standard button has a real size", () => {
    expect(standard).toMatch(/h-\d/);
  });

  it("a header pair: New ATC (primary) and Back (bordered) are the same size", () => {
    const back = buttonSizes(renderToStaticMarkup(createElement(BackToSettings)))["Back"];
    expect(back).toBe(standard);
  });

  it("Holidays header: Add holiday and Back are the same size, as New ATC", () => {
    const s = buttonSizes(renderToStaticMarkup(createElement(HolidaysHeader)));
    expect(s["Add holiday"]).toBe(standard);
    expect(s["Back"]).toBe(standard);
  });

  it("Payors header: Add payor and Back to client are the same size", () => {
    const s = buttonSizes(
      renderToStaticMarkup(createElement(PayorsHeader, { title: "Payors", clientId: "c1", atcCodes: [], action: noopAction })),
    );
    expect(s["Add payor"]).toBe(standard);
    expect(s["Back to client"]).toBe(standard);
  });

  it("form pairs: submit and Cancel are the same size, in every form", () => {
    const forms: Array<[string, string, string]> = [
      ["New ATC", renderToStaticMarkup(createElement(AtcCodeForm, { action: noopAction, submitLabel: "Create ATC", cancelHref: "/x" })), "Create ATC"],
      ["rule set", renderToStaticMarkup(createElement(TaxRuleSetForm, { action: noopAction, submitLabel: "Create rule set", cancelHref: "/x" })), "Create rule set"],
      ["client", renderToStaticMarkup(createElement(ClientForm, { action: noopAction, submitLabel: "Create client", cancelHref: "/x" })), "Create client"],
      ["payor", renderToStaticMarkup(createElement(PayorForm, { action: noopAction, atcCodes: [], submitLabel: "Save", onCancel: () => {} })), "Save"],
      ["holiday", renderToStaticMarkup(createElement(HolidayForm, { onCancel: () => {} })), "Save"],
    ];
    for (const [name, html, submit] of forms) {
      const s = buttonSizes(html);
      expect(s[submit], `${name} submit`).toBe(standard);
      expect(s["Cancel"], `${name} Cancel`).toBe(standard);
    }
  });
});

describe("Primary and bordered buttons have the same box (D174)", () => {
  const classesOf = (variant: "primary" | "secondary") =>
    (/class="([^"]*)"/.exec(renderToStaticMarkup(createElement(Button, { variant }, "x")))?.[1] ?? "").split(/\s+/);

  it("same height, padding, font size, weight, line height and corners", () => {
    const pick = (c: string[]) =>
      c.filter((x) => /^(h-|px-|py-|text-(xs|sm|base)|font-|leading-|rounded)/.test(x)).sort().join(" ");
    expect(pick(classesOf("secondary"))).toBe(pick(classesOf("primary")));
  });

  it("the bordered button's edge is the visible neutral token, not the pale line colour", () => {
    const c = classesOf("secondary");
    expect(c).toContain("border");
    expect(c).toContain("border-button-edge");
    expect(c).not.toContain("border-line");
  });

  it("the token exists in globals.css and is darker than the page lines", async () => {
    const css = (await import("node:fs")).readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/--button-edge:\s*#[0-9a-f]{6}/i);
    expect(css).toMatch(/--color-button-edge:\s*var\(--button-edge\)/);
  });
});
