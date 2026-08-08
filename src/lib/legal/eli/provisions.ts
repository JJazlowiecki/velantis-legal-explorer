import { load as loadHtml } from "cheerio";

import type { NormalizedStructureNode } from "./structure";

export interface ExtractedProvisionDraft {
  parentStructuralPath: string | null;
  provisionType: string;
  article: string | null;
  paragraph: string | null;
  point: string | null;
  letter: string | null;
  citationLabel: string;
  heading: string | null;
  text: string;
  structuralPath: string;
  ordinal: number;
  sourceNodeId: string;
  sourceNodeType: string;
  isOperative: boolean;
  isAttachmentBoundary: boolean;
}

export interface ProvisionExtractionStats {
  totalNodes: number;
  systematicNodes: number;
  operativeProvisions: number;
  articleCount: number;
  unresolvedNodeTypes: string[];
  attachmentBoundaryCount: number;
  fallbackUsed: boolean;
  fallbackRequestCount: number;
  fallbackUniqueNodeCount: number;
}

export interface ProvisionExtractionResult {
  provisions: ExtractedProvisionDraft[];
  stats: ProvisionExtractionStats;
}

export class ProvisionExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionExtractionError";
  }
}

export interface ExtractProvisionOptions {
  htmlDocument?: string;
  fetchFragmentHtml?: (treeId: string) => Promise<string>;
  fragmentFallback?: {
    maxRequests: number;
    concurrency: number;
  };
  onNodeProcessed?: (progress: {
    processedNodes: number;
    totalNodes: number;
    extractedProvisions: number;
  }) => void;
  onFallbackRequest?: (progress: {
    requested: number;
    total: number;
    nodeId: string;
  }) => void;
}

type CitationState = {
  article: string | null;
  paragraph: string | null;
  subsection: string | null;
  point: string | null;
  letter: string | null;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function indexNodeTextFromHtml(htmlDocument: string): Map<string, string> {
  const $ = loadHtml(htmlDocument);
  const indexed = new Map<string, string>();

  $("[id]").each((_, element) => {
    const id = $(element).attr("id");
    if (!id || indexed.has(id)) {
      return;
    }

    const clone = $(element).clone();
    clone.find(".unit").remove();
    const text = normalizeWhitespace(clone.text());
    if (text.length > 0) {
      indexed.set(id, text);
    }
  });

  return indexed;
}

function countStructureNodes(roots: readonly NormalizedStructureNode[]): number {
  let count = 0;

  const visit = (node: NormalizedStructureNode) => {
    count += 1;
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return count;
}

function resolveKindSpecificIdentifier(node: NormalizedStructureNode): string | null {
  if (node.name?.trim()) {
    return node.name.trim();
  }

  const title = node.title?.trim() || "";

  if (node.kind === "article") {
    return title.match(/Art\.?\s*([0-9A-Za-z()\-./]+)/i)?.[1] ?? null;
  }

  if (node.kind === "paragraph") {
    return title.match(/§\s*([0-9A-Za-z()\-./]+)/i)?.[1] ?? null;
  }

  if (node.kind === "subsection") {
    return title.match(/ust\.?\s*([0-9A-Za-z()\-./]+)/i)?.[1] ?? null;
  }

  if (node.kind === "point") {
    return title.match(/pkt\.?\s*([0-9A-Za-z()\-./]+)/i)?.[1] ?? title.match(/^([0-9A-Za-z()\-./]+)\)/)?.[1] ?? null;
  }

  if (node.kind === "letter") {
    return title.match(/lit\.?\s*([A-Za-z])/i)?.[1] ?? title.match(/^([A-Za-z])\)/)?.[1] ?? null;
  }

  if (node.kind === "dash") {
    return title.match(/tiret\s*([0-9A-Za-z()\-./]+)/i)?.[1] ?? node.symbol ?? null;
  }

  return null;
}

function buildCitationLabel(node: NormalizedStructureNode, citationState: CitationState): string {
  if (!node.isOperative) {
    return node.title ?? `${node.sourceType}:${node.id}`;
  }

  const identifier = resolveKindSpecificIdentifier(node);

  if (node.kind === "article") {
    return identifier ? `art. ${identifier}` : node.title ?? node.id;
  }

  if (node.kind === "paragraph") {
    if (citationState.article && identifier) {
      return `art. ${citationState.article} § ${identifier}`;
    }

    return identifier ? `§ ${identifier}` : node.title ?? node.id;
  }

  if (node.kind === "subsection") {
    if (citationState.article && identifier) {
      return `art. ${citationState.article} ust. ${identifier}`;
    }

    if (citationState.paragraph && identifier) {
      return `§ ${citationState.paragraph} ust. ${identifier}`;
    }

    return identifier ? `ust. ${identifier}` : node.title ?? node.id;
  }

  if (node.kind === "point") {
    const base = citationState.article
      ? citationState.paragraph
        ? `art. ${citationState.article} § ${citationState.paragraph}`
        : `art. ${citationState.article}`
      : citationState.paragraph
        ? `§ ${citationState.paragraph}`
        : "";

    if (base && citationState.subsection) {
      return identifier ? `${base} ust. ${citationState.subsection} pkt ${identifier}` : `${base} ust. ${citationState.subsection}`;
    }

    if (base) {
      return identifier ? `${base} pkt ${identifier}` : base;
    }

    return identifier ? `pkt ${identifier}` : node.title ?? node.id;
  }

  if (node.kind === "letter") {
    const base = citationState.article
      ? citationState.paragraph
        ? `art. ${citationState.article} § ${citationState.paragraph}`
        : `art. ${citationState.article}`
      : citationState.paragraph
        ? `§ ${citationState.paragraph}`
        : "";

    if (base && citationState.subsection && citationState.point) {
      return identifier
        ? `${base} ust. ${citationState.subsection} pkt ${citationState.point} lit. ${identifier}`
        : `${base} ust. ${citationState.subsection} pkt ${citationState.point}`;
    }

    if (base && citationState.point) {
      return identifier ? `${base} pkt ${citationState.point} lit. ${identifier}` : `${base} pkt ${citationState.point}`;
    }

    return identifier ? `lit. ${identifier}` : node.title ?? node.id;
  }

  if (node.kind === "dash") {
    const base = citationState.article
      ? citationState.paragraph
        ? `art. ${citationState.article} § ${citationState.paragraph}`
        : `art. ${citationState.article}`
      : citationState.paragraph
        ? `§ ${citationState.paragraph}`
        : "";

    return base ? `${base} tiret` : (node.title ?? node.id);
  }

  return node.title ?? node.id;
}

function withUpdatedCitationState(node: NormalizedStructureNode, state: CitationState): CitationState {
  const next = { ...state };
  const identifier = resolveKindSpecificIdentifier(node);

  if (node.kind === "article") {
    next.article = identifier;
    next.paragraph = null;
    next.subsection = null;
    next.point = null;
    next.letter = null;
  }

  if (node.kind === "paragraph") {
    next.paragraph = identifier;
    next.subsection = null;
    next.point = null;
    next.letter = null;
  }

  if (node.kind === "subsection") {
    next.subsection = identifier;
    next.point = null;
    next.letter = null;
  }

  if (node.kind === "point") {
    next.point = identifier;
    next.letter = null;
  }

  if (node.kind === "letter") {
    next.letter = identifier;
  }

  return next;
}

function resolveProvisionType(node: NormalizedStructureNode): string {
  if (node.kind !== "unknown") {
    return node.kind;
  }

  return `unknown:${node.sourceType}`;
}

function createEmptyCitationState(): CitationState {
  return {
    article: null,
    paragraph: null,
    subsection: null,
    point: null,
    letter: null,
  };
}

async function fetchFragmentTexts(
  nodeIds: readonly string[],
  options: ExtractProvisionOptions,
): Promise<{ textByNodeId: Map<string, string>; requestCount: number; uniqueCount: number }> {
  if (!options.fetchFragmentHtml) {
    return {
      textByNodeId: new Map(),
      requestCount: 0,
      uniqueCount: 0,
    };
  }

  const fallbackConfig = options.fragmentFallback;
  if (!fallbackConfig || fallbackConfig.maxRequests <= 0) {
    return {
      textByNodeId: new Map(),
      requestCount: 0,
      uniqueCount: 0,
    };
  }

  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.length > fallbackConfig.maxRequests) {
    throw new ProvisionExtractionError(
      `Fragment fallback request limit exceeded: required ${uniqueNodeIds.length}, max ${fallbackConfig.maxRequests}`,
    );
  }

  const textByNodeId = new Map<string, string>();
  const concurrency = Math.max(1, Math.min(4, fallbackConfig.concurrency));
  let nextIndex = 0;
  let requestCount = 0;

  const worker = async () => {
    while (nextIndex < uniqueNodeIds.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const nodeId = uniqueNodeIds[currentIndex];
      requestCount += 1;
      options.onFallbackRequest?.({
        requested: requestCount,
        total: uniqueNodeIds.length,
        nodeId,
      });

      const fragmentHtml = await options.fetchFragmentHtml!(nodeId);
      if (fragmentHtml.trim().length === 0) {
        continue;
      }

      const text = normalizeWhitespace(loadHtml(fragmentHtml).text());
      if (text.length > 0) {
        textByNodeId.set(nodeId, text);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueNodeIds.length) }, () => worker()));

  return {
    textByNodeId,
    requestCount,
    uniqueCount: uniqueNodeIds.length,
  };
}

export async function extractProvisionDraftsFromStructure(
  roots: readonly NormalizedStructureNode[],
  options: ExtractProvisionOptions = {},
): Promise<ProvisionExtractionResult> {
  const totalNodes = countStructureNodes(roots);
  const provisions: ExtractedProvisionDraft[] = [];
  const unresolvedNodeTypes = new Set<string>();
  let systematicNodes = 0;
  let operativeProvisions = 0;
  let articleCount = 0;
  let attachmentBoundaryCount = 0;
  let processedNodes = 0;
  const missingOperativeTextNodes: string[] = [];

  let ordinal = 1;
  const indexedHtmlText = options.htmlDocument ? indexNodeTextFromHtml(options.htmlDocument) : new Map();

  const visit = async (
    node: NormalizedStructureNode,
    ancestry: readonly string[],
    parentStructuralPath: string | null,
    citationState: CitationState,
    nodePathSegment: string,
  ): Promise<void> => {
    if (!node.isOperative) {
      systematicNodes += 1;
    } else {
      operativeProvisions += 1;
    }

    if (node.kind === "article") {
      articleCount += 1;
    }

    if (node.isAttachmentBoundary) {
      attachmentBoundaryCount += 1;
    }

    if (node.kind === "unknown") {
      unresolvedNodeTypes.add(node.sourceType);
    }

    const structuralPath = [...ancestry, nodePathSegment].join("/");
    const nextCitationState = withUpdatedCitationState(node, citationState);

    const citationLabel = buildCitationLabel(node, nextCitationState);
    let text = indexedHtmlText.get(node.id) ?? "";

    if (!text) {
      if (node.isOperative) {
        missingOperativeTextNodes.push(node.id);
      } else {
        text = node.title ?? node.name ?? node.symbol ?? node.id;
      }
    }

    provisions.push({
      parentStructuralPath,
      provisionType: resolveProvisionType(node),
      article: nextCitationState.article,
      paragraph: nextCitationState.paragraph,
      point: nextCitationState.point,
      letter: nextCitationState.letter,
      citationLabel,
      heading: node.title,
      text,
      structuralPath,
      ordinal,
      sourceNodeId: node.id,
      sourceNodeType: node.sourceType,
      isOperative: node.isOperative,
      isAttachmentBoundary: node.isAttachmentBoundary,
    });

    ordinal += 1;
    processedNodes += 1;
    options.onNodeProcessed?.({
      processedNodes,
      totalNodes,
      extractedProvisions: provisions.length,
    });

    let siblingCitationState = nextCitationState;
    const siblingIdOccurrences = new Map<string, number>();

    for (const child of node.children) {
      const nextOccurrence = (siblingIdOccurrences.get(child.id) ?? 0) + 1;
      siblingIdOccurrences.set(child.id, nextOccurrence);

      const childPathSegment = nextOccurrence > 1 ? `${child.id}~${nextOccurrence}` : child.id;

      await visit(
        child,
        [...ancestry, nodePathSegment],
        structuralPath,
        siblingCitationState,
        childPathSegment,
      );
      siblingCitationState = withUpdatedCitationState(child, siblingCitationState);
    }
  };

  const rootIdOccurrences = new Map<string, number>();

  for (const root of roots) {
    const nextOccurrence = (rootIdOccurrences.get(root.id) ?? 0) + 1;
    rootIdOccurrences.set(root.id, nextOccurrence);

    const rootPathSegment = nextOccurrence > 1 ? `${root.id}~${nextOccurrence}` : root.id;

    await visit(root, [], null, createEmptyCitationState(), rootPathSegment);
  }

  let fallbackRequestCount = 0;
  let fallbackUniqueNodeCount = 0;

  if (missingOperativeTextNodes.length > 0) {
    const fallback = await fetchFragmentTexts(missingOperativeTextNodes, options);
    fallbackRequestCount = fallback.requestCount;
    fallbackUniqueNodeCount = fallback.uniqueCount;

    for (const provision of provisions) {
      if (!provision.isOperative || provision.text.length > 0) {
        continue;
      }

      const fallbackText = fallback.textByNodeId.get(provision.sourceNodeId);
      if (fallbackText) {
        provision.text = fallbackText;
      }
    }

    const unresolved = provisions.find((provision) => provision.isOperative && provision.text.length === 0);
    if (unresolved) {
      throw new ProvisionExtractionError(
        `Missing reliable provision text for operative node ${unresolved.sourceNodeId} (${unresolved.sourceNodeType})`,
      );
    }
  }

  return {
    provisions,
    stats: {
      totalNodes,
      systematicNodes,
      operativeProvisions,
      articleCount,
      unresolvedNodeTypes: [...unresolvedNodeTypes].sort(),
      attachmentBoundaryCount,
      fallbackUsed: fallbackRequestCount > 0,
      fallbackRequestCount,
      fallbackUniqueNodeCount,
    },
  };
}
