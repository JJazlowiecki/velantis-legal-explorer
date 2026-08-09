import { describe, expect, it } from "vitest";

import { buildStructureTree } from "./structure-tree";
import type { LegalActStructureNode } from "./service";

function node(overrides: Partial<LegalActStructureNode> & Pick<LegalActStructureNode, "id" | "ordinal">): LegalActStructureNode {
  return {
    parentProvisionId: null,
    provisionType: "article",
    citationLabel: overrides.id,
    heading: null,
    ...overrides,
  };
}

describe("buildStructureTree", () => {
  it("nests children under their parent, preserving input (ordinal) order at each level", () => {
    const flat: LegalActStructureNode[] = [
      node({ id: "root", ordinal: 1, provisionType: "part" }),
      node({ id: "chapter1", ordinal: 2, parentProvisionId: "root", provisionType: "chapter" }),
      node({ id: "art1", ordinal: 3, parentProvisionId: "chapter1" }),
      node({ id: "art2", ordinal: 4, parentProvisionId: "chapter1" }),
      node({ id: "chapter2", ordinal: 5, parentProvisionId: "root", provisionType: "chapter" }),
    ];

    const tree = buildStructureTree(flat);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].children.map((c) => c.id)).toEqual(["chapter1", "chapter2"]);
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual(["art1", "art2"]);
  });

  it("treats a node whose parent is not in the list as a root (e.g. a partial/paginated fetch)", () => {
    const flat: LegalActStructureNode[] = [node({ id: "orphan", ordinal: 1, parentProvisionId: "missing-parent" })];
    const tree = buildStructureTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("orphan");
  });

  it("handles a flat, article-only structure with no containers", () => {
    const flat: LegalActStructureNode[] = [
      node({ id: "art1", ordinal: 1 }),
      node({ id: "art2", ordinal: 2 }),
    ];
    const tree = buildStructureTree(flat);
    expect(tree.map((n) => n.id)).toEqual(["art1", "art2"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("handles a paragraph-based structure (article -> paragraph -> point)", () => {
    const flat: LegalActStructureNode[] = [
      node({ id: "art1", ordinal: 1, provisionType: "article" }),
      node({ id: "para1", ordinal: 2, parentProvisionId: "art1", provisionType: "paragraph" }),
      node({ id: "point1", ordinal: 3, parentProvisionId: "para1", provisionType: "point" }),
    ];
    const tree = buildStructureTree(flat);
    expect(tree[0].children[0].children[0].id).toBe("point1");
  });

  it("returns an empty tree for an empty input", () => {
    expect(buildStructureTree([])).toEqual([]);
  });
});
