import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifySolanaMessage(wallet: string, message: string, signatureBase64: string) {
  try {
    const rawKey = new PublicKey(wallet).toBuffer();
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureBase64, "base64"));
  } catch { return false; }
}
