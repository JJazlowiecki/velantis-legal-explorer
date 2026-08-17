import { describe, expect, it } from "vitest";

import { LatestAnnouncementResolutionError, resolveLatestAnnouncementSourceId } from "./latest-announcement";
import type { EliActMetadata } from "./schema";

function metadata(overrides: Partial<EliActMetadata> = {}): EliActMetadata {
	return { publisher: "DU", year: 2000, pos: 1, title: "Test act", ...overrides };
}

function parseSourceId(sourceId: string) {
	const [publisher, yearStr, positionStr] = sourceId.split("/");
	return { publisher, year: Number(yearStr), position: Number(positionStr) };
}

describe("resolveLatestAnnouncementSourceId", () => {
	it("picks the entry with the latest promulgation date when every entry resolves", async () => {
		const fetchMetadata = async (input: { publisher: string; year: number; position: number }) => {
			const bySourceId: Record<string, EliActMetadata> = {
				"DU/2020/1": metadata({ promulgation: "2020-01-01" }),
				"DU/2022/1": metadata({ promulgation: "2022-06-15" }),
				"DU/2021/1": metadata({ promulgation: "2021-03-10" }),
			};
			return bySourceId[`${input.publisher}/${input.year}/${input.position}`];
		};

		const result = await resolveLatestAnnouncementSourceId(["DU/2020/1", "DU/2022/1", "DU/2021/1"], fetchMetadata, parseSourceId);
		expect(result).toBe("DU/2022/1");
	});

	it("breaks a promulgation-date tie deterministically by sourceId", async () => {
		const fetchMetadata = async () => metadata({ promulgation: "2020-01-01" });
		const result = await resolveLatestAnnouncementSourceId(["DU/2020/1", "DU/2020/2"], fetchMetadata, parseSourceId);
		expect(result).toBe("DU/2020/2");
	});

	it("fails closed when a single entry's metadata fetch fails, even though the others would resolve", async () => {
		const fetchMetadata = async (input: { publisher: string; year: number; position: number }) => {
			if (input.year === 2021) throw new Error("network error");
			return metadata({ promulgation: "2020-01-01" });
		};
		await expect(resolveLatestAnnouncementSourceId(["DU/2020/1", "DU/2021/1"], fetchMetadata, parseSourceId)).rejects.toThrow(
			LatestAnnouncementResolutionError,
		);
	});

	it("fails closed when a single entry's promulgation date is missing/unusable, even though the others would resolve", async () => {
		const fetchMetadata = async (input: { publisher: string; year: number; position: number }) =>
			input.year === 2021 ? metadata({ promulgation: undefined }) : metadata({ promulgation: "2020-01-01" });
		await expect(resolveLatestAnnouncementSourceId(["DU/2020/1", "DU/2021/1"], fetchMetadata, parseSourceId)).rejects.toThrow(
			LatestAnnouncementResolutionError,
		);
	});

	it("fails closed when every entry's fetch fails", async () => {
		const fetchMetadata = async () => {
			throw new Error("network error");
		};
		await expect(resolveLatestAnnouncementSourceId(["DU/2020/1", "DU/2021/1"], fetchMetadata, parseSourceId)).rejects.toThrow(
			LatestAnnouncementResolutionError,
		);
	});

	it("succeeds for a single-entry chain when that entry resolves cleanly", async () => {
		const fetchMetadata = async () => metadata({ promulgation: "2020-01-01" });
		const result = await resolveLatestAnnouncementSourceId(["DU/2020/1"], fetchMetadata, parseSourceId);
		expect(result).toBe("DU/2020/1");
	});

	it("never returns a partial/fallback result — every resolution is either the full, certain answer or a thrown error", async () => {
		// Regression guard for the exact defect this correction fixes: no code path may return
		// null/undefined or otherwise silently signal "use the whole chain instead" — the function's
		// return type itself (string, not string | null) enforces this, and this test exercises the
		// specific mixed-success/failure shape that previously triggered the forbidden fallback.
		const fetchMetadata = async (input: { publisher: string; year: number; position: number }) =>
			input.year === 2022 ? metadata({ promulgation: undefined }) : metadata({ promulgation: "2020-01-01" });
		let thrown: unknown;
		try {
			await resolveLatestAnnouncementSourceId(["DU/2020/1", "DU/2022/1"], fetchMetadata, parseSourceId);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(LatestAnnouncementResolutionError);
	});
});
