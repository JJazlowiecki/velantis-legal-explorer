import { describe, expect, it } from "vitest";

import { AnnexSelectionError, parseActStructureHtml } from "./structure";

/** Minimal fixture matching the real Sejm/ISAP "text.html" markup convention (verified against the real DU/1964/93 document). */
function wrapDocument(bodyUnits: string): string {
  return `<!DOCTYPE HTML><html><body>
    <div class="parts">
      <section id="part_1">
        <div class="part" id="_001">
          <h2 class="part"><span class="hidden">Treść ustawy</span></h2>
          <div class="block">${bodyUnits}</div>
        </div>
      </section>
    </div>
  </body></html>`;
}

describe("parseActStructureHtml", () => {
  it("produces a single root 'part' node for an act with no body units", () => {
    const result = parseActStructureHtml(wrapDocument(""));
    expect(result).toEqual([
      expect.objectContaining({ provisionType: "part", citationLabel: "Treść ustawy", heading: "Treść ustawy", parentId: null, ordinal: 1 }),
    ]);
  });

  it("parses a simple article with direct text (no sub-paragraphs)", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_1" data-id="arti_1">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
        <div class="unit-inner">
          <div data-template="xText" CLASS="pro-text">Treść przepisu testowego.</div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const article = result.find((n) => n.provisionType === "article");

    expect(article).toMatchObject({
      citationLabel: "art. 1",
      heading: "Art. 1.",
      text: "Art. 1. Treść przepisu testowego.",
      article: "1",
      structuralPath: "part_1/arti_1",
    });
    expect(article?.parentId).toBe(result[0].id);
  });

  it("parses an article subdivided into paragraphs (§), with no direct text of its own", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_2" data-id="arti_2">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;2.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_para pro-text false" id="arti_2-para_1" data-id="para_1">
            <h3 CLASS="pro-padding-right"><B CLASS="b">&sect;&nbsp;1.</B></h3>
            <div class="unit-inner">
              <div data-template="xText" CLASS="pro-text">Treść paragrafu pierwszego.</div>
            </div>
          </div>
          <div class="unit unit_para pro-text false" id="arti_2-para_2" data-id="para_2">
            <h3 CLASS="pro-padding-right"><B CLASS="b">&sect;&nbsp;2.</B></h3>
            <div class="unit-inner">
              <div data-template="xText" CLASS="pro-text">Treść paragrafu drugiego.</div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const article = result.find((n) => n.provisionType === "article");
    const paragraphs = result.filter((n) => n.provisionType === "paragraph");

    // The article itself carries no body text (it's a pure container) — matches real KC art. 1.
    expect(article?.text).toBe("Art. 2.");
    expect(paragraphs).toHaveLength(2);
    // Fully qualified with the ancestor article — matches the existing KPA corpus
    // convention exactly (e.g. stored DU/1960/168 rows use "art. 2 § 1", never bare "§ 1").
    expect(paragraphs[0]).toMatchObject({ citationLabel: "art. 2 § 1", paragraph: "1", text: "§ 1. Treść paragrafu pierwszego.", parentId: article?.id });
    expect(paragraphs[1]).toMatchObject({ citationLabel: "art. 2 § 2", paragraph: "2" });
  });

  it("parses containers (division/chapter) with a subtitle and nests articles beneath them", () => {
    const html = wrapDocument(`
      <div class="unit unit_bran pro-text with-title" id="bran_I" data-id="bran_I">
        <h3>
          <P ALIGN="center">&nbsp;&nbsp;Dział&nbsp;I&nbsp;&nbsp;</P>
          <P ALIGN="center"><B CLASS="b"><SPAN CLASS="pro-title-unit">Przepisy ogólne</SPAN></B></P>
        </h3>
        <div class="unit-inner">
          <div class="unit unit_chpt pro-text with-title" id="bran_I-chpt_1" data-id="chpt_1">
            <h3>
              <P ALIGN="center">&nbsp;&nbsp;Rozdział&nbsp;1&nbsp;&nbsp;</P>
              <P ALIGN="center"><B CLASS="b"><SPAN CLASS="pro-title-unit">Zasady</SPAN></B></P>
            </h3>
            <div class="unit-inner">
              <div class="unit unit_arti pro-text false" id="bran_I-chpt_1-arti_1" data-id="arti_1">
                <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
                <div class="unit-inner">
                  <div data-template="xText" CLASS="pro-text">Treść.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);

    const division = result.find((n) => n.provisionType === "division");
    const chapter = result.find((n) => n.provisionType === "chapter");
    const article = result.find((n) => n.provisionType === "article");

    expect(division).toMatchObject({ citationLabel: "Dział I - Przepisy ogólne", heading: "Dział I - Przepisy ogólne" });
    expect(chapter).toMatchObject({ citationLabel: "Rozdział 1 - Zasady", parentId: division?.id });
    expect(article?.parentId).toBe(chapter?.id);
  });

  it("parses points and letters nested under a paragraph", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_3" data-id="arti_3">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;3.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_para pro-text false" id="arti_3-para_1" data-id="para_1">
            <h3 CLASS="pro-padding-right"><B CLASS="b">&sect;&nbsp;1.</B></h3>
            <div class="unit-inner">
              <div class="unit unit_pint pro-text false" id="arti_3-para_1-pint_1" data-id="pint_1">
                <h3 CLASS="pro-align-padding-right">1)</h3>
                <div class="unit-inner">
                  <div data-template="xText" CLASS="pro-text">pierwszy punkt,</div>
                </div>
              </div>
              <div class="unit unit_pint pro-text false" id="arti_3-para_1-pint_2" data-id="pint_2">
                <h3 CLASS="pro-align-padding-right">2)</h3>
                <div class="unit-inner">
                  <div class="unit unit_lett pro-text false" id="arti_3-para_1-pint_2-lett_a" data-id="lett_a">
                    <h3 CLASS="pro-align-padding-right">a)</h3>
                    <div class="unit-inner">
                      <div data-template="xText" CLASS="pro-text">litera a,</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);

    const point1 = result.find((n) => n.point === "1");
    const point2 = result.find((n) => n.point === "2");
    const letter = result.find((n) => n.letter === "a");

    expect(point1).toMatchObject({ citationLabel: "art. 3 § 1 pkt 1", text: "1) pierwszy punkt," });
    expect(point2).toMatchObject({ citationLabel: "art. 3 § 1 pkt 2" });
    expect(letter).toMatchObject({ citationLabel: "art. 3 § 1 pkt 2 lit. a", text: "a) litera a,", parentId: point2?.id });
  });

  it("A: parses a simple numbered ustęp (unit_pass) with no nested pkt/lit, preserving its own text instead of producing a false zero-child article stub", () => {
    // Exact shape confirmed live against the official announcement HTML actually ingested for
    // DU/2001/1402 art. 6 (see the ingestion-completeness-audit report): the operative text
    // lives one level deeper than the article, inside an intermediate unit_pass node.
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_6" data-id="arti_6">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;6.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_pass pro-text false" id="arti_6-pass_1" data-id="pass_1">
            <h3 CLASS="pro-align-padding-right">1.</h3>
            <div class="unit-inner">
              <div data-template="xText" CLASS="pro-text">Producentowi bazy danych przysługuje wyłączne i zbywalne prawo pobierania danych.</div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);

    const article = result.find((n) => n.provisionType === "article");
    const clause = result.find((n) => n.provisionType === "clause");

    // The article no longer silently swallows its only ustęp's text nor becomes a bare stub.
    expect(article?.text).toBe("Art. 6.");
    expect(clause).toBeDefined();
    expect(clause).toMatchObject({
      citationLabel: "art. 6 ust. 1",
      heading: "1.",
      text: "1. Producentowi bazy danych przysługuje wyłączne i zbywalne prawo pobierania danych.",
      paragraph: "1",
      article: null,
      parentId: article?.id,
    });
  });

  it("A2: a clause's substantive text is never lost, distinguishing it from a real heading-only container", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_6" data-id="arti_6">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;6.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_pass pro-text false" id="arti_6-pass_1" data-id="pass_1">
            <h3 CLASS="pro-align-padding-right">1.</h3>
            <div class="unit-inner">
              <div data-template="xText" CLASS="pro-text">Treść ustępu.</div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const clause = result.find((n) => n.provisionType === "clause");
    // Not a heading-duplicate: text carries real content beyond "1." — this is what makes
    // isSearchableProvision (documents.ts) correctly index it, unlike a genuinely bare stub.
    expect(clause?.text).not.toBe(clause?.heading);
  });

  it("B: parses a nested ustęp (unit_pass with its own text AND nested pkt/lit children) without losing either", () => {
    // Exact shape confirmed live for DU/1997/681 art. 24a: an ustęp with its own introductory
    // sentence AND (in other real articles of the same act) further enumerated points beneath it.
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_24a" data-id="arti_24a">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;24a.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_pass pro-text false" id="arti_24a-pass_1" data-id="pass_1">
            <h3 CLASS="pro-align-padding-right">1.</h3>
            <div class="unit-inner">
              <div data-template="xText" CLASS="pro-text">Jednostki są obowiązane stosować wymagania:</div>
              <div class="unit unit_pint pro-text false" id="arti_24a-pass_1-pint_1" data-id="pint_1">
                <h3 CLASS="pro-align-padding-right">1)</h3>
                <div class="unit-inner">
                  <div data-template="xText" CLASS="pro-text">dobrej praktyki pobierania krwi,</div>
                </div>
              </div>
              <div class="unit unit_pint pro-text false" id="arti_24a-pass_1-pint_2" data-id="pint_2">
                <h3 CLASS="pro-align-padding-right">2)</h3>
                <div class="unit-inner">
                  <div class="unit unit_lett pro-text false" id="arti_24a-pass_1-pint_2-lett_a" data-id="lett_a">
                    <h3 CLASS="pro-align-padding-right">a)</h3>
                    <div class="unit-inner">
                      <div data-template="xText" CLASS="pro-text">badania,</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);

    const clause = result.find((n) => n.provisionType === "clause");
    const point1 = result.find((n) => n.point === "1");
    const point2 = result.find((n) => n.point === "2");
    const letter = result.find((n) => n.letter === "a");

    // The ustęp's own introductory text is preserved, not just its children's.
    expect(clause?.text).toBe("1. Jednostki są obowiązane stosować wymagania:");
    expect(clause?.citationLabel).toBe("art. 24a ust. 1");

    // Nested pkt/lit hierarchy is exactly as correct as it already is under a paragraph(§).
    expect(point1).toMatchObject({ citationLabel: "art. 24a ust. 1 pkt 1", text: "1) dobrej praktyki pobierania krwi,", parentId: clause?.id });
    expect(point2).toMatchObject({ citationLabel: "art. 24a ust. 1 pkt 2", parentId: clause?.id });
    expect(letter).toMatchObject({ citationLabel: "art. 24a ust. 1 pkt 2 lit. a", text: "a) badania,", parentId: point2?.id });

    // No duplicate/orphaned nodes: exactly one of each expected type below the root part.
    expect(result.filter((n) => n.provisionType === "clause")).toHaveLength(1);
    expect(result.filter((n) => n.provisionType === "point")).toHaveLength(2);
    expect(result.filter((n) => n.provisionType === "letter")).toHaveLength(1);
  });

  it("C1: control — an unmapped unit type is still never turned into a provision, only descended into (unlike unit_pass, which is now mapped)", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_1" data-id="arti_1">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_totallyunknown pro-text false" id="arti_1-mystery_1" data-id="mystery_1">
            <div class="unit-inner">
              <div class="unit unit_pint pro-text false" id="arti_1-mystery_1-pint_1" data-id="pint_1">
                <h3 CLASS="pro-align-padding-right">1)</h3>
                <div class="unit-inner">
                  <div data-template="xText" CLASS="pro-text">punkt pod nieznanym węzłem,</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);

    // No provision was created for the unknown "totallyunknown" node itself.
    expect(result.some((n) => n.heading?.includes("mystery"))).toBe(false);
    // But its real, known-type descendant (the point) is still found and correctly attached to
    // the nearest KNOWN ancestor (the article) — matching the pre-existing unknown-unit contract.
    const article = result.find((n) => n.provisionType === "article");
    const point = result.find((n) => n.point === "1");
    expect(point).toMatchObject({ citationLabel: "art. 1 pkt 1", parentId: article?.id });
  });

  it("C2: control — explicit '(uchylony)'/'(pominięty)' repeal markers stored as direct article text are preserved unchanged", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_10" data-id="arti_10">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;10.</B></h3>
        <div class="unit-inner">
          <div data-template="xText" CLASS="pro-text">(uchylony)</div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const article = result.find((n) => n.provisionType === "article");
    expect(article?.text).toBe("Art. 10. (uchylony)");
  });

  it("disambiguates a duplicate data-id under the same parent (observed in the real DU/1964/93 source) rather than dropping a provision or crashing", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_538" data-id="arti_538">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;536.</B></h3>
        <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Pierwszy.</div></div>
      </div>
      <div class="unit unit_arti pro-text false" id="arti_538" data-id="arti_538">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;538.</B></h3>
        <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Drugi.</div></div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const articles = result.filter((n) => n.provisionType === "article");

    expect(articles).toHaveLength(2);
    const paths = new Set(articles.map((a) => a.structuralPath));
    expect(paths.size).toBe(2);
  });

  it("assigns strictly increasing ordinals in document (pre-order) order", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_1" data-id="arti_1">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
        <div class="unit-inner"><div data-template="xText" CLASS="pro-text">A.</div></div>
      </div>
      <div class="unit unit_arti pro-text false" id="arti_2" data-id="arti_2">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;2.</B></h3>
        <div class="unit-inner"><div data-template="xText" CLASS="pro-text">B.</div></div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const ordinals = result.map((n) => n.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it("returns [] for HTML that has no recognizable act structure at all", () => {
    expect(parseActStructureHtml("<html><body>not an ELI act document</body></html>")).toEqual([]);
  });
});

/** Minimal fixture matching the real Sejm/ISAP announcement "text.html" convention: a
 * `part_1` administrative preamble followed by a `part_2` "Załącznik - Tekst jednolity ..."
 * annex containing the actual consolidated-statute body (verified against real DU/2024/1061 and
 * DU/2024/17 documents). */
function wrapAnnouncementDocument(options: {
  preambleArticleId?: string;
  annexHeading?: string;
  annexArticleId?: string;
  annexBodyText?: string;
  extraAnnexSectionId?: string;
}): string {
  const preambleArticleId = options.preambleArticleId ?? "pass_1";
  const annexHeading = options.annexHeading ?? "Załącznik&nbsp;&nbsp;-&nbsp;&nbsp;Tekst jednolity ustawy z dnia 1 stycznia 2000&nbsp;r. Ustawa testowa";
  const annexArticleId = options.annexArticleId ?? "arti_1";
  const annexBodyText = options.annexBodyText ?? "Consolidated statute text.";

  const extraSection = options.extraAnnexSectionId
    ? `
      <section id="${options.extraAnnexSectionId}">
        <div class="part" id="_003">
          <h2 class="part"><span class=" ">${annexHeading}</span></h2>
          <div class="block">
            <div class="unit unit_arti pro-text false" id="${annexArticleId}_dup" data-id="${annexArticleId}">
              <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
              <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Duplicate annex text.</div></div>
            </div>
          </div>
        </div>
      </section>`
    : "";

  return `<!DOCTYPE HTML><html><body>
    <div class="parts">
      <section id="part_1">
        <div class="part" id="_001">
          <h2 class="part"><span class=" ">Treść obwieszczenia</span></h2>
          <div class="block">
            <div class="unit unit_arti pro-text false" id="${preambleArticleId}" data-id="${preambleArticleId}">
              <h3 CLASS="pro-none"><B CLASS="b">1.</B></h3>
              <div class="unit-inner"><div data-template="xText" CLASS="pro-text">Preamble text — must never be ingested as a base-statute provision.</div></div>
            </div>
          </div>
        </div>
      </section>
      <section id="part_2">
        <div class="part" id="_002">
          <h2 class="part"><span class=" ">${annexHeading}</span></h2>
          <div class="block">
            <div class="unit unit_arti pro-text false" id="${annexArticleId}" data-id="${annexArticleId}">
              <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
              <div class="unit-inner"><div data-template="xText" CLASS="pro-text">${annexBodyText}</div></div>
            </div>
          </div>
        </div>
      </section>${extraSection}
    </div>
  </body></html>`;
}

describe("parseActStructureHtml — mode: consolidated_annex", () => {
  it("selects only the annex section, excluding the announcement's own preamble", () => {
    const result = parseActStructureHtml(wrapAnnouncementDocument({}), "consolidated_annex");

    const texts = result.map((node) => node.text);
    expect(texts.some((text) => text.includes("Preamble text"))).toBe(false);
    expect(texts.some((text) => text.includes("Consolidated statute text"))).toBe(true);
  });

  it("preserves the normal citation-hierarchy behavior within the selected annex", () => {
    const result = parseActStructureHtml(wrapAnnouncementDocument({}), "consolidated_annex");
    const article = result.find((node) => node.provisionType === "article");

    expect(article).toMatchObject({ citationLabel: "art. 1", article: "1" });
  });

  it("throws AnnexSelectionError when zero sections have a matching heading", () => {
    const html = wrapAnnouncementDocument({ annexHeading: "Nie jest to załącznik" });

    expect(() => parseActStructureHtml(html, "consolidated_annex")).toThrow(AnnexSelectionError);
    try {
      parseActStructureHtml(html, "consolidated_annex");
    } catch (error) {
      expect(error).toBeInstanceOf(AnnexSelectionError);
      expect((error as InstanceType<typeof AnnexSelectionError>).matchCount).toBe(0);
    }
  });

  it("throws AnnexSelectionError when multiple sections have a matching heading, without guessing", () => {
    const html = wrapAnnouncementDocument({ extraAnnexSectionId: "part_3" });

    expect(() => parseActStructureHtml(html, "consolidated_annex")).toThrow(AnnexSelectionError);
    try {
      parseActStructureHtml(html, "consolidated_annex");
    } catch (error) {
      expect(error).toBeInstanceOf(AnnexSelectionError);
      expect((error as InstanceType<typeof AnnexSelectionError>).matchCount).toBe(2);
    }
  });

  it("direct (default) mode is unchanged: it still selects part_1, never the annex", () => {
    const result = parseActStructureHtml(wrapAnnouncementDocument({}));
    const texts = result.map((node) => node.text);

    expect(texts.some((text) => text.includes("Preamble text"))).toBe(true);
    expect(texts.some((text) => text.includes("Consolidated statute text"))).toBe(false);
  });
});

/**
 * Real Sejm/ISAP legislative-footnote markup (confirmed against the live DU/2024/1769
 * database-protection act and DU/2024/1782 blood-service act documents): the reference marker
 * and the full footnote body are both nested INSIDE the annotated element via
 * `<a class="gloss-link tooltip">`. Used below to reproduce the exact real-world contamination
 * pattern, never an invented/simplified shape.
 */
function glossLink(marker: string, body: string): string {
  return `<a class="gloss-link tooltip" href="#gloss-0:1:"><sup>${marker}</sup><span class="tooltip-text"><span class="pro-gloss-inner">${body}</span></span></a>`;
}

describe("parseActStructureHtml — legislative-footnote gloss-link exclusion", () => {
  it("1: a structural annex heading contaminated with a footnote gloss is parsed as a short structural heading", () => {
    const annexHeading = `Załącznik&nbsp;&nbsp;-&nbsp;&nbsp;Tekst jednolity ustawy z dnia 1 stycznia 2000&nbsp;r. Ustawa testowa${glossLink("1)", "Niniejsza ustawa dokonuje w zakresie swojej regulacji wdrożenia dyrektywy 96/9/WE.")}`;
    const html = wrapAnnouncementDocument({ annexHeading });
    const result = parseActStructureHtml(html, "consolidated_annex");

    const root = result.find((node) => node.provisionType === "part");
    expect(root?.heading).toBe("Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa");
    expect(root?.heading).not.toContain("dyrektywy");
    expect(root?.heading?.length).toBeLessThan(100);
  });

  it("2: the adjacent legislative footnote / transposition note is NOT appended to the heading", () => {
    const annexHeading = `Załącznik&nbsp;&nbsp;-&nbsp;&nbsp;Tekst jednolity ustawy z dnia 1 stycznia 2000&nbsp;r. Ustawa testowa${glossLink("1)", "Niniejsza ustawa dokonuje w zakresie swojej regulacji wdrożenia dyrektywy 96/9/WE z dnia 11 marca 1996 r.")}`;
    const html = wrapAnnouncementDocument({ annexHeading });
    const result = parseActStructureHtml(html, "consolidated_annex");

    const root = result.find((node) => node.provisionType === "part");
    expect(root?.heading).not.toContain("Niniejsza ustawa dokonuje");
    expect(root?.heading).not.toContain("96/9/WE");
  });

  it("3: footnote text is not accidentally promoted into an operative child provision's own text", () => {
    const html = wrapAnnouncementDocument({
      annexBodyText: `Producent jest przedsiębiorcą w rozumieniu odrębnych przepisów, z późn. zm.${glossLink("3)", "Zmiany wymienionej ustawy zostały ogłoszone w Dz. U. z 2000 r. poz. 958.")}`,
    });
    const result = parseActStructureHtml(html, "consolidated_annex");

    const article = result.find((node) => node.provisionType === "article");
    expect(article?.text).toContain("Producent jest przedsiębiorcą w rozumieniu odrębnych przepisów, z późn. zm.");
    expect(article?.text).not.toContain("Zmiany wymienionej ustawy");
    expect(article?.text).not.toContain("2000 r. poz. 958");
  });

  it("4: a normal annex WITHOUT any footnote remains completely unchanged", () => {
    const result = parseActStructureHtml(wrapAnnouncementDocument({}), "consolidated_annex");
    const root = result.find((node) => node.provisionType === "part");
    expect(root?.heading).toBe("Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa");
  });

  it("5: a legitimate long heading with NO gloss-link is preserved in full, never truncated by length", () => {
    const longHeading =
      "Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. o bardzo długim i szczegółowym tytule ustawy testowej, który nie zawiera żadnego przypisu ani odnośnika, a mimo to jest znacznie dłuższy niż typowy tytuł ustawy";
    const result = parseActStructureHtml(wrapAnnouncementDocument({ annexHeading: longHeading }), "consolidated_annex");
    const root = result.find((node) => node.provisionType === "part");
    expect(root?.heading).toBe(longHeading);
    expect(root?.heading?.length).toBeGreaterThan(150);
  });

  it("6: sołtys-style operative parent framing (no gloss-link) remains fully available as operative text", () => {
    const html = wrapAnnouncementDocument({
      annexBodyText: "Świadczenie przysługuje osobie, która spełnia łącznie następujące warunki:",
    });
    const result = parseActStructureHtml(html, "consolidated_annex");
    const article = result.find((node) => node.provisionType === "article");
    expect(article?.text).toContain("Świadczenie przysługuje osobie, która spełnia łącznie następujące warunki:");
  });

  it("7: unit_pass (ustęp/clause) parsing behavior remains intact alongside gloss-link exclusion", () => {
    const html = wrapDocument(`
      <div class="unit unit_arti pro-text false" id="arti_1" data-id="arti_1">
        <h3 CLASS="pro-none"><B CLASS="b">Art.&nbsp;1.</B></h3>
        <div class="unit-inner">
          <div class="unit unit_pass pro-text false" id="pass_1" data-id="pass_1">
            <h3 CLASS="pro-none"><B CLASS="b">1.</B></h3>
            <div class="unit-inner">
              <div data-template="xText" CLASS="pro-text">Tekst ustępu z przypisem.${glossLink("2)", "Przypis nieistotny.")}</div>
            </div>
          </div>
        </div>
      </div>
    `);
    const result = parseActStructureHtml(html);
    const clause = result.find((node) => node.provisionType === "clause");
    expect(clause).toBeDefined();
    expect(clause?.citationLabel).toBe("art. 1 ust. 1");
    expect(clause?.text).toContain("Tekst ustępu z przypisem.");
    expect(clause?.text).not.toContain("Przypis nieistotny");
  });

  it("8: parser output remains deterministic — parsing the same gloss-link-contaminated source twice yields identical text/heading", () => {
    const annexHeading = `Załącznik&nbsp;&nbsp;-&nbsp;&nbsp;Tekst jednolity ustawy z dnia 1 stycznia 2000&nbsp;r. Ustawa testowa${glossLink("1)", "Nota wdrożeniowa.")}`;
    const html = wrapAnnouncementDocument({ annexHeading });
    const result1 = parseActStructureHtml(html, "consolidated_annex");
    const result2 = parseActStructureHtml(html, "consolidated_annex");

    const root1 = result1.find((node) => node.provisionType === "part");
    const root2 = result2.find((node) => node.provisionType === "part");
    expect(root1?.heading).toBe(root2?.heading);
    expect(result1.map((n) => n.text)).toEqual(result2.map((n) => n.text));
  });
});
