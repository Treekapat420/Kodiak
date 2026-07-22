import "server-only";
import { Redis } from "@upstash/redis";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.KV_REST_API_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    throw new Error(
      "Kodiak database is unavailable in this environment. " +
        "KV_REST_API_URL and KV_REST_API_TOKEN must be configured at runtime.",
    );
  }

  client = new Redis({ url, token });
  return client;
}
