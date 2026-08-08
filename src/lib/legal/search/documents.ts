import { createHash } from "node:crypto";

const SYSTEMATIC_CONTAINER_TYPES = new Set([
  "part",
  "book",
  "title",
  "division",
  "chapter",
  "section",
]);

export interface SearchableProvisionInput {
  provisionType: string;
  heading: string | null;
  text: string;
}

/**
 * Purely systematic nodes (parts/books/titles/divisions/chapters) and container
 * articles whose own text is just a duplicate of their heading (e.g. "Art. 353."
 * with all content living in its child paragraphs) carry no independent operative
 * text and are excluded from the search index.
 */
export function isSearchableProvision(provision: SearchableProvisionInput): boolean {
  if (provision.provisionType.startsWith("unknown")) {
    return false;
  }

  if (SYSTEMATIC_CONTAINER_TYPES.has(provision.provisionType)) {
    return false;
  }

  const text = provision.text.trim();
  if (!text) {
    return false;
  }

  const heading = (provision.heading ?? "").trim();
  if (heading && text === heading) {
    return false;
  }

  return true;
}

export interface BuildSearchDocumentContentInput {
  actTitle: string;
  ancestorHeadings: string[];
  citationLabel: string;
  text: string;
}

export function buildSearchDocumentContent(input: BuildSearchDocumentContentInput): string {
  const lines = [
    input.actTitle.trim(),
    ...input.ancestorHeadings.map((heading) => heading.trim()).filter((heading) => heading.length > 0),
    input.citationLabel.trim(),
    input.text.trim(),
  ].filter((line) => line.length > 0);

  return lines.join("\n");
}

export function hashSearchDocumentContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
