import { describe, expect, it } from "vitest";

import {
  buildSearchDocumentContent,
  hashSearchDocumentContent,
  isSearchableProvision,
} from "./documents";

describe("isSearchableProvision", () => {
  it("excludes purely systematic container types", () => {
    expect(
      isSearchableProvision({ provisionType: "division", heading: "Dział I", text: "Dział I" }),
    ).toBe(false);
    expect(isSearchableProvision({ provisionType: "book", heading: "Księga", text: "Księga" })).toBe(
      false,
    );
    expect(isSearchableProvision({ provisionType: "part", heading: "Treść ustawy", text: "Treść ustawy" })).toBe(
      false,
    );
  });

  it("excludes unresolved/unknown node types", () => {
    expect(
      isSearchableProvision({ provisionType: "unknown:schp", heading: null, text: "some text" }),
    ).toBe(false);
  });

  it("excludes container articles whose text duplicates their heading", () => {
    expect(isSearchableProvision({ provisionType: "article", heading: "Art. 353.", text: "Art. 353." })).toBe(
      false,
    );
  });

  it("excludes provisions with empty text", () => {
    expect(isSearchableProvision({ provisionType: "article", heading: null, text: "   " })).toBe(false);
  });

  it("includes leaf articles carrying real operative text", () => {
    expect(
      isSearchableProvision({
        provisionType: "article",
        heading: "Art. 471.",
        text: "Art. 471. Dłużnik obowiązany jest do naprawienia szkody.",
      }),
    ).toBe(true);
  });

  it("includes paragraphs and points", () => {
    expect(
      isSearchableProvision({
        provisionType: "paragraph",
        heading: "§ 1.",
        text: "§ 1. Kodeks normuje postępowanie.",
      }),
    ).toBe(true);
    expect(
      isSearchableProvision({ provisionType: "point", heading: null, text: "1) przedsiębiorstw państwowych" }),
    ).toBe(true);
  });

  it("includes an operative ustęp (clause), and excludes one that is a heading-only container for further points", () => {
    expect(
      isSearchableProvision({
        provisionType: "clause",
        heading: "1.",
        text: "1. Producentowi bazy danych przysługuje wyłączne i zbywalne prawo pobierania danych.",
      }),
    ).toBe(true);
    expect(isSearchableProvision({ provisionType: "clause", heading: "1.", text: "1." })).toBe(false);
  });
});

describe("buildSearchDocumentContent", () => {
  it("composes act title, hierarchy, citation, and text", () => {
    const content = buildSearchDocumentContent({
      actTitle: "Kodeks cywilny",
      ancestorHeadings: ["Księga trzecia - Zobowiązania", "Tytuł VII - Wykonanie zobowiązań"],
      citationLabel: "art. 471",
      text: "Art. 471. Dłużnik obowiązany jest do naprawienia szkody.",
    });

    expect(content).toBe(
      [
        "Kodeks cywilny",
        "Księga trzecia - Zobowiązania",
        "Tytuł VII - Wykonanie zobowiązań",
        "art. 471",
        "Art. 471. Dłużnik obowiązany jest do naprawienia szkody.",
      ].join("\n"),
    );
  });

  it("drops blank ancestor headings deterministically", () => {
    const content = buildSearchDocumentContent({
      actTitle: "Kodeks cywilny",
      ancestorHeadings: ["", "  ", "Tytuł VII"],
      citationLabel: "art. 471",
      text: "Art. 471. Tekst.",
    });

    expect(content).toBe(["Kodeks cywilny", "Tytuł VII", "art. 471", "Art. 471. Tekst."].join("\n"));
  });
});

describe("hashSearchDocumentContent", () => {
  it("is deterministic for identical content", () => {
    const content = "Kodeks cywilny\nart. 471\nArt. 471. Tekst.";
    expect(hashSearchDocumentContent(content)).toBe(hashSearchDocumentContent(content));
  });

  it("changes when the source content changes", () => {
    const original = hashSearchDocumentContent("Art. 471. Tekst.");
    const changed = hashSearchDocumentContent("Art. 471. Zmieniony tekst.");
    expect(changed).not.toBe(original);
  });
});
