import type { EliStructNode } from "./schema";

export type StructureNodeKind =
  | "part"
  | "appendix"
  | "book"
  | "title"
  | "division"
  | "chapter"
  | "section"
  | "article"
  | "paragraph"
  | "subsection"
  | "point"
  | "letter"
  | "dash"
  | "unknown";

export interface NormalizedStructureNode {
  id: string;
  sourceType: string;
  kind: StructureNodeKind;
  symbol: string | null;
  name: string | null;
  title: string | null;
  children: NormalizedStructureNode[];
  isOperative: boolean;
  isAttachmentBoundary: boolean;
}

const NODE_KIND_BY_SOURCE_TYPE: Array<{ pattern: RegExp; kind: StructureNodeKind }> = [
  { pattern: /^(part|czesc)$/i, kind: "part" },
  { pattern: /^(appendix|attachment|annex|zalacznik|załącznik|appa|atta)$/i, kind: "appendix" },
  { pattern: /^(book|ksiega|księga)$/i, kind: "book" },
  { pattern: /^(titl|title|tytul|tytuł)$/i, kind: "title" },
  { pattern: /^(bran|division|dzial|dział)$/i, kind: "division" },
  { pattern: /^(chpt|chapter|rozdzial|rozdział)$/i, kind: "chapter" },
  { pattern: /^(sect|section|oddzial|oddział)$/i, kind: "section" },
  { pattern: /^(arti|article|art)$/i, kind: "article" },
  { pattern: /^(para|paragraph|paragraf)$/i, kind: "paragraph" },
  { pattern: /^(ustp|subsection|ust)$/i, kind: "subsection" },
  { pattern: /^(pint|point|pkt)$/i, kind: "point" },
  { pattern: /^(litr|lett|letter|lit)$/i, kind: "letter" },
  { pattern: /^(dash|tiret|tiret)$/i, kind: "dash" },
];

const OPERATIVE_KINDS = new Set<StructureNodeKind>([
  "article",
  "paragraph",
  "subsection",
  "point",
  "letter",
  "dash",
]);

function resolveNodeKind(sourceType: string): StructureNodeKind {
  const normalized = sourceType.trim().toLowerCase();

  for (const mapping of NODE_KIND_BY_SOURCE_TYPE) {
    if (mapping.pattern.test(normalized)) {
      return mapping.kind;
    }
  }

  return "unknown";
}

function isAttachmentBoundary(kind: StructureNodeKind, title: string | null): boolean {
  if (kind === "appendix") {
    return true;
  }

  if (!title) {
    return false;
  }

  return /załącznik|zalacznik|annex|attachment/i.test(title);
}

function normalizeSingleNode(node: EliStructNode): NormalizedStructureNode {
  const sourceType = node.type?.trim() || "unknown";
  const kind = resolveNodeKind(sourceType);
  const title = node.title?.trim() || null;

  const children = (node.children ?? []).map((child) => normalizeSingleNode(child));

  return {
    id: node.id,
    sourceType,
    kind,
    symbol: node.symbol?.trim() || null,
    name: node.name?.trim() || null,
    title,
    children,
    isOperative: OPERATIVE_KINDS.has(kind),
    isAttachmentBoundary: isAttachmentBoundary(kind, title),
  };
}

export function normalizeStructTree(input: readonly EliStructNode[]): NormalizedStructureNode[] {
  return input.map((node) => normalizeSingleNode(node));
}

export interface FlattenedStructureNode {
  node: NormalizedStructureNode;
  parentId: string | null;
  depth: number;
  path: string[];
}

export function flattenStructureNodes(
  roots: readonly NormalizedStructureNode[],
): FlattenedStructureNode[] {
  const flattened: FlattenedStructureNode[] = [];

  const visit = (
    node: NormalizedStructureNode,
    parentId: string | null,
    depth: number,
    path: string[],
  ) => {
    const currentPath = [...path, node.id];

    flattened.push({
      node,
      parentId,
      depth,
      path: currentPath,
    });

    for (const child of node.children) {
      visit(child, node.id, depth + 1, currentPath);
    }
  };

  for (const root of roots) {
    visit(root, null, 0, []);
  }

  return flattened;
}
