import type { LegalActStructureNode } from "./service";

export interface StructureTreeNode extends LegalActStructureNode {
  children: StructureTreeNode[];
}

/** Pure, client-safe: nests the flat (lightweight, textless) structure list by parentProvisionId, preserving source ordinal order at each level. */
export function buildStructureTree(nodes: ReadonlyArray<LegalActStructureNode>): StructureTreeNode[] {
  const byId = new Map<string, StructureTreeNode>(nodes.map((node) => [node.id, { ...node, children: [] }]));
  const roots: StructureTreeNode[] = [];

  for (const node of byId.values()) {
    if (node.parentProvisionId && byId.has(node.parentProvisionId)) {
      byId.get(node.parentProvisionId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
