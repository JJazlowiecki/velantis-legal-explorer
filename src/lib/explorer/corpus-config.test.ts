import { describe, expect, it } from "vitest";

import { ExplorerConfigError, parseExplorerTestCorpusVersionIds } from "./corpus-config";

const VALID_UUID_A = "572d313e-ae03-4207-97c6-38e2e5088617";
const VALID_UUID_B = "57751979-5c51-4871-a2b8-c51d907a2b1d";

describe("parseExplorerTestCorpusVersionIds", () => {
  it("rejects undefined (missing configuration) — no global corpus fallback", () => {
    expect(() => parseExplorerTestCorpusVersionIds(undefined)).toThrow(ExplorerConfigError);
  });

  it("rejects an empty string", () => {
    expect(() => parseExplorerTestCorpusVersionIds("")).toThrow(ExplorerConfigError);
  });

  it("rejects a whitespace-only string", () => {
    expect(() => parseExplorerTestCorpusVersionIds("   ")).toThrow(ExplorerConfigError);
  });

  it("rejects a string that is only commas/whitespace", () => {
    expect(() => parseExplorerTestCorpusVersionIds(" , , ")).toThrow(ExplorerConfigError);
  });

  it("rejects a malformed UUID", () => {
    expect(() => parseExplorerTestCorpusVersionIds("not-a-uuid")).toThrow(ExplorerConfigError);
  });

  it("rejects a list where one entry is malformed", () => {
    expect(() => parseExplorerTestCorpusVersionIds(`${VALID_UUID_A},not-a-uuid`)).toThrow(ExplorerConfigError);
  });

  it("parses a single valid UUID", () => {
    expect(parseExplorerTestCorpusVersionIds(VALID_UUID_A)).toEqual([VALID_UUID_A]);
  });

  it("parses and trims a comma-separated list of valid UUIDs", () => {
    expect(parseExplorerTestCorpusVersionIds(`${VALID_UUID_A}, ${VALID_UUID_B} `)).toEqual([VALID_UUID_A, VALID_UUID_B]);
  });
});
