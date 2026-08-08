import "server-only";

import { parseServerEnv } from "@/lib/env/schema";

let cachedEnv: ReturnType<typeof parseServerEnv> | undefined;

export function getServerEnv() {
  if (!cachedEnv) {
    cachedEnv = parseServerEnv(process.env);
  }

  return cachedEnv;
}
