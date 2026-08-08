import type {
  CurrentnessStatus,
  EliActMetadata,
  ExpressionAuthorityClass,
  LegalActVersionKind,
  OfficialEliExpressionId,
} from "./schema";

const ELI_CANONICAL_BASE_URL = "https://eli.gov.pl/eli";
const DEFAULT_TIMEOUT_MS = 8_000;

const OFFICIAL_EXPRESSION_IDS: OfficialEliExpressionId[] = ["ogl", "tj", "uj"];

const expressionKindMap: Record<OfficialEliExpressionId, LegalActVersionKind> = {
  ogl: "promulgated",
  tj: "consolidated",
  uj: "unified",
};

export interface DiscoveredOfficialExpression {
  sourceExpressionId: OfficialEliExpressionId;
  canonicalEliUri: string;
  versionKind: LegalActVersionKind;
  evidence: string;
}

export interface ExpressionCandidate {
  sourceExpressionId: string;
  versionKind: LegalActVersionKind;
  canonicalEliUri: string | null;
  evidence?: string;
  authorityClass: ExpressionAuthorityClass;
  nonAuthoritative: boolean;
  currentnessStatus: CurrentnessStatus;
}

export interface ExpressionSelectionResult {
  retrievalVersion: ExpressionCandidate | null;
  authoritativeVersion: ExpressionCandidate | null;
  retrievalReason: string;
  authorityReason: string;
  warnings: string[];
}

export interface DiscoverOfficialExpressionsOptions {
  checkUriAvailability?: (url: string) => Promise<boolean>;
}

export interface CheckCanonicalEliUriOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function resolveActEliId(metadata: EliActMetadata): string {
  return metadata.ELI ?? `${metadata.publisher}/${metadata.year}/${metadata.pos}`;
}

export function buildCanonicalEliExpressionUri(
  metadata: EliActMetadata,
  expressionId: OfficialEliExpressionId,
): string {
  const actEliId = resolveActEliId(metadata);
  return `${ELI_CANONICAL_BASE_URL}/${actEliId}/${expressionId}`;
}

export async function checkCanonicalEliUriAvailability(
  url: string,
  options: CheckCanonicalEliUriOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const requestInit: RequestInit = {
    headers: {
      "User-Agent": "Velantis-Legal-Explorer/0.1 (+https://velantis.local)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  };

  const headResponse = await fetchImpl(url, {
    ...requestInit,
    method: "HEAD",
  });

  if (headResponse.ok) {
    return true;
  }

  if (headResponse.status === 405 || headResponse.status === 501) {
    const getResponse = await fetchImpl(url, {
      ...requestInit,
      method: "GET",
    });

    return getResponse.ok;
  }

  return false;
}

export async function discoverOfficialExpressions(
  metadata: EliActMetadata,
  options: DiscoverOfficialExpressionsOptions = {},
): Promise<DiscoveredOfficialExpression[]> {
  const checkUriAvailability = options.checkUriAvailability ?? checkCanonicalEliUriAvailability;

  const discovered: DiscoveredOfficialExpression[] = [];

  for (const expressionId of OFFICIAL_EXPRESSION_IDS) {
    const canonicalEliUri = buildCanonicalEliExpressionUri(metadata, expressionId);
    const isAvailable = await checkUriAvailability(canonicalEliUri);

    if (!isAvailable) {
      continue;
    }

    discovered.push({
      sourceExpressionId: expressionId,
      canonicalEliUri,
      versionKind: expressionKindMap[expressionId],
      evidence: `canonical_eli_uri_available:${canonicalEliUri}`,
    });
  }

  return discovered;
}

export function classifyExpressionAuthority(versionKind: LegalActVersionKind): ExpressionAuthorityClass {
  if (versionKind === "unified") {
    return "non_authoritative";
  }

  if (versionKind === "consolidated" || versionKind === "promulgated") {
    return "authoritative";
  }

  return "unknown";
}

export function toExpressionCandidate(
  expression: {
    sourceExpressionId: string;
    versionKind: LegalActVersionKind;
    canonicalEliUri: string | null;
    evidence?: string;
  },
  currentnessStatus: CurrentnessStatus = "unproven",
): ExpressionCandidate {
  const authorityClass = classifyExpressionAuthority(expression.versionKind);

  return {
    sourceExpressionId: expression.sourceExpressionId,
    versionKind: expression.versionKind,
    canonicalEliUri: expression.canonicalEliUri,
    evidence: expression.evidence,
    authorityClass,
    nonAuthoritative: authorityClass === "non_authoritative",
    currentnessStatus,
  };
}

export function chooseExpressionSelection(
  candidates: ReadonlyArray<ExpressionCandidate>,
): ExpressionSelectionResult {
  const warnings: string[] = [];

  const unified = candidates.find((candidate) => candidate.versionKind === "unified");
  const consolidated = candidates.find((candidate) => candidate.versionKind === "consolidated");
  const promulgated = candidates.find((candidate) => candidate.versionKind === "promulgated");

  const retrievalVersion = unified ?? consolidated ?? promulgated ?? null;
  const authoritativeVersion = consolidated ?? promulgated ?? null;

  if (retrievalVersion?.versionKind === "unified") {
    warnings.push("UJ is non-authoritative: tekst ujednolicony bez mocy prawnej.");
  }

  if (retrievalVersion && retrievalVersion.currentnessStatus !== "proven_current") {
    warnings.push("Currentness is unproven: URL reachability alone does not prove current legal state.");
  }

  if (!authoritativeVersion && unified) {
    warnings.push("UJ cannot be used as authoritative citation source.");
  }

  const retrievalReason = unified
    ? "Retrieval preference uses UJ readability, with explicit non-authoritative semantics."
    : consolidated
      ? "Retrieval preference uses TJ when UJ is unavailable."
      : promulgated
        ? "Retrieval preference falls back to OGL when TJ/UJ are unavailable."
        : "No official OGL/TJ/UJ expressions discovered for retrieval.";

  const authorityReason = consolidated
    ? "Authoritative citation prefers TJ as official consolidated text."
    : promulgated
      ? "Authoritative citation falls back to OGL as promulgated text."
      : "No authoritative OGL/TJ expression discovered.";

  return {
    retrievalVersion,
    authoritativeVersion,
    retrievalReason,
    authorityReason,
    warnings,
  };
}

export function choosePreferredCurrentExpression(
  expressions: ReadonlyArray<{
    sourceExpressionId: string;
    versionKind: LegalActVersionKind;
    canonicalEliUri: string | null;
    evidence?: string;
  }>,
): ExpressionSelectionResult {
  const candidates = expressions.map((expression) => toExpressionCandidate(expression, "unproven"));
  return chooseExpressionSelection(candidates);
}
