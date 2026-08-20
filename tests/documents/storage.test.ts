import { describe, it, expect } from "vitest";
import { buildStorageRelativePath, computeSha256 } from "@/lib/documents/storage";

describe("buildStorageRelativePath", () => {
  it("matches the exact SPEC.md §8 naming convention", () => {
    // Example from SPEC.md §8:
    // /storage/dela-cruz-j/2026/Q2/SAVE_PROOF_PAYMENT__proof__20260812__01.pdf
    const result = buildStorageRelativePath({
      clientCode: "dela-cruz-j",
      taxableYear: 2026,
      period: "Q2",
      stepCode: "SAVE_PROOF_PAYMENT",
      slotCode: "proof",
      documentDate: new Date("2026-08-12T00:00:00.000Z"),
      seq: 1,
      ext: "pdf",
    });
    expect(result).toBe("dela-cruz-j/2026/Q2/SAVE_PROOF_PAYMENT__proof__20260812__01.pdf");
  });

  it("pads the sequence number to two digits", () => {
    const result = buildStorageRelativePath({
      clientCode: "santos-m",
      taxableYear: 2026,
      period: "Q1",
      stepCode: "RECEIVE_2307",
      slotCode: "form2307_scan",
      documentDate: new Date("2026-01-05T00:00:00.000Z"),
      seq: 3,
      ext: "jpg",
    });
    expect(result).toContain("__03.jpg");
  });

  it("formats documentDate in Asia/Manila, not UTC", () => {
    // 2026-01-01T23:00:00Z is already 2026-01-02 in Manila (UTC+8).
    const result = buildStorageRelativePath({
      clientCode: "reyes-p",
      taxableYear: 2026,
      period: "Q1",
      stepCode: "RECEIVE_TRRC",
      slotCode: "trrc",
      documentDate: new Date("2026-01-01T23:00:00.000Z"),
      seq: 1,
      ext: "pdf",
    });
    expect(result).toContain("__20260102__");
  });
});

describe("computeSha256", () => {
  it("is deterministic for identical content", () => {
    const a = computeSha256(Buffer.from("hello world"));
    const b = computeSha256(Buffer.from("hello world"));
    expect(a).toBe(b);
  });

  it("differs for different content", () => {
    const a = computeSha256(Buffer.from("hello world"));
    const b = computeSha256(Buffer.from("hello world!"));
    expect(a).not.toBe(b);
  });

  it("matches a known SHA-256 vector", () => {
    // echo -n "" | sha256sum
    expect(computeSha256(Buffer.from(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
