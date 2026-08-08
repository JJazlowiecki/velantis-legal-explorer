import { NextResponse } from "next/server";

import { checkDatabaseConnection } from "@/db";

export async function GET() {
  try {
    await checkDatabaseConnection();

    return NextResponse.json({
      status: "ok",
      database: "ok",
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
      },
      { status: 503 },
    );
  }
}
