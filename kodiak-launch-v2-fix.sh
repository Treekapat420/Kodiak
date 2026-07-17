#!/usr/bin/env bash
set -euo pipefail

echo "🐻 Fixing Kodiak draft restore..."

if [ ! -d "web" ]; then
  echo "Error: run this from /workspaces/Kodiak."
  exit 1
fi

python - <<'PY'
from pathlib import Path

path = Path("web/src/app/launch/page.tsx")
text = path.read_text()

old = '''  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);

      if (saved) {
        const parsed = JSON.parse(saved) as {
          form?: Partial<FormState>;
          logoPreview?: string | null;
          bannerPreview?: string | null;
        };

        setForm((current) => ({ ...current, ...parsed.form }));
        setLogoPreview(parsed.logoPreview ?? null);
        setBannerPreview(parsed.bannerPreview ?? null);
      }
    } catch (error) {
      console.error("Unable to restore Kodiak draft:", error);
    } finally {
      setDraftLoaded(true);
    }
  }, []);
'''

new = '''  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);

        if (saved) {
          const parsed = JSON.parse(saved) as {
            form?: Partial<FormState>;
            logoPreview?: string | null;
            bannerPreview?: string | null;
          };

          setForm((current) => ({ ...current, ...parsed.form }));
          setLogoPreview(parsed.logoPreview ?? null);
          setBannerPreview(parsed.bannerPreview ?? null);
        }
      } catch (error) {
        console.error("Unable to restore Kodiak draft:", error);
      } finally {
        setDraftLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);
'''

if old not in text:
    raise SystemExit(
        "Could not find the expected draft-restore block. "
        "The file may already be changed."
    )

path.write_text(text.replace(old, new))
PY

cd web
npm run lint
npm run build
cd ..

git add web/src/app/launch/page.tsx
git commit -m "fix launch draft restore lint error" || true

echo ""
echo "✅ Draft restore fixed."
echo "Refresh Kodiak and test the Launch page."
