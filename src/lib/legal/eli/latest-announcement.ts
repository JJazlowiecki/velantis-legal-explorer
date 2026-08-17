import type { FetchEliActMetadataInput } from "./client";
import type { EliActMetadata } from "./schema";

export class LatestAnnouncementResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LatestAnnouncementResolutionError";
	}
}

/**
 * `--current-only` corpus-preparation support (see prepare-current-law-corpus.ts): identifies
 * the single most-recently-promulgated announcement in an already-known chain via a plain
 * metadata fetch per entry — reusing the exact same `fetchEliActMetadata` shape the normal
 * metadata sync already calls, never a bespoke discovery mechanism. Pure aside from the
 * injected fetch function, so it never needs a DB or network mock beyond that one function.
 *
 * Fails closed, with no partial-chain fallback: EVERY announcement in the chain must have its
 * metadata fetched successfully AND carry a usable promulgation date, or this throws
 * `LatestAnnouncementResolutionError` instead of returning a result. Ordering "the latest" from
 * a chain where even one entry's promulgation date is unknown is not a safe approximation — an
 * unresolved entry could, for all this function knows, actually be the true latest — so
 * `--current-only` must never guess, and must never silently widen back into ingesting the
 * whole chain (which would defeat its entire cost-control purpose). Callers that want the
 * "prepare everything" behavior get it by simply not passing `--current-only` at all.
 */
export async function resolveLatestAnnouncementSourceId(
	announcementSourceIds: string[],
	fetchMetadata: (input: FetchEliActMetadataInput) => Promise<EliActMetadata>,
	parseSourceId: (sourceId: string) => FetchEliActMetadataInput,
): Promise<string> {
	if (announcementSourceIds.length === 0) {
		throw new LatestAnnouncementResolutionError(
			"--current-only: no announcements in the chain — cannot determine the latest announcement with certainty.",
		);
	}
	const dated: { sourceId: string; promulgationDate: string }[] = [];
	for (const sourceId of announcementSourceIds) {
		let metadata: EliActMetadata;
		try {
			metadata = await fetchMetadata(parseSourceId(sourceId));
		} catch (error) {
			throw new LatestAnnouncementResolutionError(
				`--current-only: failed to fetch metadata for announcement ${sourceId} — cannot determine the latest announcement with certainty. ${
					error instanceof Error ? error.message : "unknown error"
				}`,
			);
		}
		if (!metadata.promulgation) {
			throw new LatestAnnouncementResolutionError(
				`--current-only: announcement ${sourceId} has no usable promulgation date — cannot determine the latest announcement with certainty.`,
			);
		}
		dated.push({ sourceId, promulgationDate: metadata.promulgation });
	}
	dated.sort((a, b) => b.promulgationDate.localeCompare(a.promulgationDate) || b.sourceId.localeCompare(a.sourceId));
	return dated[0].sourceId;
}
