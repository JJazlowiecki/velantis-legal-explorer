import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/du-1964-93.json";
import {
  buildCanonicalEliExpressionUri,
  chooseExpressionSelection,
  choosePreferredCurrentExpression,
  discoverOfficialExpressions,
  toExpressionCandidate,
} from "./expressions";

describe("ELI expression discovery", () => {
  it("builds canonical expression URI from official ELI id", () => {
    expect(buildCanonicalEliExpressionUri(fixture, "ogl")).toBe("https://eli.gov.pl/eli/DU/1964/93/ogl");
  });

  it("discovers promulgated, consolidated and unified expressions when canonical URIs exist", async () => {
    const discovered = await discoverOfficialExpressions(fixture, {
      checkUriAvailability: async (url: string) =>
        [
          "https://eli.gov.pl/eli/DU/1964/93/ogl",
          "https://eli.gov.pl/eli/DU/1964/93/tj",
          "https://eli.gov.pl/eli/DU/1964/93/uj",
        ].includes(url),
    });

    expect(discovered.map((item) => item.sourceExpressionId)).toEqual(["ogl", "tj", "uj"]);
    expect(discovered.map((item) => item.versionKind)).toEqual([
      "promulgated",
      "consolidated",
      "unified",
    ]);
  });

  it("separates retrieval preference from authoritative citation", () => {
    const selection = choosePreferredCurrentExpression([
      {
        sourceExpressionId: "ogl",
        versionKind: "promulgated",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/ogl",
      },
      {
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/tj",
      },
      {
        sourceExpressionId: "uj",
        versionKind: "unified",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
      },
    ]);

    expect(selection.retrievalVersion?.sourceExpressionId).toBe("uj");
    expect(selection.retrievalVersion?.nonAuthoritative).toBe(true);
    expect(selection.authoritativeVersion?.sourceExpressionId).toBe("tj");
    expect(selection.authoritativeVersion?.nonAuthoritative).toBe(false);
    expect(selection.warnings.some((warning) => warning.includes("non-authoritative"))).toBe(true);
  });

  it("does not treat tj and uj as equivalent authority", () => {
    const selection = choosePreferredCurrentExpression([
      {
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/tj",
      },
      {
        sourceExpressionId: "uj",
        versionKind: "unified",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
      },
    ]);

    expect(selection.retrievalVersion?.sourceExpressionId).toBe("uj");
    expect(selection.authoritativeVersion?.sourceExpressionId).toBe("tj");
  });

  it("falls back to consolidated for retrieval when unified is missing", () => {
    const selection = choosePreferredCurrentExpression([
      {
        sourceExpressionId: "tj",
        versionKind: "consolidated",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/tj",
      },
    ]);

    expect(selection.retrievalVersion?.sourceExpressionId).toBe("tj");
    expect(selection.authoritativeVersion?.sourceExpressionId).toBe("tj");
  });

  it("represents currentness as unproven when only reachability evidence exists", () => {
    const selection = choosePreferredCurrentExpression([
      {
        sourceExpressionId: "uj",
        versionKind: "unified",
        canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
      },
    ]);

    expect(selection.retrievalVersion?.currentnessStatus).toBe("unproven");
    expect(selection.warnings.some((warning) => warning.includes("reachability"))).toBe(true);
  });

  it("keeps UJ non-authoritative in explicit candidate model", () => {
    const selection = chooseExpressionSelection([
      toExpressionCandidate(
        {
          sourceExpressionId: "uj",
          versionKind: "unified",
          canonicalEliUri: "https://eli.gov.pl/eli/DU/1964/93/uj",
        },
        "unproven",
      ),
    ]);

    expect(selection.retrievalVersion?.nonAuthoritative).toBe(true);
    expect(selection.authoritativeVersion).toBeNull();
  });
});
