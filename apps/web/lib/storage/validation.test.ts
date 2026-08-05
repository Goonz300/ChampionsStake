import { describe, expect, it } from "vitest";
import {
  sanitizeFilename,
  computeChecksum,
  validateUpload,
  FileValidationError,
} from "./validation";

describe("sanitizeFilename", () => {
  it("strips path separators (path traversal prevention)", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\config")).toBe("config");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeFilename("my photo!@#.png")).toBe("my_photo_.png");
  });

  it("collapses repeated underscores", () => {
    expect(sanitizeFilename("a   b.png")).toBe("a_b.png");
  });

  it("caps length at 200 characters", () => {
    const result = sanitizeFilename("a".repeat(500) + ".png");
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("falls back to 'unnamed' for an empty/unsafe-only input", () => {
    expect(sanitizeFilename("///")).toBe("unnamed");
  });
});

describe("computeChecksum", () => {
  it("produces a stable sha256 hex digest", () => {
    const buffer = new TextEncoder().encode("hello world");
    const a = computeChecksum(buffer);
    const b = computeChecksum(buffer);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different checksums for different content", () => {
    const a = computeChecksum(new TextEncoder().encode("hello"));
    const b = computeChecksum(new TextEncoder().encode("world"));
    expect(a).not.toBe(b);
  });
});

describe("validateUpload", () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0]);

  it("accepts a valid PNG for the avatars bucket", () => {
    expect(() =>
      validateUpload({
        bucket: "avatars",
        mimeType: "image/png",
        sizeBytes: pngBytes.length,
        buffer: pngBytes,
      }),
    ).not.toThrow();
  });

  it("rejects a disallowed MIME type for the bucket", () => {
    expect(() =>
      validateUpload({
        bucket: "avatars",
        mimeType: "video/mp4",
        sizeBytes: 1000,
        buffer: new Uint8Array(10),
      }),
    ).toThrow(FileValidationError);
  });

  it("rejects a file exceeding the bucket's size limit", () => {
    expect(() =>
      validateUpload({
        bucket: "avatars",
        mimeType: "image/png",
        sizeBytes: 999_999_999,
        buffer: pngBytes,
      }),
    ).toThrow(/exceeds/);
  });

  it("rejects an empty file", () => {
    expect(() =>
      validateUpload({
        bucket: "avatars",
        mimeType: "image/png",
        sizeBytes: 0,
        buffer: new Uint8Array(0),
      }),
    ).toThrow(/empty/);
  });

  it("rejects content whose magic bytes don't match the declared MIME type", () => {
    // Declaring PNG but supplying JPEG bytes — the "renamed file" attack.
    expect(() =>
      validateUpload({
        bucket: "avatars",
        mimeType: "image/png",
        sizeBytes: jpegBytes.length,
        buffer: jpegBytes,
      }),
    ).toThrow(/signature check/);
  });

  it("accepts a valid JPEG matching its declared type", () => {
    expect(() =>
      validateUpload({
        bucket: "proof-images",
        mimeType: "image/jpeg",
        sizeBytes: jpegBytes.length,
        buffer: jpegBytes,
      }),
    ).not.toThrow();
  });

  it("skips the magic-byte check for MIME types with no registered signature", () => {
    // image/svg+xml has no signature entry — should not throw for that reason.
    expect(() =>
      validateUpload({
        bucket: "system-assets",
        mimeType: "image/svg+xml",
        sizeBytes: 100,
        buffer: new TextEncoder().encode("<svg></svg>"),
      }),
    ).not.toThrow();
  });
});
