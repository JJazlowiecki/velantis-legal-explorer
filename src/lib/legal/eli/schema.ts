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
  changeDate: dateTimeString.optional(),
  legalStatusDate: dateString.optional(),
  status: z.string().optional(),
  inForce: z.union([z.string(), z.boolean()]).optional(),
  ELI: z.string().optional(),
  textHTML: z.boolean().optional(),
  textPDF: z.boolean().optional(),
  texts: z.array(eliTextFileSchema).optional(),
});

export type EliActMetadata = z.infer<typeof eliActMetadataSchema>;

export interface EliStructNode {
  id: string;
  symbol?: string;
  type?: string;
  name?: string;
  title?: string;
  children?: EliStructNode[];
}

export const eliStructNodeSchema: z.ZodType<EliStructNode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      symbol: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      children: z.array(eliStructNodeSchema).optional(),
    })
    .passthrough(),
);

export const eliStructResponseSchema = z.array(eliStructNodeSchema);
export type EliStructResponse = z.infer<typeof eliStructResponseSchema>;

export type LegalActVersionKind = "promulgated" | "consolidated" | "unified" | "unknown";
export type OfficialEliExpressionId = "ogl" | "tj" | "uj";
export type ExpressionAuthorityClass = "authoritative" | "non_authoritative" | "unknown";
export type CurrentnessStatus = "proven_current" | "unproven";

export function parseEliActMetadata(input: unknown): EliActMetadata {
  return eliActMetadataSchema.parse(input);
}

export function parseEliActStruct(input: unknown): EliStructResponse {
  return eliStructResponseSchema.parse(input);
}
