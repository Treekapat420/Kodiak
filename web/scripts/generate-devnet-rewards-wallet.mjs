import { Keypair } from "@solana/web3.js";

const wallet = Keypair.generate();
console.log("Devnet rewards vault public key:");
console.log(wallet.publicKey.toBase58());
console.log("\nSet KODIAK_DEVNET_REWARDS_SECRET_KEY in Vercel to this JSON array:");
console.log(JSON.stringify(Array.from(wallet.secretKey)));
console.log("\nIMPORTANT: Devnet testing only. Never reuse this keypair on Mainnet.");
