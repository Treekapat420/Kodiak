from pathlib import Path

root = Path.cwd()
client = root / 'web/src/components/admin/GraduationDiagnostics.tsx'
server = root / 'web/src/app/api/token/[mint]/graduation/diagnostics/route.ts'

if not client.exists() or not server.exists():
    raise SystemExit('Run from Kodiak repository root; required files were not found. No files changed.')

c = client.read_text()
s = server.read_text()

# Make the optional migration health block fail gracefully if the API does not provide it.
old_type = '  migrationHealth: {'
old_start = '          <div className={`rounded-2xl border p-4 ${\n            data.migrationHealth.attentionRecommended'
old_end = '''          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-4">'''

assert c.count(old_type) == 1, 'Unexpected client schema: migrationHealth'
assert c.count(old_start) == 1, 'Unexpected client markup: health block'
assert c.count(old_end) == 1, 'Unexpected client markup: bonding block'
assert s.count('maxSupportedTransactionVersion: 0,') == 1, 'Unexpected transaction version setting'

c_new = c.replace(old_type, '  migrationHealth?: {', 1)
c_new = c_new.replace(old_start, '          {data.migrationHealth ? (\n' + old_start, 1)
# Close the health block's conditional immediately before bonding progress.
c_new = c_new.replace(old_end, '''          ) : (
            <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.04] p-4 text-sm text-amber-200">
              Migration health details were not returned by the API. Other diagnostic checks remain available.
            </div>
          )}

''' + old_end, 1)
# Insert the conditional closing after the health block and before the fallback, targeting the exact anchor.
anchor = '''          </div>

          ) : ('''
assert c_new.count(anchor) == 1, 'Health block closing anchor was not unique'
s_new = s.replace('maxSupportedTransactionVersion: 0,','maxSupportedTransactionVersion: 1,',1)

client.write_text(c_new)
server.write_text(s_new)
print('Updated 2 diagnostics files. Review the diff with git diff before committing.')
