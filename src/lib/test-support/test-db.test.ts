import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTestDatabaseUrl, UnsafeTestDatabaseError } from "./test-db";

const ORIGINAL_TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

describe("getTestDatabaseUrl", () => {
  beforeEach(() => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_TEST_DATABASE_URL === undefined) {
      delete process.env.TEST_DATABASE_URL;
    } else {
      process.env.TEST_DATABASE_URL = ORIGINAL_TEST_DATABASE_URL;
    }
    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    }
  });

  it("returns undefined when TEST_DATABASE_URL is not configured, so tests can skip", () => {
    expect(getTestDatabaseUrl()).toBeUndefined();
  });

  it("returns the URL when it is distinct from DATABASE_URL and names a test database", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_legal_explorer";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_legal_explorer_test";

    expect(getTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("works even when DATABASE_URL is not set at all", () => {
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_legal_explorer_test";
    expect(getTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("refuses to run when TEST_DATABASE_URL equals DATABASE_URL, even if it contains 'test'", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_test";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_test";

    expect(() => getTestDatabaseUrl()).toThrow(UnsafeTestDatabaseError);
  });

  it("refuses a test database whose name does not contain 'test'", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_legal_explorer";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/velantis_legal_explorer";

    expect(() => getTestDatabaseUrl()).toThrow(UnsafeTestDatabaseError);
  });

  it("refuses a malformed TEST_DATABASE_URL", () => {
    process.env.TEST_DATABASE_URL = "not-a-url";
    expect(() => getTestDatabaseUrl()).toThrow(UnsafeTestDatabaseError);
  });
});
