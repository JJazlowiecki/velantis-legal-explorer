import { describe, expect, it } from "vitest";

import { CliValidationError, parseIngestCliArgs } from "./ingest";

describe("parseIngestCliArgs", () => {
  it("parses required options", () => {
    const parsed = parseIngestCliArgs([
      "--publisher",
      "DU",
      "--year",
      "1964",
      "--position",
      "93",
    ]);

    expect(parsed).toEqual({ publisher: "DU", year: 1964, position: 93 });
  });

  it("rejects missing values", () => {
    expect(() => parseIngestCliArgs(["--publisher", "DU", "--year", "1964", "--position"])).toThrow(
      CliValidationError,
    );
  });

  it("rejects invalid year", () => {
    expect(() =>
      parseIngestCliArgs([
        "--publisher",
        "DU",
        "--year",
        "nineteen-sixty-four",
        "--position",
        "93",
      ]),
    ).toThrow(CliValidationError);
  });
});
