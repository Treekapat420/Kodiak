import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  "68ueodLyUjvPDYq7tkfV6NSy3ThAwtQcBGvMtg6aVUTB",
);
const MINT = new PublicKey(
  "5gKUUuL6iSknoKDpbCNruVDNv2XBHQs1D5MhZs8M5X55",
);
const EXPECTED_DEPLOYER =
  "4937J2tRmFTq2b4usH2tococxp6StXevF11xryp4sm6k";

const DEPOSIT_LAMPORTS = 10_000_000n;
const REWARD_LAMPORTS = 1_000_000n;
const EPOCH_ID = 0n;

if (!process.env.DEPLOYER_KEY) {
  throw new Error("Missing DEPLOYER_KEY.");
}

const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.DEPLOYER_KEY)),
);

if (authority.publicKey.toBase58() !== EXPECTED_DEPLOYER) {
  throw new Error(
    `Wrong deployer key. Expected ${EXPECTED_DEPLOYER}, got ${authority.publicKey.toBase58()}`,
  );
}

const connection = new Connection(RPC, "confirmed");

function discriminator(name) {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function i64(value) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(Number(value));
  return out;
}

function hashParts(parts) {
  const hasher = crypto.createHash("sha256");
  for (const part of parts) {
    hasher.update(part);
  }
  return hasher.digest();
}

function rewardLeaf(epochId, wallet, amount) {
  return hashParts([
    Buffer.from("kodiak-sol-rewards-v1"),
    u64(epochId),
    wallet.toBuffer(),
    u64(amount),
  ]);
}

const [config] = PublicKey.findProgramAddressSync(
  [Buffer.from("kodiak-rewards"), MINT.toBuffer()],
  PROGRAM_ID,
);

const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), config.toBuffer()],
  PROGRAM_ID,
);

const [epoch] = PublicKey.findProgramAddressSync(
  [Buffer.from("epoch"), config.toBuffer(), u64(EPOCH_ID)],
  PROGRAM_ID,
);

const [receipt] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("claim"),
    epoch.toBuffer(),
    authority.publicKey.toBuffer(),
  ],
  PROGRAM_ID,
);

console.log("Program:", PROGRAM_ID.toBase58());
console.log("Mint:", MINT.toBase58());
console.log("Authority:", authority.publicKey.toBase58());
console.log("Config PDA:", config.toBase58());
console.log("Vault PDA:", vault.toBase58());
console.log("Epoch PDA:", epoch.toBase58());
console.log("Receipt PDA:", receipt.toBase58());

const configInfo = await connection.getAccountInfo(config, "confirmed");
if (!configInfo || !configInfo.owner.equals(PROGRAM_ID)) {
  throw new Error("Rewards config is not initialized correctly.");
}

const existingEpoch = await connection.getAccountInfo(epoch, "confirmed");
const existingReceipt = await connection.getAccountInfo(receipt, "confirmed");

if (existingReceipt) {
  console.log("SUCCESS: epoch 0 was already claimed in an earlier completed run.");
  process.exit(0);
}

if (existingEpoch) {
  throw new Error(
    "Epoch 0 already exists but its claim receipt does not. Do not rerun blindly; inspect the partial prior state.",
  );
}

const startingAuthority = await connection.getBalance(
  authority.publicKey,
  "confirmed",
);
const startingVault = await connection.getBalance(vault, "confirmed");

console.log(
  "Starting authority:",
  startingAuthority / LAMPORTS_PER_SOL,
  "SOL",
);
console.log(
  "Starting vault:",
  startingVault / LAMPORTS_PER_SOL,
  "SOL",
);

if (startingAuthority < 20_000_000) {
  throw new Error("Devnet deployer needs at least 0.02 SOL.");
}

const depositIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: MINT, isSigner: false, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([
    discriminator("deposit"),
    u64(DEPOSIT_LAMPORTS),
  ]),
});

const depositSig = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(depositIx),
  [authority],
  {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  },
);

console.log("Deposit signature:", depositSig);

const vaultAfterDeposit = await connection.getBalance(vault, "confirmed");
if (
  vaultAfterDeposit <
  startingVault + Number(DEPOSIT_LAMPORTS)
) {
  throw new Error("Vault did not receive the 0.01 SOL deposit.");
}

const merkleRoot = rewardLeaf(
  EPOCH_ID,
  authority.publicKey,
  REWARD_LAMPORTS,
);

const publishIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: MINT, isSigner: false, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: epoch, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([
    discriminator("publish_epoch"),
    u64(EPOCH_ID),
    merkleRoot,
    u64(REWARD_LAMPORTS),
    i64(0),
  ]),
});

const publishSig = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(publishIx),
  [authority],
  {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  },
);

console.log("Publish signature:", publishSig);

const epochInfo = await connection.getAccountInfo(epoch, "confirmed");
if (!epochInfo || !epochInfo.owner.equals(PROGRAM_ID)) {
  throw new Error("Epoch PDA was not created.");
}

const vaultBeforeClaim = await connection.getBalance(vault, "confirmed");

const claimIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: MINT, isSigner: false, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: epoch, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: receipt, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([
    discriminator("claim"),
    u64(EPOCH_ID),
    u64(REWARD_LAMPORTS),
    u32(0),
  ]),
});

const claimSig = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(claimIx),
  [authority],
  {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  },
);

console.log("Claim signature:", claimSig);

const vaultAfterClaim = await connection.getBalance(vault, "confirmed");
const receiptInfo = await connection.getAccountInfo(receipt, "confirmed");

if (!receiptInfo || !receiptInfo.owner.equals(PROGRAM_ID)) {
  throw new Error("Claim receipt was not created.");
}

if (
  vaultBeforeClaim - vaultAfterClaim !==
  Number(REWARD_LAMPORTS)
) {
  throw new Error(
    `Expected vault to fall by ${REWARD_LAMPORTS} lamports; actual difference was ${
      vaultBeforeClaim - vaultAfterClaim
    }.`,
  );
}

console.log(
  "Vault before claim:",
  vaultBeforeClaim / LAMPORTS_PER_SOL,
  "SOL",
);
console.log(
  "Vault after claim:",
  vaultAfterClaim / LAMPORTS_PER_SOL,
  "SOL",
);

console.log("SUCCESS: hardened rewards full cycle passed on Devnet.");
console.log("Deposit:", depositSig);
console.log("Publish:", publishSig);
console.log("Claim:", claimSig);
