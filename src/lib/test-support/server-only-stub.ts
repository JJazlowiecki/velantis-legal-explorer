// Vitest-only stand-in for the `server-only` package. Next.js's bundler swaps `server-only`'s
// real (always-throwing) implementation for an empty module when building genuine server
// code — vitest runs plain Node, so it never gets that treatment. This alias (see
// vitest.config.mts) reproduces the same "no-op on the server" behavior for tests, without
// weakening the real production guard (this file is never used outside `pnpm test`).
export {};
