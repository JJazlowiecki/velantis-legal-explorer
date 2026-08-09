import { describe, expect, it } from "vitest";

import { parseActStructureHtml } from "./structure";

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
