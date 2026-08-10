import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getRedis } from "@/lib/server/redis";
import { creatorProfileNonceKey } from "@/lib/server/creator-profile";
import { KODIAK_NETWORK } from "@/lib/solana/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ wallet: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { wallet: rawWallet } = await context.params;
    const wallet = new PublicKey(rawWallet).toBase58();
    const nonce = randomBytes(24).toString("hex");
    const message = `Kodiak creator profile update\nWallet: ${wallet}\nNetwork: ${KODIAK_NETWORK}\nNonce: ${nonce}`;
    await getRedis().set(creatorProfileNonceKey(wallet, nonce), message, { ex: 300 });
    return NextResponse.json({ nonce, message, network: KODIAK_NETWORK });
  } catch {
    return NextResponse.json({ error: "A valid Solana wallet is required." }, { status: 400 });
  }
}
