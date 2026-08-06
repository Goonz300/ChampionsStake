import { describe, expect, it } from "vitest";
import { mergeById } from "./dedupe";

interface Row {
  id: string;
  created_at: string;
}

describe("mergeById", () => {
  it("appends genuinely new rows", () => {
    const existing: Row[] = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];
    const incoming: Row[] = [{ id: "b", created_at: "2026-01-02T00:00:00Z" }];

    const result = mergeById(existing, incoming);

    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("de-duplicates by id, keeping only one row per id -- the scenario a reconnect resync and a live subscription event both delivering the same row must not double it", () => {
    const existing: Row[] = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];
    const incoming: Row[] = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];

    const result = mergeById(existing, incoming);

    expect(result).toHaveLength(1);
  });

  it("prefers the incoming version of a row over the existing one (e.g. an edited/updated row overwrites the stale copy)", () => {
    const existing: Row[] = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];
    const incoming = [{ id: "a", created_at: "2026-01-01T00:00:00Z", edited: true }];

    const result = mergeById(existing, incoming);

    expect(result[0]).toEqual({ id: "a", created_at: "2026-01-01T00:00:00Z", edited: true });
  });

  it("sorts the merged result newest-first by created_at", () => {
    const existing: Row[] = [
      { id: "old", created_at: "2026-01-01T00:00:00Z" },
      { id: "newest", created_at: "2026-01-03T00:00:00Z" },
    ];
    const incoming: Row[] = [{ id: "middle", created_at: "2026-01-02T00:00:00Z" }];

    const result = mergeById(existing, incoming);

    expect(result.map((r) => r.id)).toEqual(["newest", "middle", "old"]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(mergeById([], [])).toEqual([]);
  });

  it("handles an empty incoming list without altering existing order/content", () => {
    const existing: Row[] = [
      { id: "a", created_at: "2026-01-02T00:00:00Z" },
      { id: "b", created_at: "2026-01-01T00:00:00Z" },
    ];

    const result = mergeById(existing, []);

    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
