import { describe, expect, it } from "vitest";

import { dedupeToLatestContentRevisionPerAnnouncement } from "./service";

interface Row {
  id: string;
  sourceAnnouncementLegalActId: string | null;
  createdAt: Date;
}

describe("dedupeToLatestContentRevisionPerAnnouncement", () => {
  it("K: collapses multiple content revisions of the SAME announcement down to exactly one — the parser revision never appears as a fake distinct promulgation", () => {
    const rows: Row[] = [
      { id: "v-old-parser-bug", sourceAnnouncementLegalActId: "ann-1", createdAt: new Date("2024-01-01T00:00:00Z") },
      { id: "v-corrected", sourceAnnouncementLegalActId: "ann-1", createdAt: new Date("2026-08-10T00:00:00Z") },
    ];
    const result = dedupeToLatestContentRevisionPerAnnouncement(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v-corrected");
  });

  it("keeps distinct announcements as distinct rows — genuinely different official TJ publications are real, separate promulgations", () => {
    const rows: Row[] = [
      { id: "v-ann-a", sourceAnnouncementLegalActId: "ann-a", createdAt: new Date("2024-01-01T00:00:00Z") },
      { id: "v-ann-b", sourceAnnouncementLegalActId: "ann-b", createdAt: new Date("2026-01-01T00:00:00Z") },
    ];
    const result = dedupeToLatestContentRevisionPerAnnouncement(rows);
    expect(result.map((r) => r.id).sort()).toEqual(["v-ann-a", "v-ann-b"]);
  });

  it("never touches non-announcement-backed rows (ogl/uj/legacy tj) — sourceAnnouncementLegalActId null is passed through untouched, even with duplicates", () => {
    const rows: Row[] = [
      { id: "v-ogl", sourceAnnouncementLegalActId: null, createdAt: new Date("2024-01-01T00:00:00Z") },
      { id: "v-uj", sourceAnnouncementLegalActId: null, createdAt: new Date("2024-01-01T00:00:00Z") },
    ];
    const result = dedupeToLatestContentRevisionPerAnnouncement(rows);
    expect(result.map((r) => r.id).sort()).toEqual(["v-ogl", "v-uj"]);
  });

  it("breaks a same-timestamp tie deterministically by id", () => {
    const sameTime = new Date("2024-01-01T00:00:00Z");
    const rows: Row[] = [
      { id: "aaa", sourceAnnouncementLegalActId: "ann-1", createdAt: sameTime },
      { id: "bbb", sourceAnnouncementLegalActId: "ann-1", createdAt: sameTime },
    ];
    const result = dedupeToLatestContentRevisionPerAnnouncement(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bbb");
  });
});
