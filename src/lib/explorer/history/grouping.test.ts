import { describe, expect, it } from "vitest";

import { classifyHistoryGroup } from "./grouping";

// Constructed via local Date components (not ISO/UTC strings) so the test is not sensitive
// to the machine's timezone — classifyHistoryGroup itself compares local calendar days.
const NOW = new Date(2026, 0, 15, 12, 0, 0);

describe("classifyHistoryGroup", () => {
  it("classifies a timestamp from today as 'today'", () => {
    expect(classifyHistoryGroup(new Date(2026, 0, 15, 8, 0, 0), NOW)).toBe("today");
  });

  it("classifies a timestamp from yesterday as 'yesterday'", () => {
    expect(classifyHistoryGroup(new Date(2026, 0, 14, 23, 0, 0), NOW)).toBe("yesterday");
  });

  it("classifies a timestamp from 3 days ago as 'this_week'", () => {
    expect(classifyHistoryGroup(new Date(2026, 0, 12, 12, 0, 0), NOW)).toBe("this_week");
  });

  it("classifies a timestamp exactly 7 days ago as 'this_week'", () => {
    expect(classifyHistoryGroup(new Date(2026, 0, 8, 12, 0, 0), NOW)).toBe("this_week");
  });

  it("classifies a timestamp 8+ days ago as 'older'", () => {
    expect(classifyHistoryGroup(new Date(2026, 0, 1, 12, 0, 0), NOW)).toBe("older");
  });

  it("classifies a timestamp in the future as 'today' (clamped, never negative)", () => {
    expect(classifyHistoryGroup(new Date(2026, 0, 16, 12, 0, 0), NOW)).toBe("today");
  });
});
