import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";

/**
 * Parses the Sejm/ISAP ELI "text.html" representation of an act into a flat, pre-order list of
 * structured provisions. The markup is a well-formed, machine-generated XHTML tree using a
 * consistent `unit unit_<type>` class convention with hierarchical `id`/`data-id` attributes —
 * this is NOT a heuristic scrape, it is a direct structural mapping of markup that already
 * encodes the act's real legal hierarchy (Księga/Tytuł/Dział/Rozdział/Oddział/Artykuł/§/ustęp/
 * point/letter), confirmed against the real DU/1964/93 (Kodeks cywilny) document.
 *
 * Deliberately generic across acts (not Civil-Code-specific): any of the observed unit types
 * may be absent for a given act (e.g. an act with no Księgi), matching the milestone's
 * "do not assume every act uses article-based structure" requirement.
 */

const UNIT_TYPE_LABELS: Record<string, { provisionType: string; noun: string }> = {
  book: { provisionType: "book", noun: "Księga" },
  part: { provisionType: "part_division", noun: "Część" },
  titl: { provisionType: "title", noun: "Tytuł" },
  bran: { provisionType: "division", noun: "Dział" },
  chpt: { provisionType: "chapter", noun: "Rozdział" },
  schp: { provisionType: "subchapter", noun: "Oddział" },
  arti: { provisionType: "article", noun: "Art." },
  para: { provisionType: "paragraph", noun: "§" },
  // "ustęp" (a numbered subdivision of an article, rendered by ISAP as a bare "1.", "2." — NOT
  // the same Polish legal unit as "§"/paragraf, which `para` above already owns). Deliberately a
  // DISTINCT provisionType from "paragraph" so nothing that means "§" is silently reinterpreted
  // as "ust." or vice versa; see the ingestion-completeness-audit report for why conflating the
  // two would have been wrong. Its number is stored in the SAME `paragraph` DB column that
  // "paragraph"(§) uses — that column is already the repository's generic second-level numeric
  // slot, not a §-exclusive one: parseExactCitation (citation.ts) already maps a bare "ust. N" in
  // a user query onto this same column, and findExactCitationMatches (citation-match.ts) matches
  // purely by column equality, never by provisionType — so reusing the column (never the type
  // string) for "ust." numbers requires no schema change and is already the shape citation
  // search expects.
  pass: { provisionType: "clause", noun: "Ust." },
  pint: { provisionType: "point", noun: "" },
  lett: { provisionType: "letter", noun: "" },
};

/**
 * Thrown by `mode: "consolidated_annex"` when the semantic "Załącznik - Tekst jednolity ..."
 * heading rule doesn't resolve to exactly one section. Deliberately fail-closed: a consolidated
 * announcement document's structure is not something this pipeline should ever guess about —
 * zero matches means the document isn't the shape we expect, and multiple matches means picking
 * one would be an unaudited judgment call baked into ingested "official" text.
 */
export class AnnexSelectionError extends Error {
  constructor(
    message: string,
    public readonly matchCount: number,
  ) {
    super(message);
    this.name = "AnnexSelectionError";
  }
}

export type StructureParseMode = "direct" | "consolidated_annex";

const CONSOLIDATED_ANNEX_HEADING_PATTERN = /^Załącznik\s*-\s*Tekst jednolity/;

export interface ParsedProvision {
  id: string;
  parentId: string | null;
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
}

function normalizeText(raw: string): string {
  return raw
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** e.g. "arti_163" -> "163", "para_1" -> "1", "lett_a" -> "a". */
function extractLocalNumber(dataId: string): string {
  const underscoreIndex = dataId.indexOf("_");
  return underscoreIndex === -1 ? dataId : dataId.slice(underscoreIndex + 1);
}


export function parseActStructureHtml(
  html: string,
  mode: StructureParseMode = "direct",
): ParsedProvision[] {
  const $ = cheerio.load(html);
  const results: ParsedProvision[] = [];
  let ordinal = 0;

  /**
   * The official Sejm/ISAP renderer attaches legislative footnotes (amendment-history notes,
   * EU-directive-transposition notes, "ustawa została ogłoszona..." publication notes, etc.) to
   * the exact word/phrase they annotate via `<a class="gloss-link tooltip">`, which nests BOTH
   * the footnote's reference marker (`<sup>N)</sup>`) and its full body text
   * (`<span class="tooltip-text"><span class="pro-gloss-inner">...</span></span>`) INSIDE the
   * element being annotated — confirmed against the real DU/2024/1769 (database-protection act)
   * and DU/2024/1782 (blood-service act) documents, where this occurs both inside heading
   * `<h2>`/`<h3>` elements (root annex heading, up to 1683 chars observed live) and inside
   * operative `xText` body divs, mid-sentence with no separating space (e.g. "...z późn.
   * zm.3)Zmiany wymienionej ustawy..." — confirmed already present, pre-fix, in the live
   * `legal_provisions.text` for art. 5 pkt 5 / art. 16 ust. 1 / art. 17 of the database act, and
   * observed in all five currently-pinned acts' operative text).
   *
   * cheerio's plain `.text()` recursively concatenates ALL descendant text nodes, so it silently
   * pulls the entire footnote body into whatever heading/operative text it's building. This is a
   * generic, semantically-marked ELI/ISAP rendering convention — not a malformed one-off
   * document — so the fix is generic: strip `a.gloss-link` (marker + tooltip body together;
   * they are one annotation unit, never legally operative) before reading `.text()`, applied
   * uniformly everywhere text is extracted from markup. Never a length-based heuristic, never
   * act-specific.
   */
  function textExcludingGlossLinks(el: ReturnType<typeof $>): string {
    return el.clone().find("a.gloss-link").remove().end().text();
  }
  // Real ISAP/Sejm source documents occasionally reuse a data-id within the same parent (a
  // renumbered/repealed-then-reinstated article observed in DU/1964/93 itself: two distinct
  // <div> elements both carrying data-id="arti_538" under the same parent). structuralPath only
  // needs to be unique per version (it's never rendered), so a colliding path is disambiguated
  // deterministically with its ordinal rather than the ingestion failing or silently dropping a
  // real provision.
  const usedPaths = new Set<string>();
  function uniquePath(candidate: string, ord: number): string {
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
    const disambiguated = `${candidate}#${ord}`;
    usedPaths.add(disambiguated);
    return disambiguated;
  }

  function walkUnit(
    el: ReturnType<typeof $>,
    parentId: string | null,
    parentPath: string,
    parentCitationLabel: string,
    typeKey: string,
  ): void {
    const config = UNIT_TYPE_LABELS[typeKey];
    if (!config) {
      // Unknown unit type: skip structurally rather than fabricate a label, but still
      // descend into any nested units it might contain.
      const unitInner = el.children(".unit-inner").first();
      for (const child of unitInner.children(".unit").toArray()) {
        const $child = $(child);
        const childTypeKey = ($child.attr("class") ?? "").match(/unit_([a-zA-Zł]+)/)?.[1] ?? "";
        walkUnit($child, parentId, parentPath, parentCitationLabel, childTypeKey);
      }
      return;
    }

    const dataId = el.attr("data-id") ?? "";
    const localNumber = extractLocalNumber(dataId);
    const id = randomUUID();
    ordinal += 1;
    const structuralPath = uniquePath(parentPath ? `${parentPath}/${dataId}` : dataId, ordinal);

    const headingEl = el.children("h3, h2").first();
    const paragraphs = headingEl.find("P").toArray().map((p) => normalizeText(textExcludingGlossLinks($(p))));
    const numberLine = paragraphs[0] ?? normalizeText(textExcludingGlossLinks(headingEl));
    const subtitleText = normalizeText(textExcludingGlossLinks(headingEl.find(".pro-title-unit")));

    let heading: string;
    let citationLabel: string;
    let article: string | null = null;
    let paragraph: string | null = null;
    let point: string | null = null;
    let letter: string | null = null;

    if (config.provisionType === "article") {
      heading = `Art. ${localNumber}.`.replace(/ /g, " ");
      citationLabel = `art. ${localNumber}`;
      article = localNumber;
    } else if (config.provisionType === "paragraph") {
      heading = `§ ${localNumber}.`;
      // Fully qualified with the ancestor chain (e.g. "art. 2 § 1") — matches the existing
      // KPA corpus convention exactly (confirmed by direct comparison against stored
      // DU/1960/168 rows); a bare "§ 1" is ambiguous once displayed outside its tree
      // position (Saved items, cited sources, etc).
      citationLabel = `${parentCitationLabel} § ${localNumber}`;
      paragraph = localNumber;
    } else if (config.provisionType === "clause") {
      heading = `${localNumber}.`;
      // Fully qualified with the ancestor article, same convention as "paragraph"(§) above —
      // "art. 6 ust. 1", never a bare "ust. 1" or (critically) "art. 6 § 1".
      citationLabel = `${parentCitationLabel} ust. ${localNumber}`;
      paragraph = localNumber;
    } else if (config.provisionType === "point") {
      heading = `${localNumber})`;
      citationLabel = `${parentCitationLabel} pkt ${localNumber}`;
      point = localNumber;
    } else if (config.provisionType === "letter") {
      heading = `${localNumber})`;
      citationLabel = `${parentCitationLabel} lit. ${localNumber}`;
      letter = localNumber;
    } else {
      // Container types (book/part_division/title/division/chapter/subchapter): the first
      // centered <P> already reads naturally in Polish (e.g. "Księga pierwsza", "Dział I"),
      // optionally followed by a bolded subtitle line.
      const base = numberLine || `${config.noun} ${localNumber}`.trim();
      heading = subtitleText ? `${base} - ${subtitleText}` : base;
      citationLabel = heading;
    }

    const unitInner = el.children(".unit-inner").first();
    const ownTextParts = unitInner
      .children('div[data-template="xText"]')
      .toArray()
      .map((node) => normalizeText(textExcludingGlossLinks($(node))))
      .filter((part) => part.length > 0);
    const ownText = ownTextParts.join(" ");

    results.push({
      id,
      parentId,
      provisionType: config.provisionType,
      article,
      paragraph,
      point,
      letter,
      citationLabel,
      heading,
      text: ownText.length > 0 ? `${heading} ${ownText}` : heading,
      structuralPath,
      ordinal,
    });

    for (const child of unitInner.children(".unit").toArray()) {
      const $child = $(child);
      const childTypeKey = ($child.attr("class") ?? "").match(/unit_([a-zA-Zł]+)/)?.[1] ?? "";
      walkUnit($child, id, structuralPath, citationLabel, childTypeKey);
    }
  }

  let rootSection: ReturnType<typeof $>;

  if (mode === "direct") {
    rootSection = $(".parts > section").first();
  } else {
    const candidates = $(".parts > section").filter((_, el) => {
      const headingText = normalizeText(textExcludingGlossLinks($(el).children(".part").first().children("h2").first()));
      return CONSOLIDATED_ANNEX_HEADING_PATTERN.test(headingText);
    });

    if (candidates.length === 0) {
      throw new AnnexSelectionError(
        'No section with a "Załącznik - Tekst jednolity ..." heading was found — refusing to guess which section is the consolidated-statute annex.',
        0,
      );
    }
    if (candidates.length > 1) {
      throw new AnnexSelectionError(
        `Found ${candidates.length} sections with a "Załącznik - Tekst jednolity ..." heading — refusing to guess which one is the consolidated-statute annex.`,
        candidates.length,
      );
    }

    rootSection = candidates.first();
  }

  const rootPartDiv = rootSection.children(".part").first();
  if (rootPartDiv.length === 0) {
    return [];
  }

  const rootId = randomUUID();
  const rootStructuralPath = rootSection.attr("id") ?? "part_1";
  usedPaths.add(rootStructuralPath);
  const rootHeadingText = normalizeText(textExcludingGlossLinks(rootPartDiv.children("h2").first())) || "Treść ustawy";
  ordinal += 1;
  results.push({
    id: rootId,
    parentId: null,
    provisionType: "part",
    article: null,
    paragraph: null,
    point: null,
    letter: null,
    citationLabel: rootHeadingText,
    heading: rootHeadingText,
    text: rootHeadingText,
    structuralPath: rootStructuralPath,
    ordinal,
  });

  for (const child of rootPartDiv.children(".block").children(".unit").toArray()) {
    const $child = $(child);
    const childTypeKey = ($child.attr("class") ?? "").match(/unit_([a-zA-Zł]+)/)?.[1] ?? "";
    walkUnit($child, rootId, rootStructuralPath, rootHeadingText, childTypeKey);
  }

  return results;
}
