import { DOMAINS } from '../src/ai/domains.js';
import { buildDashboard } from '../src/ai/dashboard.js';
const filt = process.argv[2] ? JSON.parse(process.argv[2]) : {};
for (const d of DOMAINS) {
  const t = Date.now();
  const r = await buildDashboard(d, filt);
  const errs = r.widgets.filter((w: any) => w.error);
  const empty = r.widgets.filter((w: any) => !w.error && !(w.result?.rows?.length));
  console.log(d.id, `${Date.now() - t}ms`, 'widgets', r.widgets.length, 'errors', errs.map((w: any) => `${w.title}: ${w.error}`), 'empty', empty.map((w: any) => w.title));
}
process.exit(0);
