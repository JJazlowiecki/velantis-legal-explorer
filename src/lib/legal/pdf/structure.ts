import { randomUUID } from "node:crypto";

import type { ParsedProvision } from "../eli/structure";
import type { PdfTextLine } from "./extract";

export class PdfStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfStructureError";
  }
}

/**
 * Thrown when the "Załącznik do obwieszczenia ..." heading that marks the start of the actual
 * consolidated statute (as distinct from the announcement's own administrative preamble, which
 * always precedes it in these PDFs) doesn't resolve to exactly one line. Fail-closed, mirroring
 * eli/structure.ts's AnnexSelectionError for the HTML path — never guess which page the real law
 * starts on.
 */
export class PdfAnnexSelectionError extends PdfStructureError {
  constructor(
    message: string,
    public readonly matchCount: number,
  ) {
    super(message);
  }
}

const ANNEX_HEADING_PATTERN = /^Za[łl]ącznik do obwieszczenia\b/i;

/**
 * Verified live against the real Dz.U. 2026 poz. 795 (Kodeks cywilny) PDF: every page repeats
 * "Dziennik Ustaw – N – Poz. M" and a bare "YYYY-MM-DD" print date as separate lines (the page-1
 * cover uses "©Kancelaria Sejmu s. N/M" instead). None of these carry legal content — dropping
 * them is pure publication-artefact removal, never a guess about content.
 */
const HEADER_FOOTER_PATTERNS: RegExp[] = [
  /^Dziennik Ustaw\s*[–-]\s*\d+\s*[–-]\s*Poz\.\s*\d+\.?$/,
  /^©\s*Kancelaria Sejmu\s+s\.\s*\d+\/\d+$/,
  /^\d{4}-\d{2}-\d{2}$/,
];

/**
 * The "added article" superscript index (the well-known "Art. 43⁹"/"Art. 39³" convention used
 * throughout Polish codes for a provision inserted between two originally-numbered articles by a
 * later amendment) renders in plain-text PDF extraction as EITHER a bracketed digit run ("[9]",
 * observed live in the KC PDF) OR a bare digit run with no punctuation at all ("3", observed live
 * in the KPA PDF for "Art. 39" + "3" + ". § 1 ..." = the real "Art. 39³") — the same semantic
 * marker, two different renderings depending on the document's typesetting. Both are normalized
 * to the SAME bracketed DB convention ("39[3]") regardless of source rendering, so citationLabel
 * format never depends on which act/PDF-era a provision came from.
 *
 * The bare-digit form is NOT itself distinguishable from a footnote reference marker by pattern
 * alone (both are small-font digit runs) — it is disambiguated the same way the bracketed form
 * is: only recognized when it immediately follows a bare, not-yet-terminated "Art. N" fragment
 * (see the lookback check in stripBoilerplateAndFootnotes). A genuine footnote marker always has
 * a trailing ")" AND never follows an unterminated "Art. N" line, so there is no real collision.
 */
const ADDED_ARTICLE_INDEX_BRACKETED_PATTERN = /^\[(\d+)\]$/;
const ADDED_ARTICLE_INDEX_BARE_PATTERN = /^(\d+)$/;

// NOTE: `\b` after a Polish-diacritic letter (ł, ć, ę, ś, ź, ż, ń, ą, ó) is NOT reliable in JS
// regex — `\w`/`\b` are ASCII-only by default, so e.g. `/^Dział\b/` silently fails to match
// "Dział I" (verified live: `ł` is not a `\w` character, so no boundary is asserted between it
// and the following space). An explicit whitespace-or-end lookahead sidesteps this entirely
// rather than depending on JS's word-boundary semantics for non-ASCII text.
const CONTAINER_PATTERNS: { provisionType: string; noun: string; pattern: RegExp }[] = [
  { provisionType: "book", noun: "Księga", pattern: /^Księga(?=\s|$)/i },
  { provisionType: "part_division", noun: "Część", pattern: /^Część(?=\s|$)/i },
  { provisionType: "title", noun: "Tytuł", pattern: /^Tytuł(?=\s|$)/i },
  { provisionType: "division", noun: "Dział", pattern: /^Dział(?=\s|$)/i },
  { provisionType: "chapter", noun: "Rozdział", pattern: /^Rozdział(?=\s|$)/i },
  { provisionType: "subchapter", noun: "Oddział", pattern: /^Oddział(?=\s|$)/i },
];

// A trailing lowercase letter RUN ("1a", "39a", "1aa" — verified live in KK, a double-letter
// suffix for a unit inserted between two already-lettered siblings by a still-later amendment)
// marks a unit inserted between two originally-numbered siblings. Allowed generically at every
// level, not just articles, mirroring the existing DB citation convention for letter-suffixed
// articles (e.g. the pre-existing "art. 24a" support in citation.ts) — `*` (zero or more), not
// `?` (zero or one), specifically because the single-letter assumption was proven wrong live.
const ARTICLE_PATTERN = /^Art\.\s*(\d+[a-ząćęłńóśźż]*(?:\[\d+\])?)\.\s*(.*)$/i;
const PARAGRAPH_SIGN_PATTERN = /^§\s*(\d+[a-ząćęłńóśźż]*)\.\s*(.*)$/;
const CLAUSE_NUMBER_PATTERN = /^(\d+[a-ząćęłńóśźż]*)\.\s*(.*)$/;
const POINT_PATTERN = /^(\d+[a-ząćęłńóśźż]*)\)\s*(.*)$/;
const LETTER_PATTERN = /^([a-ząćęłńóśźż])\)\s*(.*)$/;

interface LogicalLine {
  page: number;
  text: string;
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Drops page header/footer boilerplate and the footnote apparatus (both the small superscript
 * reference markers and the small-font footnote definition text at the bottom of a page), while
 * recognizing and merging the ONE small-font pattern that is real legal content: the
 * "[N]"-bracketed added-article index. Verified live: body text is set at one dominant font
 * size across the whole document; footnote markers/definitions are set smaller. This is a
 * genuine typographic distinction in the source, not an invented heuristic — see the sibling
 * `extract.ts` module for how fontSize is computed per line.
 *
 * Never silently drops BODY content: every line either survives as body text or is positively
 * matched as boilerplate/footnote-apparatus by one of the patterns above.
 */
export function stripBoilerplateAndFootnotes(
  lines: (PdfTextLine & { fontSize: number })[],
): LogicalLine[] {
  const bodyFontSize = mostCommon(lines.map((l) => Math.round(l.fontSize)));
  const result: LogicalLine[] = [];
  let justMergedAddedArticleIndex = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.text.trim();
    if (trimmed.length === 0) continue;
    if (HEADER_FOOTER_PATTERNS.some((p) => p.test(trimmed))) continue;

    const prevIsBareArticleFragment =
      result.length > 0 && /^Art\.\s*\d+[a-ząćęłńóśźż]?$/i.test(result[result.length - 1].text.trim());
    const isSmallFont = Math.round(line.fontSize) < bodyFontSize;

    if (isSmallFont && prevIsBareArticleFragment) {
      const bracketed = ADDED_ARTICLE_INDEX_BRACKETED_PATTERN.exec(trimmed);
      const bare = ADDED_ARTICLE_INDEX_BARE_PATTERN.exec(trimmed);
      const index = bracketed?.[1] ?? bare?.[1];
      if (index) {
        // Merge into the previous logical line (the "Art. N" fragment with no trailing period
        // yet), normalized to the bracketed DB convention regardless of source rendering —
        // reconstructs "Art. 43[9]" so ARTICLE_PATTERN below can match it as one unit.
        const prev = result[result.length - 1];
        prev.text = `${prev.text.trim()}[${index}]`;
        justMergedAddedArticleIndex = true;
        continue;
      }
    }

    if (isSmallFont) {
      // Footnote reference marker or footnote definition text — never part of operative law.
      continue;
    }

    // The superscript index sits at a raised baseline, so the sentence-terminating "." that
    // follows it renders as a THIRD line back at the normal baseline (verified live: "Art. 43" /
    // "[9]" / ". § 1. Firma nie może być zbyta." are three separate pdf.js line-groups even
    // though they are one logical sentence). Absorb a leading-"." continuation immediately after
    // a just-merged added-article index back into the same logical line, never left dangling.
    if (justMergedAddedArticleIndex && /^\.\s*/.test(trimmed)) {
      const prev = result[result.length - 1];
      prev.text = `${prev.text.trim()}${trimmed}`;
      justMergedAddedArticleIndex = false;
      continue;
    }
    justMergedAddedArticleIndex = false;

    result.push({ page: line.page, text: trimmed });
  }

  return result;
}

/**
 * Joins a footnote-/boilerplate-free line stream into logical paragraphs: a line ending in a
 * hyphenated word-wrap ("rolni-" / "czej" -> "rolnicze") is joined without a space and the
 * hyphen dropped; every other line-continuation (i.e. a line that doesn't itself start a new
 * structural unit) is joined with a single space. Structural-unit-starting lines are never
 * joined into the previous logical line — they always begin a new one.
 */
function isStructuralStart(text: string): boolean {
  return (
    CONTAINER_PATTERNS.some((c) => c.pattern.test(text)) ||
    ARTICLE_PATTERN.test(text) ||
    PARAGRAPH_SIGN_PATTERN.test(text) ||
    CLAUSE_NUMBER_PATTERN.test(text) ||
    POINT_PATTERN.test(text) ||
    LETTER_PATTERN.test(text)
  );
}

const HYPHEN_WRAP_PATTERN = /(\p{L})-$/u;

export function joinLogicalParagraphs(lines: LogicalLine[]): string[] {
  const paragraphs: string[] = [];
  let current: string | null = null;

  for (const line of lines) {
    if (current !== null && !isStructuralStart(line.text)) {
      const hyphenMatch = HYPHEN_WRAP_PATTERN.exec(current);
      current = hyphenMatch ? `${current.slice(0, -1)}${line.text}` : `${current} ${line.text}`;
      continue;
    }
    if (current !== null) paragraphs.push(current);
    current = line.text;
  }
  if (current !== null) paragraphs.push(current);

  return paragraphs;
}

interface OpenUnit {
  id: string;
  provisionType: string;
  depth: number;
  path: string;
  textParts: string[];
  provision: ParsedProvision;
}

const CONTAINER_DEPTH: Record<string, number> = {
  book: 0,
  part_division: 1,
  title: 2,
  division: 3,
  chapter: 4,
  subchapter: 5,
};
const ARTICLE_DEPTH = 6;
const PARAGRAPH_DEPTH = 7;
const POINT_DEPTH = 8;
const LETTER_DEPTH = 9;

/**
 * Deterministic structural parser for the official Sejm "text/T" consolidated-statute PDF
 * attachment: takes the already-boilerplate/footnote-free logical paragraph stream (see
 * stripBoilerplateAndFootnotes + joinLogicalParagraphs) starting from the "Załącznik do
 * obwieszczenia ..." heading, and reconstructs the SAME flat, pre-order ParsedProvision[] shape
 * eli/structure.ts produces from HTML — so replaceProvisionsForVersion, indexing, embeddings,
 * and citation matching are reused completely unchanged regardless of source format.
 *
 * A regex-pattern hierarchy over a flat, ordered text stream is inherently less rigorous than
 * the HTML path's direct DOM-tree mapping: a numbered-clause line ("1. ...") is recognized by
 * pattern, not by markup, so a body sentence that happened to literally start a fresh line with
 * "N. " could misparse. This is a known, documented limitation (never silently hidden) — see
 * the cross-validation checks in structure.test.ts and the PDF ingest report.
 */
export function parseConsolidatedPdfText(rawLines: (PdfTextLine & { fontSize: number })[]): ParsedProvision[] {
  const annexIndex = rawLines.findIndex((l) => ANNEX_HEADING_PATTERN.test(l.text.trim()));
  const matchCount = rawLines.filter((l) => ANNEX_HEADING_PATTERN.test(l.text.trim())).length;
  if (matchCount !== 1) {
    throw new PdfAnnexSelectionError(
      `Expected exactly one "Załącznik do obwieszczenia" heading marking the start of the consolidated text, found ${matchCount}`,
      matchCount,
    );
  }

  const stripped = stripBoilerplateAndFootnotes(rawLines.slice(annexIndex));
  const paragraphs = joinLogicalParagraphs(stripped);

  const results: ParsedProvision[] = [];
  const stack: OpenUnit[] = [];
  const usedPaths = new Set<string>();
  let ordinal = 0;

  function uniquePath(candidate: string): string {
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
    const disambiguated = `${candidate}#${ordinal}`;
    usedPaths.add(disambiguated);
    return disambiguated;
  }

  function closeToDepth(depth: number) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      const closed = stack.pop()!;
      closed.provision.text = closed.textParts.join(" ").trim();
    }
  }

  function currentParentId(): string | null {
    return stack.length > 0 ? stack[stack.length - 1].id : null;
  }

  function currentParentCitationLabel(): string {
    return stack.length > 0 ? stack[stack.length - 1].provision.citationLabel : "";
  }

  function pushUnit(depth: number, provisionType: string, heading: string, citationLabel: string, fields: Partial<ParsedProvision>) {
    closeToDepth(depth);
    ordinal += 1;
    const id = randomUUID();
    const parentPath = stack.length > 0 ? stack[stack.length - 1].path : "";
    const path = uniquePath(parentPath ? `${parentPath}/${provisionType}_${ordinal}` : `${provisionType}_${ordinal}`);
    const provision: ParsedProvision = {
      id,
      parentId: currentParentId(),
      provisionType,
      article: fields.article ?? null,
      paragraph: fields.paragraph ?? null,
      point: fields.point ?? null,
      letter: fields.letter ?? null,
      citationLabel,
      heading,
      text: "",
      structuralPath: path,
      ordinal,
    };
    results.push(provision);
    stack.push({ id, provisionType, depth, path, textParts: heading ? [heading] : [], provision });
  }

  function appendToDeepest(text: string) {
    if (stack.length === 0) return; // no open unit yet (e.g. stray line before first heading) — dropped, never fabricated
    stack[stack.length - 1].textParts.push(text);
  }

  // A single source line very often carries MORE than one nesting level at once (e.g.
  // "Art. 8. § 1. Każdy człowiek ..." — article heading AND its first clause on one line), so
  // each segment is processed recursively: extract the leading structural marker (if any),
  // open that unit, then re-process whatever text remains after it for a FURTHER nested marker,
  // continuing until nothing more matches. `closeToDepth` always runs before a citationLabel is
  // computed from the (now-correct) parent, never after — computing it before closing would read
  // a stale, already-superseded sibling as if it were still the parent (a real bug this ordering
  // exists specifically to prevent).
  function processSegment(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const container = CONTAINER_PATTERNS.find((c) => c.pattern.test(trimmed));
    if (container) {
      closeToDepth(CONTAINER_DEPTH[container.provisionType]);
      pushUnit(CONTAINER_DEPTH[container.provisionType], container.provisionType, trimmed, trimmed, {});
      return;
    }

    const articleMatch = ARTICLE_PATTERN.exec(trimmed);
    if (articleMatch) {
      const number = articleMatch[1];
      closeToDepth(ARTICLE_DEPTH);
      pushUnit(ARTICLE_DEPTH, "article", `Art. ${number}.`, `art. ${number}`, { article: number });
      processSegment(articleMatch[2]);
      return;
    }

    const paragraphSignMatch = PARAGRAPH_SIGN_PATTERN.exec(trimmed);
    if (paragraphSignMatch && stack.some((u) => u.depth === ARTICLE_DEPTH)) {
      const number = paragraphSignMatch[1];
      closeToDepth(PARAGRAPH_DEPTH);
      pushUnit(PARAGRAPH_DEPTH, "paragraph", `§ ${number}.`, `${currentParentCitationLabel()} § ${number}`, { paragraph: number });
      processSegment(paragraphSignMatch[2]);
      return;
    }

    const clauseMatch = CLAUSE_NUMBER_PATTERN.exec(trimmed);
    if (clauseMatch && stack.some((u) => u.depth === ARTICLE_DEPTH)) {
      const number = clauseMatch[1];
      closeToDepth(PARAGRAPH_DEPTH);
      pushUnit(PARAGRAPH_DEPTH, "clause", `${number}.`, `${currentParentCitationLabel()} ust. ${number}`, { paragraph: number });
      processSegment(clauseMatch[2]);
      return;
    }

    const pointMatch = POINT_PATTERN.exec(trimmed);
    if (pointMatch && stack.some((u) => u.depth === ARTICLE_DEPTH)) {
      const number = pointMatch[1];
      closeToDepth(POINT_DEPTH);
      pushUnit(POINT_DEPTH, "point", `${number})`, `${currentParentCitationLabel()} pkt ${number}`, { point: number });
      processSegment(pointMatch[2]);
      return;
    }

    const letterMatch = LETTER_PATTERN.exec(trimmed);
    if (letterMatch && stack.some((u) => u.depth === POINT_DEPTH)) {
      const letter = letterMatch[1];
      closeToDepth(LETTER_DEPTH);
      pushUnit(LETTER_DEPTH, "letter", `${letter})`, `${currentParentCitationLabel()} lit. ${letter}`, { letter });
      processSegment(letterMatch[2]);
      return;
    }

    appendToDeepest(trimmed);
  }

  for (const paragraph of paragraphs) {
    processSegment(paragraph);
  }
  closeToDepth(0);

  return results;
}
