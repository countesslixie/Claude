import { describe, it, expect } from "vitest";
import { suggestClientCode } from "@/lib/clients/suggestCode";

describe("suggestClientCode (D147)", () => {
  it("is last word + '-' + first word", () => {
    expect(suggestClientCode("Maria Santos Reyes")).toBe("reyes-maria");
  });
  it("leaves a two-word surname for her to fix by hand", () => {
    expect(suggestClientCode("Juan Dela Cruz")).toBe("cruz-juan");
  });
  it("two words swap", () => {
    expect(suggestClientCode("Ana Lim")).toBe("lim-ana");
  });
  it("strips accents (ñ -> n)", () => {
    expect(suggestClientCode("José Peña")).toBe("pena-jose");
    expect(suggestClientCode("Niño Muñoz")).toBe("munoz-nino");
  });
  it("ignores extra spaces, leading and trailing", () => {
    expect(suggestClientCode("  Maria   Santos    Reyes  ")).toBe("reyes-maria");
  });
  it("removes punctuation from each word", () => {
    expect(suggestClientCode("Ma. Teresa D. Reyes, Jr.")).toBe("jr-ma");
    expect(suggestClientCode("O'Brien-Smith Pat")).toBe("pat-obriensmith");
  });
  it("drops a word that is only punctuation", () => {
    expect(suggestClientCode("Maria - Reyes")).toBe("reyes-maria");
  });
  it("keeps digits", () => {
    expect(suggestClientCode("Studio 54 Co")).toBe("co-studio");
    expect(suggestClientCode("Agent 007")).toBe("007-agent");
  });
  it("one word is that word alone", () => {
    expect(suggestClientCode("Cher")).toBe("cher");
    expect(suggestClientCode("  Cher.  ")).toBe("cher");
  });
  it("empty or blank input is an empty code", () => {
    expect(suggestClientCode("")).toBe("");
    expect(suggestClientCode("   ")).toBe("");
    expect(suggestClientCode("...")).toBe("");
  });
  it("always satisfies the server's code format when non-empty", () => {
    for (const n of ["Maria Santos Reyes", "José Peña", "Ma. Teresa D. Reyes, Jr.", "Cher"]) {
      expect(suggestClientCode(n)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
