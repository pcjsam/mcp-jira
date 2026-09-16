import { describe, expect, it } from "@jest/globals";
import type { IssueLinkType } from "../src/jira.js";
import { describeLinkTypes, resolveLink } from "../src/links.js";

const types: IssueLinkType[] = [
  { id: "10000", name: "Blocks", outward: "blocks", inward: "is blocked by" },
  { id: "10001", name: "Relates", outward: "relates to", inward: "relates to" },
  { id: "10002", name: "Duplicate", outward: "duplicates", inward: "is duplicated by" },
];

describe("resolveLink", () => {
  it("keeps from/to when the outward phrase is used", () => {
    expect(resolveLink(types, "blocks", "A-1", "B-2")).toEqual({ type: types[0], outward: "A-1", inward: "B-2" });
  });

  it("swaps from/to when the inward phrase is used", () => {
    expect(resolveLink(types, "is blocked by", "A-1", "B-2")).toEqual({ type: types[0], outward: "B-2", inward: "A-1" });
  });

  it("treats a bare type name as its outward direction", () => {
    expect(resolveLink(types, "Duplicate", "A-1", "B-2")).toEqual({ type: types[2], outward: "A-1", inward: "B-2" });
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveLink(types, "  IS Blocked By ", "A-1", "B-2")?.outward).toBe("B-2");
    expect(resolveLink(types, "relates TO", "A-1", "B-2")?.type.name).toBe("Relates");
  });

  it("returns undefined on a miss", () => {
    expect(resolveLink(types, "depends on", "A-1", "B-2")).toBeUndefined();
  });
});

describe("describeLinkTypes", () => {
  it("lists one line per type with both phrases", () => {
    expect(describeLinkTypes(types).split("\n")).toEqual([
      '  Blocks: "blocks" / "is blocked by"',
      '  Relates: "relates to" / "relates to"',
      '  Duplicate: "duplicates" / "is duplicated by"',
    ]);
  });

  it("says so when there are none", () => {
    expect(describeLinkTypes([])).toBe("  (none)");
  });
});
