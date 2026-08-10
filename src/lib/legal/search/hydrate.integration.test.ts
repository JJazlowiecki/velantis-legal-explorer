import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { legalActVersions, legalActs, legalProvisions } from "../../../db/schema";
import { createTestDatabase } from "../../test-support/test-db";
import { hydrateProvisions } from "./hydrate";

const testDatabase = createTestDatabase();
const describeDatabase = testDatabase ? describe : describe.skip;
const client = testDatabase?.client;
const db = testDatabase?.db;

const TEST_SOURCE = "test_hydrate_fixture";
const TEST_SOURCE_ID = "TEST/HYDRATE/1";

afterAll(async () => {
  await client?.end({ timeout: 1 });
});

describeDatabase("hydrateProvisions ancestor context", () => {
  beforeEach(async () => {
    if (!db) return;
    await db.delete(legalActs).where(and(eq(legalActs.source, TEST_SOURCE), eq(legalActs.sourceId, TEST_SOURCE_ID)));
  });

  /**
   * Mirrors the real "sołtys" act structure that exposed the bug: a container article whose
   * introductory clause lives entirely in a `point` (no `heading`), gating two `letter`
   * siblings that only make sense in light of that point's own text.
   */
  async function seedFixture() {
    if (!db) throw new Error("DATABASE_URL is required for integration test");

    const [act] = await db
      .insert(legalActs)
      .values({
        jurisdiction: "PL",
        source: TEST_SOURCE,
        sourceId: TEST_SOURCE_ID,
        title: "Ustawa testowa o świadczeniu",
        actType: "ustawa",
      })
      .returning({ id: legalActs.id });

    const [version] = await db
      .insert(legalActVersions)
      .values({
        legalActId: act.id,
        versionKind: "promulgated",
        sourceExpressionId: "ogl",
        sourceDocumentKey: "test_hydrate_current",
        authorityClass: "authoritative",
        nonAuthoritative: false,
        currentnessStatus: "unproven",
      })
      .returning({ id: legalActVersions.id });

    // A systematic container ancestor — must never contribute its "text" (only heading/label).
    const [division] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: version.id,
        provisionType: "division",
        citationLabel: "Dział I",
        heading: "Dział I - Przepisy ogólne",
        text: "Dział I Przepisy ogólne",
        structuralPath: "div_1",
        ordinal: 1,
      })
      .returning({ id: legalProvisions.id });

    // art. 2 — container article, text is a heading duplicate: must never contribute its "text".
    const [art2] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: version.id,
        parentProvisionId: division.id,
        provisionType: "article",
        article: "2",
        citationLabel: "art. 2",
        heading: "Art. 2.",
        text: "Art. 2.",
        structuralPath: "div_1/art_2",
        ordinal: 2,
      })
      .returning({ id: legalProvisions.id });

    // art. 2 pkt 1 — sibling of pkt 2, unrelated to the age condition. Must never appear in
    // pkt 2's children's hierarchy just because it shares a parent.
    await db.insert(legalProvisions).values({
      legalActVersionId: version.id,
      parentProvisionId: art2.id,
      provisionType: "point",
      point: "1",
      citationLabel: "art. 2 pkt 1",
      heading: null,
      text: "1) pełniła funkcję przez okres co najmniej 7 lat;",
      structuralPath: "div_1/art_2/pkt_1",
      ordinal: 3,
    });

    // art. 2 pkt 2 — the governing point: has NO heading, only real operative text. This is
    // exactly the case hydrate.ts previously lost (heading ?? citationLabel fell through to
    // the bare label, dropping "2) osiągnęła wiek:" entirely).
    const [pkt2] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: version.id,
        parentProvisionId: art2.id,
        provisionType: "point",
        point: "2",
        citationLabel: "art. 2 pkt 2",
        heading: null,
        text: "2) osiągnęła wiek:",
        structuralPath: "div_1/art_2/pkt_2",
        ordinal: 4,
      })
      .returning({ id: legalProvisions.id });

    const [litA] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: version.id,
        parentProvisionId: pkt2.id,
        provisionType: "letter",
        letter: "a",
        citationLabel: "art. 2 pkt 2 lit. a",
        heading: null,
        text: "a) w przypadku kobiet - 60 lat,",
        structuralPath: "div_1/art_2/pkt_2/lit_a",
        ordinal: 5,
      })
      .returning({ id: legalProvisions.id });

    const [litB] = await db
      .insert(legalProvisions)
      .values({
        legalActVersionId: version.id,
        parentProvisionId: pkt2.id,
        provisionType: "letter",
        letter: "b",
        citationLabel: "art. 2 pkt 2 lit. b",
        heading: null,
        text: "b) w przypadku mężczyzn - 65 lat.",
        structuralPath: "div_1/art_2/pkt_2/lit_b",
        ordinal: 6,
      })
      .returning({ id: legalProvisions.id });

    return { division, art2, pkt2, litA, litB };
  }

  it("includes the governing ancestor point's own operative text in a leaf's hierarchy", async () => {
    const { litA, litB } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const hydrated = await hydrateProvisions(db, [litA.id, litB.id]);

    const hierarchyA = hydrated.get(litA.id)?.hierarchy ?? [];
    const hierarchyB = hydrated.get(litB.id)?.hierarchy ?? [];

    expect(hierarchyA).toContain("art. 2 pkt 2 — 2) osiągnęła wiek:");
    expect(hierarchyB).toContain("art. 2 pkt 2 — 2) osiągnęła wiek:");
  });

  it("does not duplicate or fabricate text for heading-only / container ancestors", async () => {
    const { litA } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const hydrated = await hydrateProvisions(db, [litA.id]);
    const hierarchy = hydrated.get(litA.id)?.hierarchy ?? [];

    // The systematic division container contributes only its heading, never a "— text" suffix.
    expect(hierarchy).toContain("Dział I - Przepisy ogólne");
    expect(hierarchy.some((entry) => entry.startsWith("Dział I —"))).toBe(false);

    // art. 2 is a container whose own text is a heading duplicate ("Art. 2.") — contributes
    // only its heading, never "art. 2 — Art. 2." noise.
    expect(hierarchy).toContain("Art. 2.");
    expect(hierarchy.some((entry) => entry.startsWith("art. 2 —"))).toBe(false);
  });

  it("does not pull unrelated siblings into a leaf's hierarchy", async () => {
    const { litA } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const hydrated = await hydrateProvisions(db, [litA.id]);
    const hierarchy = hydrated.get(litA.id)?.hierarchy ?? [];

    expect(hierarchy.some((entry) => entry.includes("pkt 1"))).toBe(false);
    expect(hierarchy.some((entry) => entry.includes("7 lat"))).toBe(false);
  });

  it("never turns ancestor context into an independent citable source: only requested leaves are keys in the result", async () => {
    const { litA, litB, pkt2, art2 } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const hydrated = await hydrateProvisions(db, [litA.id, litB.id]);

    expect(hydrated.has(litA.id)).toBe(true);
    expect(hydrated.has(litB.id)).toBe(true);
    // pkt2/art2 contributed context strings but were never themselves requested, so they must
    // never appear as their own hydrated (independently citable) entries.
    expect(hydrated.has(pkt2.id)).toBe(false);
    expect(hydrated.has(art2.id)).toBe(false);
    expect(hydrated.size).toBe(2);
  });

  it("preserves the exact leaf text and citation label untouched by ancestor-context enrichment", async () => {
    const { litA } = await seedFixture();
    if (!db) throw new Error("unreachable");

    const hydrated = await hydrateProvisions(db, [litA.id]);
    const provision = hydrated.get(litA.id);

    expect(provision?.citationLabel).toBe("art. 2 pkt 2 lit. a");
    expect(provision?.text).toBe("a) w przypadku kobiet - 60 lat,");
  });
});
