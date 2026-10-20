import { spawnSync } from 'node:child_process';
import { databaseTarget } from './database-target.mjs';

const required = ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'FRONTEND_ORIGIN'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
const ref = process.env.SUPABASE_PROJECT_REF;
if (!/^[a-z]{20}$/.test(ref)) throw new Error('Invalid staging project ref');
const origin = new URL(process.env.FRONTEND_ORIGIN);
const database = databaseTarget(process.env);
if (origin.protocol !== 'https:' || origin.origin !== process.env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN must be an HTTPS origin without path or trailing slash');
function run(args) {
  const result = spawnSync('node_modules/.bin/supabase', args, { stdio: 'inherit', env: { ...process.env, PGPASSWORD: process.env.SUPABASE_DB_PASSWORD } });
  if (result.error || result.status !== 0) throw new Error('Supabase deployment step failed');
}
// Explicit target every run; do not inherit a developer's previously linked project.
run(['link', '--project-ref', ref]);
run(['db', 'push', '--db-url', database, '--dry-run']);
run(['db', 'push', '--db-url', database, '--yes']);
run(['secrets', 'set', `FRONTEND_ORIGIN=${origin.origin}`, '--project-ref', ref]);
for (const name of ['health', 'compatibility', 'share', 'youtube']) {
  run(['functions', 'deploy', name, '--project-ref', ref, '--use-api']);
}
