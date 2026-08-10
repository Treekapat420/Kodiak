import "server-only";
import { getRedis } from "@/lib/server/redis";
import { KODIAK_IS_DEVNET } from "@/lib/solana/network";

export type CreatorProfileMeta = {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl: string;
  xUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  updatedAt?: string;
};

export const EMPTY_CREATOR_PROFILE: CreatorProfileMeta = {
  displayName: "", username: "", bio: "", avatarUrl: "", xUrl: "", telegramUrl: "", websiteUrl: "",
};

export function creatorProfileKey(wallet: string) {
  return `${KODIAK_IS_DEVNET ? "kodiak:devnet" : "kodiak:mainnet"}:creator-profile:${wallet}:v1`;
}

export function creatorProfileNonceKey(wallet: string, nonce: string) {
  return `${KODIAK_IS_DEVNET ? "kodiak:devnet" : "kodiak:mainnet"}:creator-profile-nonce:${wallet}:${nonce}`;
}

export async function getCreatorProfileMeta(wallet: string): Promise<CreatorProfileMeta> {
  const raw = await getRedis().get<CreatorProfileMeta | string | null>(creatorProfileKey(wallet));
  if (!raw) return { ...EMPTY_CREATOR_PROFILE };
  if (typeof raw === "string") {
    try { return { ...EMPTY_CREATOR_PROFILE, ...JSON.parse(raw) }; } catch { return { ...EMPTY_CREATOR_PROFILE }; }
  }
  return { ...EMPTY_CREATOR_PROFILE, ...raw };
}
