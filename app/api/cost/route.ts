// OWNER: Dev 3. Cost meter. Output: {spentUsd, hardStopUsd, blocked}.
import { NextResponse } from "next/server";
import { costStatus } from "@/lib/cost";

export const dynamic = "force-dynamic"; // the log changes on every model call; never cache

export async function GET() {
  try {
    return NextResponse.json(await costStatus());
  } catch (e) {
    console.error("[api/cost]", e);
    return NextResponse.json({ error: "Could not read the cost log." }, { status: 500 });
  }
}
