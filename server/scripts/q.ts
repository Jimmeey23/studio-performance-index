import { warehouse } from '../src/warehouse/db.js';
const db = await warehouse();
for (const q of process.argv.slice(2)) { console.log('> ' + q); console.table(await db.all(q)); }
process.exit(0);
