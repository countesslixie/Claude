import { describe, it, expect } from "vitest";
import { formatTin } from "@/lib/formatTin";

describe("formatTin (D184)", () => {
  it("dashes 9 digits", () => expect(formatTin("123456789")).toBe("123-456-789"));
  it("dashes 12 digits (TIN + branch)", () => expect(formatTin("123456789000")).toBe("123-456-789-000"));
  it("shows empty and null as empty", () => {
    expect(formatTin("")).toBe("");
    expect(formatTin(null)).toBe("");
    expect(formatTin(undefined)).toBe("");
  });
  it("leaves odd lengths exactly as stored", () => {
    expect(formatTin("12345678")).toBe("12345678");
    expect(formatTin("1234567890")).toBe("1234567890");
  });
  it("leaves an already-dashed value alone", () => expect(formatTin("123-456-789")).toBe("123-456-789"));
  it("leaves non-digits alone", () => {
    expect(formatTin("12345678A")).toBe("12345678A");
    expect(formatTin(" 123456789")).toBe(" 123456789");
  });
});
