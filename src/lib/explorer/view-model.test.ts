import { describe, expect, it } from "vitest";

import type { LegalAnswerResult, ResolvedSourceReference } from "@/lib/legal/answer/answer";
import type { PackedSource } from "@/lib/legal/answer/packing";
import { toExplorerAnswerView } from "./view-model";

function sourceRef(overrides: Partial<ResolvedSourceReference> = {}): ResolvedSourceReference {
  return {
    legalProvisionId: "p1",
    legalActVersionId: "v1",
    legalActId: "a1",
    actTitle: "Ustawa testowa",
    citationLabel: "art. 1",
    versionKind: "promulgated",
    authorityClass: "authoritative",
    currentnessStatus: "unproven",
    sourceExpressionId: "ogl",
    ...overrides,
  };
}

function packedSource(overrides: Partial<PackedSource> = {}): PackedSource {
  return {
    sourceId: "SOURCE_1",
    legalProvisionId: "p1",
    legalActVersionId: "v1",
    legalActId: "a1",
    actTitle: "Ustawa testowa",
    citationLabel: "art. 1",
    text: "Art. 1. Treść przepisu.",
    hierarchy: ["Dział I"],
    versionKind: "promulgated",
    authorityClass: "authoritative",
    currentnessStatus: "unproven",
    sourceExpressionId: "ogl",
    ...overrides,
  };
}

function baseResult(overrides: Partial<LegalAnswerResult> = {}): LegalAnswerResult {
  return {
    status: "answered",
    problemDescription: "opis problemu",
    legalActVersionIds: ["v1"],
    answer: "Odpowiedź.",
    conclusions: [],
    alternativePaths: [],
    uncertainties: [],
    clarificationQuestion: null,
    sources: [],
    ...overrides,
  };
}

describe("toExplorerAnswerView", () => {
  it("maps status, answer, uncertainties, and clarificationQuestion straight through", () => {
    const view = toExplorerAnswerView(
      baseResult({
        status: "insufficient_evidence",
        answer: "Brak wystarczających podstaw.",
        uncertainties: ["coś jest niepewne"],
        clarificationQuestion: "Czy masz umowę na piśmie?",
      }),
    );

    expect(view.status).toBe("insufficient_evidence");
    expect(view.answer).toBe("Brak wystarczających podstaw.");
    expect(view.uncertainties).toEqual(["coś jest niepewne"]);
    expect(view.clarificationQuestion).toBe("Czy masz umowę na piśmie?");
  });

  it("includes only sources that are actually cited by a conclusion or alternative path", () => {
    const cited = packedSource({ legalProvisionId: "cited", citationLabel: "art. 471" });
    const uncited = packedSource({ legalProvisionId: "uncited", citationLabel: "art. 999" });

    const view = toExplorerAnswerView(
      baseResult({
        conclusions: [{ statement: "Teza.", support: [sourceRef({ legalProvisionId: "cited", citationLabel: "art. 471" })] }],
        sources: [cited, uncited],
      }),
    );

    expect(view.citedSources).toHaveLength(1);
    expect(view.citedSources[0].citationLabel).toBe("art. 471");
  });

  it("includes sources cited only via an alternative path, not just conclusions", () => {
    const cited = packedSource({ legalProvisionId: "cited-via-path", citationLabel: "art. 12" });

    const view = toExplorerAnswerView(
      baseResult({
        alternativePaths: [
          {
            issueLabel: "kwestia",
            explanation: "wyjaśnienie",
            support: [sourceRef({ legalProvisionId: "cited-via-path", citationLabel: "art. 12" })],
          },
        ],
        sources: [cited],
      }),
    );

    expect(view.citedSources).toHaveLength(1);
    expect(view.citedSources[0].citationLabel).toBe("art. 12");
  });

  it("marks non-authoritative sources and unproven-currentness sources with warning flags", () => {
    const nonAuthoritative = packedSource({
      legalProvisionId: "p-non-auth",
      authorityClass: "non_authoritative",
      currentnessStatus: "unproven",
    });

    const view = toExplorerAnswerView(
      baseResult({
        conclusions: [{ statement: "Teza.", support: [sourceRef({ legalProvisionId: "p-non-auth", authorityClass: "non_authoritative" })] }],
        sources: [nonAuthoritative],
      }),
    );

    expect(view.citedSources[0].isNonAuthoritative).toBe(true);
    expect(view.citedSources[0].isCurrentnessUnproven).toBe(true);
  });

  it("does not mark a proven-current, authoritative source with any warning flag", () => {
    const clean = packedSource({
      legalProvisionId: "p-clean",
      authorityClass: "authoritative",
      currentnessStatus: "proven_current",
    });

    const view = toExplorerAnswerView(
      baseResult({
        conclusions: [
          {
            statement: "Teza.",
            support: [sourceRef({ legalProvisionId: "p-clean", authorityClass: "authoritative", currentnessStatus: "proven_current" })],
          },
        ],
        sources: [clean],
      }),
    );

    expect(view.citedSources[0].isNonAuthoritative).toBe(false);
    expect(view.citedSources[0].isCurrentnessUnproven).toBe(false);
  });

  it("never exposes internal implementation fields (sourceId, legalProvisionId, versionKind, etc.) on cited sources", () => {
    const view = toExplorerAnswerView(
      baseResult({
        conclusions: [{ statement: "Teza.", support: [sourceRef()] }],
        sources: [packedSource()],
      }),
    );

    const keys = Object.keys(view.citedSources[0]);
    expect(keys.sort()).toEqual(["actTitle", "citationLabel", "isCurrentnessUnproven", "isNonAuthoritative", "text"].sort());
  });

  it("maps conclusions and alternative paths to their citation labels only (no internal SOURCE_X ids)", () => {
    const view = toExplorerAnswerView(
      baseResult({
        conclusions: [{ statement: "Dłużnik odpowiada.", support: [sourceRef({ citationLabel: "art. 471" })] }],
        alternativePaths: [{ issueLabel: "kwestia", explanation: "wyjaśnienie", support: [] }],
        sources: [packedSource({ citationLabel: "art. 471" })],
      }),
    );

    expect(view.conclusions).toEqual([{ statement: "Dłużnik odpowiada.", citationLabels: ["art. 471"] }]);
    expect(view.alternativePaths).toEqual([{ issueLabel: "kwestia", explanation: "wyjaśnienie", citationLabels: [] }]);
  });
});
