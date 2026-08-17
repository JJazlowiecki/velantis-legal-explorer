import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/auth";

// Deliberately lazy: `getAuth()` (which parses server env) must NOT run at module-evaluation
// time — Next.js's build step imports route modules to collect their exports even though no
// request is ever served, so an eager `getAuth()` call here would make `pnpm build`/Docker
// build fail whenever DATABASE_URL isn't present at build time (it doesn't need to be — this
// route is fully dynamic, evaluated per request).
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
