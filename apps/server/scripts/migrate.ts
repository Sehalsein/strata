// Brings a Postgres database's schema up to date: the cloud deploy runs this before
// `wrangler deploy`, since Workers don't migrate (src/db/index.ts).
//
//   DATABASE_URL=postgres://… bun scripts/migrate.ts
import { closeDatabase, openDatabase } from "../src/db";
import { migrations } from "../src/db/migrations";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("DATABASE_URL must be a postgres:// connection string.");
  process.exit(1);
}
const db = await openDatabase(url);
await closeDatabase(db);
console.log(`Database schema is up to date (v${migrations.length}).`);
