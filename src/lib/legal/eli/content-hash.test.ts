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
});
