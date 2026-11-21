import { syncFromGoogle, syncFromDir, rebuildOnly } from '../src/ingest/pipeline.js';
const args = process.argv.slice(2);
const dirIdx = args.indexOf('--from-dir');
const r = dirIdx >= 0 ? await syncFromDir(args[dirIdx + 1])
  : args.includes('--rebuild') ? await rebuildOnly()
  : await syncFromGoogle({ force: args.includes('--force') });
console.log(JSON.stringify({ status: r.status, tabs: r.tabs.map(t => ({ tab: t.tab, rows: t.rows, changed: t.changed, error: t.error })), models: r.models, quality: r.quality }, null, 1));
process.exit(0);
