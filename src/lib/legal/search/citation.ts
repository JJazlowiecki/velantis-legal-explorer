export interface ParsedLegalCitation {
  article: string | null;
  paragraph: string | null;
  point: string | null;
  letter: string | null;
}

const ARTICLE_RE = /\bart\.?\s*(\d+[a-z]?)\b/i;
const SECTION_RE = /§\s*(\d+[a-z]?)\b/i;
const USTEP_RE = /\bust\.?\s*(\d+[a-z]?)\b/i;
const PUNKT_RE = /\bpkt\.?\s*(\d+[a-z]?)\b/i;
const LETTER_RE = /\blit\.?\s*([a-z])\b/i;

/**
 * Recognizes common Polish legal citation shorthand (e.g. "art. 471", "art. 5 ust. 2",
 * "§ 4 ust. 2 pkt 3"). This is intentionally not a full citation grammar — see
 * project notes. Acts numbered by "§" instead of "art." use "§" as the top-level
 * unit, so "§ N ust. M" maps § to the `article` field and "ust." to `paragraph`;
 * a bare "§ N" with no following "ust." is treated as a paragraph number search
 * across any article.
 */
export function parseExactCitation(rawQuery: string): ParsedLegalCitation | null {
  const query = rawQuery.trim();
  if (!query) {
    return null;
  }

  const articleMatch = ARTICLE_RE.exec(query);
  const sectionMatch = SECTION_RE.exec(query);
  const ustepMatch = USTEP_RE.exec(query);
  const punktMatch = PUNKT_RE.exec(query);
  const letterMatch = LETTER_RE.exec(query);

  let article: string | null = null;
  let paragraph: string | null = null;

  if (articleMatch) {
    article = articleMatch[1];
    paragraph = (sectionMatch ?? ustepMatch)?.[1] ?? null;
  } else if (sectionMatch) {
    if (ustepMatch) {
      article = sectionMatch[1];
      paragraph = ustepMatch[1];
    } else {
      paragraph = sectionMatch[1];
    }
  } else if (ustepMatch) {
    paragraph = ustepMatch[1];
  }

  const point = punktMatch?.[1] ?? null;
  const letter = letterMatch?.[1]?.toLowerCase() ?? null;

  if (!article && !paragraph && !point && !letter) {
    return null;
  }

  return { article, paragraph, point, letter };
}
