// OWNER: Dev 2. Spoken account -> claims -> initial labels. Input: {transcript}. Output: ClaimResult[].
// The pipeline and its failure policy live in lib/truth/account.ts; this file only maps HTTP.
// 200: ClaimResult[] (one per extracted claim, in order; also saved to claims.json and results.json).
// 400 bad scene id or body · 404 unknown scene · 422 malformed manifest or scene file ·
// 429 budget hard stop · 502 claim extraction failed · 503 budget could not be checked · 500 otherwise.
import { NextResponse } from "next/server";
import { AccountError, runAccount } from "@/lib/truth/account";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: {\"transcript\": \"...\"}." }, { status: 400 });
  }
  const transcript = typeof body === "object" && body !== null ? (body as { transcript?: unknown }).transcript : undefined;
  try {
    return NextResponse.json(await runAccount(id, transcript));
  } catch (e) {
    if (e instanceof AccountError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[account] unexpected failure", e);
    return NextResponse.json({ error: "Account processing failed." }, { status: 500 });
  }
}
