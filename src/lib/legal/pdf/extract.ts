import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

/**
 * One reconstructed visual line of PDF text: every text item on the same page whose baseline Y
 * coordinate falls within LINE_Y_TOLERANCE of each other, joined in horizontal reading order.
 * `fontSize` is the size of the FIRST item on the line — sufficient here because every line this
 * parser cares about (body text, footnote markers, footnote definitions) is visually
 * single-styled; a line mixing a superscript marker with body text is exactly the case
 * structure.ts's mergeFootnoteMarkerIntoHeading handles explicitly, never by trusting this field
 * on a mixed line.
 */
export interface PdfTextLine {
  page: number;
  /** PDF user-space Y coordinate (points from the page bottom) — NOT a line index. Two lines on
   * different pages can share a Y; page must always be compared first. */
  y: number;
  fontSize: number;
  text: string;
}

interface PdfjsTextItem {
  str?: string;
  transform: number[];
}

const LINE_Y_TOLERANCE = 2;

/**
 * Deterministic, page-boundary-preserving text extraction: every item pdf.js reports is placed
 * on exactly one page/line, in the order pdf.js emits them (which — for the born-digital,
 * single-column Dziennik Ustaw layout this module targets — is left-to-right, top-to-bottom
 * reading order; see structure.ts's doc comment for why this assumption was verified, not
 * guessed). No text is silently dropped: every `item.str` present in the source is folded into
 * exactly one returned line.
 */
export async function extractPdfLines(pdfBytes: Uint8Array): Promise<PdfTextLine[]> {
  const doc = await getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
  const lines: PdfTextLine[] = [];

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();

      let currentY: number | null = null;
      let currentFontSize: number | null = null;
      let currentParts: string[] = [];

      const flush = () => {
        if (currentParts.length > 0 && currentY !== null && currentFontSize !== null) {
          lines.push({ page: pageNum, y: currentY, fontSize: currentFontSize, text: currentParts.join("") });
        }
        currentParts = [];
      };

      for (const rawItem of content.items as unknown[]) {
        const item = rawItem as PdfjsTextItem;
        if (typeof item.str !== "string") {
          continue;
        }
        const y = Math.round(item.transform[5]);
        // Font size = the magnitude of the text-rendering matrix's vertical scale component —
        // robust to rotation/skew in a way that transform[3] alone is not.
        const fontSize = Math.round(Math.hypot(item.transform[0], item.transform[1]) * 10) / 10;

        if (currentY === null || Math.abs(y - currentY) > LINE_Y_TOLERANCE) {
          flush();
          currentY = y;
          currentFontSize = fontSize;
        }
        currentParts.push(item.str);
      }
      flush();
    }
  } finally {
    // Runtime-present cleanup method not declared on this build's PDFDocumentProxy type.
    const destroyable = doc as unknown as { destroy?: () => Promise<void> };
    if (typeof destroyable.destroy === "function") {
      await destroyable.destroy();
    }
  }

  if (lines.length === 0) {
    throw new PdfExtractionError(
      "Extracted zero text lines from the supplied PDF — likely a scanned/image-only document (no text layer), which this deterministic extractor deliberately refuses to OCR",
    );
  }

  return lines;
}
