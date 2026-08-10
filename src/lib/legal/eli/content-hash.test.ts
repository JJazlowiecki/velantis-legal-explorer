import { describe, expect, it } from "vitest";

import { computeParsedContentHash, type ContentHashableProvision } from "./content-hash";

const ART_6: ContentHashableProvision = {
	structuralPath: "part_1/arti_6",
	provisionType: "article",
	citationLabel: "art. 6",
	heading: "Art. 6.",
	text: "Art. 6.",
	article: "6",
	paragraph: null,
	point: null,
	letter: null,
};

const ART_6_UST_1: ContentHashableProvision = {
	structuralPath: "part_1/arti_6/pass_1",
	provisionType: "clause",
	citationLabel: "art. 6 ust. 1",
	heading: "1.",
	text: "1. Producentowi bazy danych przysługuje wyłączne i zbywalne prawo pobierania danych.",
	article: null,
	paragraph: "1",
	point: null,
	letter: null,
};

describe("computeParsedContentHash", () => {
	it("A: is deterministic — the same semantic structure always produces the same hash", () => {
		const hash1 = computeParsedContentHash([ART_6, ART_6_UST_1]);
		const hash2 = computeParsedContentHash([ART_6, ART_6_UST_1]);
		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is insensitive to input array order (canonicalized by structuralPath)", () => {
		const hash1 = computeParsedContentHash([ART_6, ART_6_UST_1]);
		const hash2 = computeParsedContentHash([ART_6_UST_1, ART_6]);
		expect(hash1).toBe(hash2);
	});

	it("B: a missing-vs-present ustęp (the exact unit_pass regression) produces a DIFFERENT hash", () => {
		const beforeParserFix = computeParsedContentHash([ART_6]); // old parser: text lost, no clause node
		const afterParserFix = computeParsedContentHash([ART_6, ART_6_UST_1]); // new parser: ustęp recovered
		expect(beforeParserFix).not.toBe(afterParserFix);
	});

	it("changing only the operative text changes the hash", () => {
		const changed: ContentHashableProvision = { ...ART_6_UST_1, text: `${ART_6_UST_1.text} Extra clause.` };
		expect(computeParsedContentHash([ART_6, ART_6_UST_1])).not.toBe(computeParsedContentHash([ART_6, changed]));
	});

	it("changing only structuralPath (hierarchy position) changes the hash", () => {
		const moved: ContentHashableProvision = { ...ART_6_UST_1, structuralPath: "part_1/arti_7/pass_1" };
		expect(computeParsedContentHash([ART_6, ART_6_UST_1])).not.toBe(computeParsedContentHash([ART_6, moved]));
	});

	it("is never based on accidental fields like id/parentId/ordinal (not part of the hashable shape at all)", () => {
		// ContentHashableProvision's type itself excludes id/parentId/ordinal — this test
		// documents that guarantee by constructing two "different DB rows" with identical
		// semantic content and confirming they hash identically regardless of array identity.
		const rowA = { ...ART_6 };
		const rowB = { ...ART_6 }; // a distinct object, same semantic content
		expect(computeParsedContentHash([rowA])).toBe(computeParsedContentHash([rowB]));
	});

	// The exact real-world gloss-link footnote-exclusion fix (structure.ts): a root "part"
	// heading/text field previously contaminated with an inline legislative-footnote gloss (the
	// real DU/2024/1769 database-protection act shape), vs. the corrected parse with the
	// gloss-link's marker+tooltip body excluded.
	const MALFORMED_ANNEX_ROOT: ContentHashableProvision = {
		structuralPath: "part_2",
		provisionType: "part",
		citationLabel:
			"Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa1)Niniejsza ustawa dokonuje wdrożenia dyrektywy 96/9/WE.",
		heading:
			"Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa1)Niniejsza ustawa dokonuje wdrożenia dyrektywy 96/9/WE.",
		text:
			"Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa1)Niniejsza ustawa dokonuje wdrożenia dyrektywy 96/9/WE.",
		article: null,
		paragraph: null,
		point: null,
		letter: null,
	};

	const CORRECTED_ANNEX_ROOT: ContentHashableProvision = {
		...MALFORMED_ANNEX_ROOT,
		citationLabel: "Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa",
		heading: "Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa",
		text: "Załącznik - Tekst jednolity ustawy z dnia 1 stycznia 2000 r. Ustawa testowa",
	};

	it("9: contentHash changes when correcting an already-malformed parsed structure (gloss-link footnote fix)", () => {
		const beforeFix = computeParsedContentHash([MALFORMED_ANNEX_ROOT, ART_6]);
		const afterFix = computeParsedContentHash([CORRECTED_ANNEX_ROOT, ART_6]);
		expect(beforeFix).not.toBe(afterFix);
	});

	it("10: the same corrected source parsed twice produces the SAME hash — re-ingestion would idempotently reuse the one new immutable revision, never create version churn", () => {
		const firstParse = computeParsedContentHash([CORRECTED_ANNEX_ROOT, ART_6]);
		const secondParse = computeParsedContentHash([{ ...CORRECTED_ANNEX_ROOT }, { ...ART_6 }]);
		expect(firstParse).toBe(secondParse);
	});
});
