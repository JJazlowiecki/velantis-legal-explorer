import { describe, expect, it } from "vitest";

import type { PdfTextLine } from "./extract";
import { PdfAnnexSelectionError, joinLogicalParagraphs, parseConsolidatedPdfText, stripBoilerplateAndFootnotes } from "./structure";

const BODY_FONT = 10;

function line(page: number, text: string, fontSize = BODY_FONT, y = 0): PdfTextLine & { fontSize: number } {
  return { page, y, fontSize, text };
}

const ANNEX_HEADING = "Załącznik do obwieszczenia Marszałka Sejmu Rzeczypospolitej";

function withAnnex(...body: (PdfTextLine & { fontSize: number })[]): (PdfTextLine & { fontSize: number })[] {
  return [line(1, "Dziennik Ustaw – 1 – Poz. 1"), line(1, "2026-01-01"), line(1, ANNEX_HEADING), ...body];
}

describe("parseConsolidatedPdfText", () => {
  it("throws PdfAnnexSelectionError when the annex heading is missing", () => {
    expect(() => parseConsolidatedPdfText([line(1, "Art. 1. Something.")])).toThrow(PdfAnnexSelectionError);
  });

  it("throws PdfAnnexSelectionError when the annex heading appears more than once", () => {
    expect(() =>
      parseConsolidatedPdfText([line(1, ANNEX_HEADING), line(1, "Art. 1. X."), line(1, ANNEX_HEADING)]),
    ).toThrow(PdfAnnexSelectionError);
  });

  it("parses a simple single-line article", () => {
    const result = parseConsolidatedPdfText(withAnnex(line(1, "Art. 1. Kodeks niniejszy reguluje stosunki cywilnoprawne.")));
    const article = result.find((p) => p.provisionType === "article");
    expect(article?.citationLabel).toBe("art. 1");
    expect(article?.article).toBe("1");
    expect(article?.text).toBe("Art. 1. Kodeks niniejszy reguluje stosunki cywilnoprawne.");
  });

  it("nests § clauses under their article with fully-qualified citation labels", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(
        line(1, "Art. 8. § 1. Każdy człowiek od chwili urodzenia ma zdolność prawną."),
        line(1, "§ 2. Przepis nie stosuje się."),
      ),
    );
    const article = result.find((p) => p.provisionType === "article");
    const paragraphs = result.filter((p) => p.provisionType === "paragraph");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].citationLabel).toBe("art. 8 § 1");
    expect(paragraphs[0].parentId).toBe(article?.id);
    expect(paragraphs[1].citationLabel).toBe("art. 8 § 2");
  });

  it("nests bare-numbered 'ust.' clauses distinctly from '§' paragraphs", () => {
    const result = parseConsolidatedPdfText(withAnnex(line(1, "Art. 5. Przepis wstępny."), line(1, "1. Pierwszy ustęp.")));
    const clause = result.find((p) => p.provisionType === "clause");
    expect(clause?.citationLabel).toBe("art. 5 ust. 1");
    expect(clause?.paragraph).toBe("1");
  });

  it("nests points and letters under an article, matching HTML-parser citation conventions", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(
        line(1, "Art. 33. Osoby prawne dzielą się na:"),
        line(1, "1) Skarb Państwa;"),
        line(1, "a) jednostki organizacyjne;"),
        line(1, "2) inne."),
      ),
    );
    const points = result.filter((p) => p.provisionType === "point");
    const letters = result.filter((p) => p.provisionType === "letter");
    expect(points.map((p) => p.citationLabel)).toEqual(["art. 33 pkt 1", "art. 33 pkt 2"]);
    expect(letters[0].citationLabel).toBe("art. 33 pkt 1 lit. a");
  });

  it("builds container hierarchy (Tytuł > Dział > Rozdział) ahead of articles", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(
        line(1, "TYTUŁ I"),
        line(1, "DZIAŁ I"),
        line(1, "Rozdział I"),
        line(1, "Art. 1. Treść."),
      ),
    );
    const article = result.find((p) => p.provisionType === "article")!;
    const chapter = result.find((p) => p.provisionType === "chapter")!;
    expect(article.parentId).toBe(chapter.id);
    expect(result.map((p) => p.provisionType)).toEqual(["title", "division", "chapter", "article"]);
  });

  it("closes a deeper unit when a shallower sibling starts (points don't leak into the next article)", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(line(1, "Art. 1. Pierwszy."), line(1, "1) punkt."), line(1, "Art. 2. Drugi.")),
    );
    const point = result.find((p) => p.provisionType === "point")!;
    const art2 = result.find((p) => p.citationLabel === "art. 2")!;
    expect(art2.parentId).toBeNull();
    expect(point.text).not.toContain("Drugi");
  });

  it("reconstructs the added-article superscript-bracket index across its 3-line PDF rendering", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(
        line(1, "Art. 43", 10),
        line(1, "[9]", 6.5),
        line(1, ". Firma nie może być zbyta."),
      ),
    );
    const article = result.find((p) => p.provisionType === "article");
    expect(article?.citationLabel).toBe("art. 43[9]");
    expect(article?.article).toBe("43[9]");
    expect(article?.text).toBe("Art. 43[9]. Firma nie może być zbyta.");
  });

  it("reconstructs the added-article index when rendered as a bare digit (no brackets, as in KPA), normalizing to the bracketed DB convention", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(line(1, "Art. 39", 10), line(1, "3", 6.5), line(1, ". § 1. W przypadku pism.")),
    );
    const article = result.find((p) => p.provisionType === "article");
    expect(article?.citationLabel).toBe("art. 39[3]");
    expect(article?.article).toBe("39[3]");
  });

  it("does not mistake a footnote reference marker (trailing paren) for an added-article index", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(line(1, "Art. 40. Treść.", 10), line(2, "5)", 6), line(2, "Footnote body.", 9), line(2, "Art. 41. Dalej.", 10)),
    );
    expect(result.map((p) => p.citationLabel)).toEqual(["art. 40", "art. 41"]);
  });

  it("drops footnote reference markers and footnote definition text (small font), never merging them into operative text", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(
        line(1, "Art. 1088.", 10),
        line(1, "18)", 6),
        line(2, "Utracił moc z dniem 14 lutego 2001 r.", 9),
      ),
    );
    const article = result.find((p) => p.provisionType === "article");
    expect(article?.text).toBe("Art. 1088.");
    expect(article?.text).not.toContain("Utracił moc");
  });

  it("drops page header/footer boilerplate", () => {
    const result = parseConsolidatedPdfText(
      withAnnex(line(1, "Art. 1. Treść."), line(2, "Dziennik Ustaw – 2 – Poz. 795"), line(2, "2026-06-22"), line(2, "Art. 2. Dalej.")),
    );
    expect(result.some((p) => p.text.includes("Dziennik Ustaw"))).toBe(false);
    expect(result.some((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.text))).toBe(false);
  });

  it("never produces duplicate structuralPaths for sibling units", () => {
    const result = parseConsolidatedPdfText(withAnnex(line(1, "Art. 1. A."), line(1, "Art. 2. B."), line(1, "Art. 3. C.")));
    const paths = result.map((p) => p.structuralPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("stripBoilerplateAndFootnotes", () => {
  it("keeps body-font lines and drops smaller-font lines", () => {
    const result = stripBoilerplateAndFootnotes([line(1, "Body text.", 10), line(1, "footnote", 9)]);
    expect(result).toEqual([{ page: 1, text: "Body text." }]);
  });
});

describe("joinLogicalParagraphs", () => {
  it("joins a hyphen-wrapped word without a space and drops the hyphen", () => {
    const result = joinLogicalParagraphs([
      { page: 1, text: "Art. 1. wkład gruntowy w rolni-" },
      { page: 1, text: "czej spółdzielni." },
    ]);
    expect(result).toEqual(["Art. 1. wkład gruntowy w rolniczej spółdzielni."]);
  });

  it("joins a non-hyphenated continuation with a single space", () => {
    const result = joinLogicalParagraphs([
      { page: 1, text: "Art. 5. Nie można czynić ze swego prawa użytku, który by był" },
      { page: 1, text: "sprzeczny ze społeczno-gospodarczym przeznaczeniem." },
    ]);
    expect(result).toEqual(["Art. 5. Nie można czynić ze swego prawa użytku, który by był sprzeczny ze społeczno-gospodarczym przeznaczeniem."]);
  });

  it("does not join when the next line starts a new structural unit", () => {
    const result = joinLogicalParagraphs([
      { page: 1, text: "Art. 1. Pierwszy." },
      { page: 1, text: "Art. 2. Drugi." },
    ]);
    expect(result).toEqual(["Art. 1. Pierwszy.", "Art. 2. Drugi."]);
  });
});
