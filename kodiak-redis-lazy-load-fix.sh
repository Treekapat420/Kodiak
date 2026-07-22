#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Kodiak"
WEB="$ROOT/web"

echo "🐻 Applying Redis lazy-load fix..."

if [ ! -f "$WEB/src/lib/server/redis.ts" ]; then
  echo "Error: Redis helper was not found."
  exit 1
fi

cat > "$WEB/src/lib/server/redis.ts" <<'EOF'
import "server-only";
import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedis() {
  if (redisClient) return redisClient;

  const url = process.env.KV_REST_API_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    throw new Error(
      "Kodiak database is not configured in this environment. " +
        "KV_REST_API_URL and KV_REST_API_TOKEN are required at runtime.",
    );
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}
EOF

python - <<'PY'
from pathlib import Path

files = [
    Path("/workspaces/Kodiak/web/src/app/api/config/route.ts"),
    Path("/workspaces/Kodiak/web/src/app/api/creator/launches/route.ts"),
]

for path in files:
    text = path.read_text()

    text = text.replace(
        'import { redis } from "@/lib/server/redis";',
        'import { getRedis } from "@/lib/server/redis";',
    )

    if "const redis = getRedis();" not in text:
        marker = 'export const runtime = "nodejs";'
        text = text.replace(
            marker,
            marker + "\n\nfunction redis() {\n  return getRedis();\n}",
        )

    text = text.replace("await redis.get<", "await redis().get<")
    text = text.replace("await redis.set(", "await redis().set(")
    text = text.replace("await redis.lrange<", "await redis().lrange<")
    text = text.replace("await redis.lpush(", "await redis().lpush(")

    path.write_text(text)
PY

cd "$WEB"

echo "Running lint..."
npm run lint

echo "Running production build..."
npm run build

cd "$ROOT"

git add \
  web/src/lib/server/redis.ts \
  web/src/app/api/config/route.ts \
  web/src/app/api/creator/launches/route.ts

git commit -m "lazy load Redis at request time" || true
git push origin main

echo ""
echo "✅ Redis lazy-load fix applied and pushed."
echo ""
echo "Codespaces can now build without Redis secrets."
echo "Vercel will use the existing KV_REST_API_URL and KV_REST_API_TOKEN values at runtime."
