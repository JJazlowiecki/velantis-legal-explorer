import { createHash } from "node:crypto";

/**
 * The subset of a parsed/stored provision that determines its LEGAL meaning — deliberately
 * excludes anything DB-generated or accidental: no `id`/`parentId` (random UUIDs, regenerated on
 * every parse), no ordinal (implied by array order after sorting), no timestamps. `structuralPath`
 * already fully encodes the provision's tree position (it's built from the parent's own path plus
 * this node's stable source `data-id`, never from a random id), so hierarchy is captured without
 * needing parentId at all.
 */
export interface ContentHashableProvision {
	structuralPath: string;
	provisionType: string;
	citationLabel: string;
	heading: string | null;
	text: string;
	article: string | null;
	paragraph: string | null;
	point: string | null;
	letter: string | null;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/**
 * Deterministic SHA-256 fingerprint of a parsed act's legal structure: same semantic content
 * (citations, hierarchy, operative text) always produces the same hash, regardless of DB row
 * insertion order, generated UUIDs, or timestamps. A structural/textual change — e.g. the
 * unit_pass parser fix recovering previously-lost ustęp text — always produces a DIFFERENT hash.
 *
 * This is the real content-revision identity behind `legal_act_versions.contentHash`: it is what
 * lets `ingestOfficialConsolidatedStructure` tell "re-running with unchanged parser output"
 * (same hash → idempotently reuse the existing immutable version) apart from "the parser now
 * produces materially different content" (different hash → a NEW immutable version, never a
 * destructive replace of the old one).
 */
export function computeParsedContentHash(provisions: readonly ContentHashableProvision[]): string {
	const canonical = [...provisions]
		.sort((a, b) => a.structuralPath.localeCompare(b.structuralPath))
		.map((p) => ({
			structuralPath: p.structuralPath,
			provisionType: p.provisionType,
			citationLabel: p.citationLabel,
			heading: p.heading,
			text: p.text,
			article: p.article,
			paragraph: p.paragraph,
			point: p.point,
			letter: p.letter,
		}));

	return createHash("sha256").update(stableStringify(canonical), "utf8").digest("hex");
}
