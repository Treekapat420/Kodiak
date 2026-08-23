import "server-only";

import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { getRedis } from "@/lib/server/redis";
import { KODIAK_IS_DEVNET, KODIAK_NETWORK, KODIAK_RPC_URL } from "@/lib/solana/network";

const PROGRAM_ID = new PublicKey("68ueodLyUjvPDYq7tkfV6NSy3ThAwtQcBGvMtg6aVUTB");
const CONFIG_SEED = Buffer.from("kodiak-rewards");
const VAULT_SEED = Buffer.from("vault");
const EPOCH_SEED = Buffer.from("epoch");
const CLAIM_SEED = Buffer.from("claim");
const LEAF_DOMAIN = Buffer.from("kodiak-sol-rewards-v1");

const connection = new Connection(
  process.env.SOLANA_DEVNET_RPC_URL?.trim() || process.env.SOLANA_RPC_URL?.trim() || KODIAK_RPC_URL,
  "confirmed",
);

function rewardPrefix(mint: string) {
  return `kodiak:${KODIAK_NETWORK}:holder-rewards:${mint}`;
}
function pendingKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:pending:${wallet}`;
}
function claimedKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:claimed:${wallet}`;
}
function totalClaimedKey(mint: string) {
  return `${rewardPrefix(mint)}:claimed-lamports`;
}
function activeKey(mint: string, wallet: string) {
  return `${rewardPrefix(mint)}:onchain-active:${wallet}`;
}

function authorityKeypair() {
  if (!KODIAK_IS_DEVNET) throw new Error("On-chain rewards publishing is Devnet-only.");
  const raw = process.env.KODIAK_DEVNET_REWARDS_AUTHORITY_SECRET_KEY?.trim();
  if (!raw) throw new Error("KODIAK_DEVNET_REWARDS_AUTHORITY_SECRET_KEY is not configured.");
  const parsed = JSON.parse(raw) as number[];
  if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error("Rewards authority secret key is invalid.");
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function discriminator(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function u64(value: bigint | number) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}
function i64(value: bigint | number) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}
function u32(value: number) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}
function rewardLeaf(epochId: bigint, wallet: PublicKey, amount: bigint) {
  const hasher = crypto.createHash("sha256");
  for (const part of [LEAF_DOMAIN, u64(epochId), wallet.toBuffer(), u64(amount)]) hasher.update(part);
  return hasher.digest();
}

function pdas(mint: PublicKey, epochId?: bigint, claimant?: PublicKey) {
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED, mint.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([VAULT_SEED, config.toBuffer()], PROGRAM_ID);
  const epoch = epochId === undefined ? null : PublicKey.findProgramAddressSync([EPOCH_SEED, config.toBuffer(), u64(epochId)], PROGRAM_ID)[0];
  const receipt = epoch && claimant ? PublicKey.findProgramAddressSync([CLAIM_SEED, epoch.toBuffer(), claimant.toBuffer()], PROGRAM_ID)[0] : null;
  return { config, vault, epoch, receipt };
}

async function nextEpochId(config: PublicKey) {
  const info = await connection.getAccountInfo(config, "confirmed");
  if (!info || !info.owner.equals(PROGRAM_ID)) throw new Error("Kodiak rewards config is not initialized for this mint.");
  // Anchor discriminator (8) + authority (32) + mint (32) + vault/config/paused (3)
  return info.data.readBigUInt64LE(75);
}

async function readInt(key: string) {
  const value = await getRedis().get<string | number>(key);
  const n = Number(value ?? 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

type ActiveClaim = { epochId: string; amount: number; epoch: string; receipt: string };

export async function getOnchainRewardsStatus(mintString: string, wallet?: string) {
  const mint = new PublicKey(mintString);
  const { config, vault } = pdas(mint);
  const [vaultLamports, active] = await Promise.all([
    connection.getBalance(vault, "confirmed"),
    wallet ? getRedis().get<ActiveClaim>(activeKey(mintString, wallet)) : Promise.resolve(null),
  ]);
  return {
    rewardsProgram: PROGRAM_ID.toBase58(),
    config: config.toBase58(),
    vault: vault.toBase58(),
    vaultConfigured: true,
    vaultLamports,
    vaultSol: vaultLamports / LAMPORTS_PER_SOL,
    activeOnchainClaim: active ?? null,
  };
}

export async function prepareOnchainClaim(mintString: string, walletString: string) {
  if (!KODIAK_IS_DEVNET) throw new Error("On-chain holder rewards are currently Devnet-only.");
  const mint = new PublicKey(mintString);
  const claimant = new PublicKey(walletString);
  const redis = getRedis();

  const existing = await redis.get<ActiveClaim>(activeKey(mintString, walletString));
  if (existing) return buildClaimTransaction(mint, claimant, BigInt(existing.epochId), BigInt(existing.amount));

  const amount = await readInt(pendingKey(mintString, walletString));
  if (amount <= 0) throw new Error("This wallet has no claimable SOL rewards yet.");

  const authority = authorityKeypair();
  const base = pdas(mint);
  const epochId = await nextEpochId(base.config);
  const full = pdas(mint, epochId, claimant);
  if (!full.epoch || !full.receipt) throw new Error("Unable to derive rewards accounts.");

  const root = rewardLeaf(epochId, claimant, BigInt(amount));
  const vaultBalance = await connection.getBalance(base.vault, "confirmed");

  const tx = new Transaction();
  if (vaultBalance < amount) {
    const shortfall = BigInt(amount - vaultBalance);
    tx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: base.config, isSigner: false, isWritable: true },
        { pubkey: base.vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([discriminator("deposit"), u64(shortfall)]),
    }));
  }

  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: base.config, isSigner: false, isWritable: true },
      { pubkey: base.vault, isSigner: false, isWritable: false },
      { pubkey: full.epoch, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator("publish_epoch"), u64(epochId), root, u64(amount), i64(0)]),
  }));

  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(authority);
  const publishSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(publishSig, "confirmed");

  const active: ActiveClaim = { epochId: epochId.toString(), amount, epoch: full.epoch.toBase58(), receipt: full.receipt.toBase58() };
  await redis.set(activeKey(mintString, walletString), active);
  return buildClaimTransaction(mint, claimant, epochId, BigInt(amount), publishSig);
}

async function buildClaimTransaction(mint: PublicKey, claimant: PublicKey, epochId: bigint, amount: bigint, publishSignature?: string) {
  const { config, vault, epoch, receipt } = pdas(mint, epochId, claimant);
  if (!epoch || !receipt) throw new Error("Unable to derive claim accounts.");
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: claimant, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: epoch, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator("claim"), u64(epochId), u64(amount), u32(0)]),
  }));
  tx.feePayer = claimant;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return { transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"), epochId: epochId.toString(), amount: Number(amount), publishSignature: publishSignature ?? null };
}

export async function finalizeOnchainClaim(mint: string, wallet: string, signature: string) {
  const redis = getRedis();
  const active = await redis.get<ActiveClaim>(activeKey(mint, wallet));
  if (!active) throw new Error("No active on-chain claim was found for this wallet.");
  const parsed = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!parsed || parsed.meta?.err) throw new Error("The claim transaction is not confirmed successfully on Devnet.");
  if (!parsed.transaction.message.accountKeys.some((k) => k.pubkey.toBase58() === active.receipt)) throw new Error("The confirmed transaction does not match this rewards claim.");

  const currentPending = await readInt(pendingKey(mint, wallet));
  const paid = Math.min(active.amount, currentPending);
  const pipeline = redis.pipeline();
  pipeline.set(pendingKey(mint, wallet), Math.max(0, currentPending - paid));
  pipeline.incrby(claimedKey(mint, wallet), active.amount);
  pipeline.incrby(totalClaimedKey(mint), active.amount);
  pipeline.del(activeKey(mint, wallet));
  await pipeline.exec();
  return { signature, lamports: active.amount, sol: active.amount / LAMPORTS_PER_SOL };
}
