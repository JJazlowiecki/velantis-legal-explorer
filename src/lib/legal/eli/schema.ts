import { z } from "zod";

export const ELI_SOURCE = "sejm_eli" as const;
export const ELI_API_BASE_URL = "https://api.sejm.gov.pl" as const;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date in YYYY-MM-DD format");

const dateTimeString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/,
    "Expected datetime in YYYY-MM-DDTHH:mm:ss format",
  );

export const eliTextFileSchema = z.object({
  fileName: z.string().min(1),
  type: z.string().min(1).optional(),
});

export const eliActMetadataSchema = z.object({
  publisher: z.string().min(1),
  year: z.number().int().positive(),
  pos: z.number().int().positive(),
  title: z.string().min(1),
  type: z.string().min(1).optional(),
  announcementDate: dateString.optional(),
  promulgation: dateString.optional(),
  entryIntoForce: dateString.optional(),
  validFrom: dateString.optional(),
  /**
   * Official "data stanu prawnego" — the date up to which amendments are incorporated into THIS
   * document's text. Confirmed (current-law-corpus spike, 2026-08-09) to consistently precede
   * `announcementDate`/`promulgation`, matching the real drafting process. This is the correct,
   * already-official source for a consolidated version's `legalStateDate` — never derive our own.
   */
  legalStatusDate: dateString.optional(),
  /**
   * Set once THIS specific document (e.g. a consolidated-text announcement) has been superseded
   * by a newer one. Confirmed to equal the promulgation date of the next announcement in the
   * chain — a deterministic "is this still the newest" signal, preferred over the free-text
   * `status` field (see current-law-corpus spike reports).
   */
  expirationDate: dateString.optional(),
  changeDate: dateTimeString.optional(),
  status: z.string().optional(),
  inForce: z.union([z.string(), z.boolean()]).optional(),
  ELI: z.string().optional(),
  textHTML: z.boolean().optional(),
  textPDF: z.boolean().optional(),
  texts: z.array(eliTextFileSchema).optional(),
});

export type EliActMetadata = z.infer<typeof eliActMetadataSchema>;

export type LegalActVersionKind = "promulgated" | "consolidated" | "unified" | "unknown";
export type OfficialEliExpressionId = "ogl" | "tj" | "uj";
export type ExpressionAuthorityClass = "authoritative" | "non_authoritative" | "unknown";
export type CurrentnessStatus = "proven_current" | "unproven";

export function parseEliActMetadata(input: unknown): EliActMetadata {
  return eliActMetadataSchema.parse(input);
}

/**
 * A related act as embedded inside an ELI `/references` entry — deliberately a lenient subset
 * of {@link eliActMetadataSchema} (only the fields this pipeline actually consults) with unknown
 * extra fields passed through rather than stripped, so an upstream field addition can never
 * crash relation ingestion.
 */
export const eliReferenceActSummarySchema = z
  .object({
    publisher: z.string().min(1),
    year: z.number().int().positive(),
    pos: z.number().int().positive(),
    title: z.string().min(1),
    type: z.string().min(1).optional(),
    status: z.string().optional(),
    promulgation: dateString.optional(),
    announcementDate: dateString.optional(),
    ELI: z.string().optional(),
  })
  .loose();

export type EliReferenceActSummary = z.infer<typeof eliReferenceActSummarySchema>;

const eliReferenceEntrySchema = z
  .object({
    act: eliReferenceActSummarySchema,
    date: dateString.optional(),
  })
  .loose();

export type EliReferenceEntry = z.infer<typeof eliReferenceEntrySchema>;

/**
 * The full `/references` payload: a map keyed by the ELI relation's Polish display label (e.g.
 * "Inf. o tekście jednolitym") to a list of related-act entries. Keys are NOT enumerated/closed
 * — ELI may return labels this pipeline doesn't yet recognize, and `z.record` accepts any of
 * them; unrecognized labels are handled (never dropped, never crash) by the relation-mapping
 * layer (see relations.ts), not by this schema.
 */
export const eliActReferencesSchema = z.record(z.string(), z.array(eliReferenceEntrySchema));

export type EliActReferences = z.infer<typeof eliActReferencesSchema>;

export function parseEliActReferences(input: unknown): EliActReferences {
  return eliActReferencesSchema.parse(input);
}
