import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import articleStructFixture from "./__fixtures__/struct-article-based.json";
import paragraphStructFixture from "./__fixtures__/struct-paragraph-based.json";
import { extractProvisionDraftsFromStructure } from "./provisions";
import { normalizeStructTree } from "./structure";

const articleHtmlFixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/text-article-based.html", import.meta.url)),
  "utf8",
);

const paragraphHtmlFixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/text-paragraph-based.html", import.meta.url)),
  "utf8",
);

describe("provision extraction", () => {
  it("extracts article-based hierarchy with deterministic paths and ordinals", async () => {
    const roots = normalizeStructTree(articleStructFixture);
    const result = await extractProvisionDraftsFromStructure(roots, {
      htmlDocument: articleHtmlFixture,
    });

    expect(result.provisions.length).toBeGreaterThan(0);
    expect(result.provisions[0].ordinal).toBe(1);
    expect(result.provisions.every((item, index) => item.ordinal === index + 1)).toBe(true);

    const art1 = result.provisions.find((item) => item.citationLabel === "art. 1");
    expect(art1).toBeDefined();
    expect(art1?.structuralPath).toContain("arti_1");

    const para = result.provisions.find((item) => item.citationLabel === "art. 1 § 1");
    expect(para).toBeDefined();
    expect(para?.parentStructuralPath).toContain("arti_1");

    const point = result.provisions.find((item) => item.citationLabel === "art. 1 § 1 pkt 3");
    expect(point).toBeDefined();

    const letter = result.provisions.find((item) => item.citationLabel === "art. 1 § 1 pkt 3 lit. a");
    expect(letter).toBeDefined();

    expect(result.stats.articleCount).toBeGreaterThanOrEqual(3);
  });

  it("extracts paragraph-based citations without fabricating article level", async () => {
    const roots = normalizeStructTree(paragraphStructFixture);
    const result = await extractProvisionDraftsFromStructure(roots, {
      htmlDocument: paragraphHtmlFixture,
    });

    const par4 = result.provisions.find((item) => item.citationLabel === "§ 4");
    expect(par4).toBeDefined();

    const ust2 = result.provisions.find((item) => item.citationLabel === "§ 4 ust. 2");
    expect(ust2).toBeDefined();

    const pkt3 = result.provisions.find((item) => item.citationLabel === "§ 4 ust. 2 pkt 3");
    expect(pkt3).toBeDefined();
  });

  it("preserves unknown node types and attachment boundaries", async () => {
    const roots = normalizeStructTree(articleStructFixture);
    const result = await extractProvisionDraftsFromStructure(roots, {
      htmlDocument: articleHtmlFixture,
    });

    expect(result.stats.unresolvedNodeTypes).toContain("myst");
    expect(result.stats.attachmentBoundaryCount).toBeGreaterThan(0);

    const attachment = result.provisions.find((item) => item.isAttachmentBoundary);
    expect(attachment).toBeDefined();
    expect(attachment?.provisionType).toBe("appendix");
  });

  it("is deterministic for repeated extraction runs", async () => {
    const roots = normalizeStructTree(articleStructFixture);

    const first = await extractProvisionDraftsFromStructure(roots, {
      htmlDocument: articleHtmlFixture,
    });

    const second = await extractProvisionDraftsFromStructure(roots, {
      htmlDocument: articleHtmlFixture,
    });

    expect(first.provisions.map((item) => item.structuralPath)).toEqual(
      second.provisions.map((item) => item.structuralPath),
    );

    expect(first.provisions.map((item) => item.citationLabel)).toEqual(
      second.provisions.map((item) => item.citationLabel),
    );
  });
});
