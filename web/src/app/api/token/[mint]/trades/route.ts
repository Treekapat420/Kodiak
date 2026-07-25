import { NextRequest, NextResponse } from "next/server";
import { getTrades, inferTokenAmount, saveTrade, type StoredTrade } from "@/lib/devnet-market";
import { recordCreatorReward } from "@/lib/creator-rewards";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ mint: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { mint } = await context.params;
    const trades = await getTrades(mint);
    return NextResponse.json({ mint, trades: [...trades].reverse().slice(0, 100) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load trades." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { mint } = await context.params;
    const body = (await request.json()) as { wallet?: string; signature?: string; side?: "buy" | "sell"; solAmount?: number };
    if (!body.wallet || !body.signature || !body.solAmount) {
      return NextResponse.json({ error: "wallet, signature, and solAmount are required." }, { status: 400 });
    }
    const inferred = await inferTokenAmount(body.signature, mint, body.wallet);
    if (!Number.isFinite(inferred.tokenAmount) || inferred.tokenAmount <= 0) {
      return NextResponse.json({ error: "The transaction was confirmed, but its token amount could not be read yet. Retry shortly." }, { status: 409 });
    }
    const trade: StoredTrade = {
      mint,
      wallet: body.wallet,
      signature: body.signature,
      side: body.side ?? "buy",
      solAmount: Number(body.solAmount),
      tokenAmount: inferred.tokenAmount,
      priceSol: Number(body.solAmount) / inferred.tokenAmount,
      timestamp: inferred.timestamp,
    };
    await saveTrade(trade);

    try {
      await recordCreatorReward(trade);
    } catch (rewardError) {
      console.error("Creator reward ledger write failed:", rewardError);
    }
    return NextResponse.json({ ok: true, trade });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record trade." }, { status: 500 });
  }
}
