import { NextRequest, NextResponse } from "next/server";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  getCpmmPdaPoolId,
  getPdaLaunchpadPoolId,
  LaunchpadPool,
  PlatformConfig,
} from "@raydium-io/raydium-sdk-v2";

import { KODIAK_LAUNCHPAD_PROGRAM_ID } from "@/lib/raydium/devnet";
import {
  KODIAK_IS_DEVNET,
  KODIAK_IS_MAINNET,
  KODIAK_MAINNET_CPMM_CONFIG_ID,
  KODIAK_NETWORK,
  KODIAK_RPC_URL,
} from "@/lib/solana/network";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature?: string;
  network?: string;
  createdAt?: string;
  verifiedAt?: string;
  cpmmPoolId?: string | null;
  cpConfigId?: string | null;
  graduatedAt?: string | null;
};

type ResolvedPool = {
  mint: string;
  name: string;
  symbol: string;
  poolId: string;
  cpConfigId: string;
};

const DEVNET_PLATFORM_ID = "D33yYxh4JRtdeyLq7sFD8MzSjdtUa3uNFsSk39QHY8yT";
const MAINNET_PLATFORM_ID = "5d63yX2vRpyS2BPFwJJB15tMmctWCKwiKychEjP3gy4W";

function serverRpcUrl() {
  if (KODIAK_IS_MAINNET) {
    return process.env.SOLANA_MAINNET_RPC_URL?.trim() || KODIAK_RPC_URL;
  }
  return process.env.SOLANA_DEVNET_RPC_URL?.trim() || process.env.SOLANA_RPC_URL?.trim() || KODIAK_RPC_URL;
}

function creatorLaunchesKey(wallet: string) {
  return KODIAK_IS_DEVNET
    ? `kodiak:creator:${wallet}:launches`
    : `kodiak:mainnet:creator:${wallet}:launches`;
}

function launchKey(mint: string) {
  return KODIAK_IS_DEVNET
    ? `kodiak:launch:${mint}`
    : `kodiak:mainnet:launch:${mint}`;
}

function configuredPlatformId() {
  const value = KODIAK_IS_DEVNET
    ? process.env.KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      process.env.NEXT_PUBLIC_KODIAK_DEVNET_PLATFORM_ID?.trim() ||
      DEVNET_PLATFORM_ID
    : process.env.KODIAK_MAINNET_PLATFORM_ID?.trim() ||
      process.env.NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID?.trim() ||
      MAINNET_PLATFORM_ID;
  return new PublicKey(value);
}

function cpmmProgramId() {
  return KODIAK_IS_DEVNET
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
    : CREATE_CPMM_POOL_PROGRAM;
}

function validRecord(value: unknown, wallet: string): value is LaunchRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LaunchRecord>;
  return Boolean(
    record.mint &&
      record.creator &&
      record.name &&
      record.symbol &&
      record.creator.toLowerCase() === wallet.toLowerCase() &&
      (!record.network || record.network === KODIAK_NETWORK),
  );
}

async function loadCreatorLaunches(wallet: string): Promise<LaunchRecord[]> {
  const redis = getRedis();
  const mints = await redis.lrange<string>(creatorLaunchesKey(wallet), 0, 99);
  if (!Array.isArray(mints) || mints.length === 0) return [];

  const records = await Promise.all(
    mints.map(async (mint) => {
      try {
        const value = await redis.get<LaunchRecord>(launchKey(mint));
        return validRecord(value, wallet) ? value : null;
      } catch {
        return null;
      }
    }),
  );
  return records.filter((record): record is LaunchRecord => record !== null);
}

async function batchAccountInfo(connection: Connection, keys: PublicKey[]) {
  const result = new Map<string, Awaited<ReturnType<Connection["getAccountInfo"]>>>();
  for (let start = 0; start < keys.length; start += 100) {
    const chunk = keys.slice(start, start + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk, "confirmed");
    chunk.forEach((key, index) => result.set(key.toBase58(), infos[index] ?? null));
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
    let walletKey: PublicKey;
    try {
      walletKey = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "A valid creator wallet is required." }, { status: 400 });
    }

    const records = await loadCreatorLaunches(walletKey.toBase58());
    if (records.length === 0) {
      return NextResponse.json({ network: KODIAK_NETWORK, wallet, pools: [] });
    }

    // First return every server-persisted mapping. These require zero graduation RPC calls.
    const persisted: ResolvedPool[] = records
      .filter((record) => record.cpmmPoolId && record.cpConfigId)
      .map((record) => ({
        mint: record.mint,
        name: record.name,
        symbol: record.symbol,
        poolId: record.cpmmPoolId as string,
        cpConfigId: record.cpConfigId as string,
      }));

    const unresolved = records.filter((record) => !record.cpmmPoolId || !record.cpConfigId);
    if (unresolved.length === 0) {
      return NextResponse.json({ network: KODIAK_NETWORK, wallet, pools: persisted });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const platformId = configuredPlatformId();
    const platformAccount = await connection.getAccountInfo(platformId, "confirmed");
    if (!platformAccount || !platformAccount.owner.equals(KODIAK_LAUNCHPAD_PROGRAM_ID)) {
      throw new Error("Kodiak's LaunchLab PlatformConfig could not be verified on the active network.");
    }
    const platform = PlatformConfig.decode(platformAccount.data);
    const cpConfigId = platform.cpConfigId;

    if (KODIAK_IS_MAINNET && cpConfigId.toBase58() !== KODIAK_MAINNET_CPMM_CONFIG_ID) {
      throw new Error("Kodiak's Mainnet PlatformConfig does not point to the verified CPMM configuration.");
    }

    // One batched Solana request determines which unresolved launches are actually graduated.
    const launchpadIds = unresolved.map((record) =>
      getPdaLaunchpadPoolId(KODIAK_LAUNCHPAD_PROGRAM_ID, new PublicKey(record.mint), NATIVE_MINT).publicKey,
    );
    const launchpadAccounts = await batchAccountInfo(connection, launchpadIds);

    const graduated: Array<{ record: LaunchRecord; mintA: PublicKey; mintB: PublicKey }> = [];
    unresolved.forEach((record, index) => {
      const account = launchpadAccounts.get(launchpadIds[index].toBase58());
      if (!account || !account.owner.equals(KODIAK_LAUNCHPAD_PROGRAM_ID)) return;
      try {
        const pool = LaunchpadPool.decode(account.data);
        if (!pool.platformId.equals(platformId) || Number(pool.status) !== 2) return;
        graduated.push({ record, mintA: pool.mintA, mintB: pool.mintB });
      } catch {
        // Ignore malformed/obsolete historical records instead of failing creator rewards.
      }
    });

    if (graduated.length === 0) {
      return NextResponse.json({ network: KODIAK_NETWORK, wallet, pools: persisted });
    }

    const programId = cpmmProgramId();
    const candidates = graduated.flatMap(({ mintA, mintB }) => [
      getCpmmPdaPoolId(programId, cpConfigId, mintA, mintB).publicKey,
      getCpmmPdaPoolId(programId, cpConfigId, mintB, mintA).publicKey,
    ]);
    const cpmmAccounts = await batchAccountInfo(connection, candidates);
    const discovered: ResolvedPool[] = [];
    const redis = getRedis();

    for (let index = 0; index < graduated.length; index += 1) {
      const first = candidates[index * 2];
      const second = candidates[index * 2 + 1];
      const firstInfo = cpmmAccounts.get(first.toBase58());
      const secondInfo = cpmmAccounts.get(second.toBase58());
      const poolId = firstInfo?.owner.equals(programId)
        ? first
        : secondInfo?.owner.equals(programId)
          ? second
          : null;
      if (!poolId) continue;

      const record = graduated[index].record;
      const updated: LaunchRecord = {
        ...record,
        network: record.network || KODIAK_NETWORK,
        cpmmPoolId: poolId.toBase58(),
        cpConfigId: cpConfigId.toBase58(),
        graduatedAt: record.graduatedAt || new Date().toISOString(),
      };
      await redis.set(launchKey(record.mint), updated);
      discovered.push({
        mint: record.mint,
        name: record.name,
        symbol: record.symbol,
        poolId: poolId.toBase58(),
        cpConfigId: cpConfigId.toBase58(),
      });
    }

    return NextResponse.json(
      { network: KODIAK_NETWORK, wallet, pools: [...persisted, ...discovered] },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resolve creator CPMM pools." },
      { status: 500 },
    );
  }
}
