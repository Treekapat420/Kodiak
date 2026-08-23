import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import {
  consumeClaimNonce,
  createClaimChallenge,
  getHolderRewardStatus,
  isOfficialKodiakRewardsMint,
  sendHolderRewardClaim,
} from "@/lib/holder-rewards";
import { verifySolanaMessage } from "@/lib/server/verify-solana-signature";
import { KODIAK_NETWORK } from "@/lib/solana/network";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ mint: string }> };

type RequestBody = {
  action?: "prepare" | "claim";
  wallet?: string;
  nonce?: string;
  message?: string;
  signature?: string;
};

function canonical(value: string, label: string) {
  const key = new PublicKey(value);
  if (key.toBase58() !== value) throw new Error(`${label} is not a canonical Solana public key.`);
  return key.toBase58();
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { mint: rawMint } = await context.params;
    const mint = canonical(rawMint, "Token mint");
    const walletRaw = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
    const wallet = walletRaw ? canonical(walletRaw, "Wallet") : undefined;

    const status = await getHolderRewardStatus(mint, wallet);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load SOL rewards.", network: KODIAK_NETWORK },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { mint: rawMint } = await context.params;
    const mint = canonical(rawMint, "Token mint");
    const body = (await request.json()) as RequestBody;
    const wallet = canonical(body.wallet?.trim() ?? "", "Wallet");

    if (!isOfficialKodiakRewardsMint(mint)) {
      return NextResponse.json(
        { error: "SOL rewards are only enabled for the official Devnet $KODIAK token.", network: KODIAK_NETWORK },
        { status: 403 },
      );
    }

    if (body.action === "prepare") {
      const challenge = await createClaimChallenge(mint, wallet);
      return NextResponse.json({ ok: true, ...challenge, network: KODIAK_NETWORK });
    }

    if (body.action !== "claim") {
      return NextResponse.json({ error: "Invalid rewards action.", network: KODIAK_NETWORK }, { status: 400 });
    }

    const nonce = body.nonce?.trim() ?? "";
    const message = body.message ?? "";
    const signature = body.signature?.trim() ?? "";

    const expectedMessage = [
      "Kodiak SOL Rewards claim",
      "network:devnet",
      `mint:${mint}`,
      `wallet:${wallet}`,
      `nonce:${nonce}`,
    ].join("\n");

    if (!nonce || message !== expectedMessage || !signature) {
      return NextResponse.json({ error: "The SOL rewards claim challenge is invalid.", network: KODIAK_NETWORK }, { status: 400 });
    }

    if (!verifySolanaMessage(wallet, message, signature)) {
      return NextResponse.json({ error: "Wallet signature verification failed.", network: KODIAK_NETWORK }, { status: 401 });
    }

    const nonceAccepted = await consumeClaimNonce(mint, wallet, nonce);
    if (!nonceAccepted) {
      return NextResponse.json({ error: "This claim challenge expired or was already used. Try Claim SOL again.", network: KODIAK_NETWORK }, { status: 409 });
    }

    const result = await sendHolderRewardClaim(mint, wallet);
    return NextResponse.json({ ok: true, ...result, network: KODIAK_NETWORK });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to claim SOL rewards.", network: KODIAK_NETWORK },
      { status: 500 },
    );
  }
}
