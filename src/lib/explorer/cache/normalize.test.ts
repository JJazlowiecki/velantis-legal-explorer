import { describe, expect, it } from "vitest";

import { hashNormalizedQuestion, normalizeQuestionForCache } from "./normalize";

describe("normalizeQuestionForCache", () => {
	it("collapses whitespace/case variants of the same question to the same normalized form", () => {
		const a = normalizeQuestionForCache("Kto może oddać krew?");
		const b = normalizeQuestionForCache("KTO   MOŻE   ODDAĆ KREW?");
		const c = normalizeQuestionForCache("  kto może oddać krew?  ");
		expect(a).toBe(b);
		expect(a).toBe(c);
	});

	it("treats a Unicode NFKC-equivalent form as identical (e.g. fullwidth vs. ASCII digits)", () => {
		const ascii = normalizeQuestionForCache("Art. 15 warunki");
		const fullwidth = normalizeQuestionForCache("Art. １５ warunki"); // fullwidth "15"
		expect(ascii).toBe(fullwidth);
	});

	it("keeps a semantically different (negated) question distinct", () => {
		const a = normalizeQuestionForCache("Kto może oddać krew?");
		const b = normalizeQuestionForCache("Kto nie może oddać krwi?");
		expect(a).not.toBe(b);
	});

	it("keeps a differently-worded question distinct even on the same topic", () => {
		const a = normalizeQuestionForCache("Kto może oddać krew w Polsce?");
		const b = normalizeQuestionForCache("Jakie warunki musi spełnić dawca krwi?");
		expect(a).not.toBe(b);
	});

	it("does not remove punctuation in a meaning-changing way", () => {
		const withQuestionMark = normalizeQuestionForCache("Kto może oddać krew?");
		const withoutQuestionMark = normalizeQuestionForCache("Kto może oddać krew");
		expect(withQuestionMark).not.toBe(withoutQuestionMark);
	});
});

describe("hashNormalizedQuestion", () => {
	it("produces the same SHA-256 hex digest for the same normalized input", () => {
		const normalized = normalizeQuestionForCache("Kto może oddać krew?");
		expect(hashNormalizedQuestion(normalized)).toBe(hashNormalizedQuestion(normalized));
	});

	it("produces a 64-character lowercase hex digest", () => {
		const hash = hashNormalizedQuestion(normalizeQuestionForCache("Kto może oddać krew?"));
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("produces different hashes for different normalized questions", () => {
		const hashA = hashNormalizedQuestion(normalizeQuestionForCache("Kto może oddać krew?"));
		const hashB = hashNormalizedQuestion(normalizeQuestionForCache("Kto nie może oddać krwi?"));
		expect(hashA).not.toBe(hashB);
	});

	it("end-to-end: full normalize+hash pipeline treats whitespace/case variants as the same cache identity", () => {
		const idA = hashNormalizedQuestion(
			normalizeQuestionForCache("Kto może oddać krew w Polsce i jakie warunki musi spełnić dawca?"),
		);
		const idB = hashNormalizedQuestion(
			normalizeQuestionForCache(
				"  KTO   MOŻE ODDAĆ KREW W POLSCE I JAKIE WARUNKI MUSI SPEŁNIĆ DAWCA?  ",
			),
		);
		const idC = hashNormalizedQuestion(normalizeQuestionForCache("Kto nie może oddać krwi w Polsce?"));
		expect(idA).toBe(idB);
		expect(idA).not.toBe(idC);
	});
});
