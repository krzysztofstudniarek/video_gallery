import { databaseTarget } from './database-target.mjs';

for (const name of ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'FRONTEND_ORIGIN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_BASE_PATH']) {
  if (!process.env[name]) throw new Error(`Missing deployment setting: ${name}`);
}
if (!/^[a-z]{20}$/.test(process.env.SUPABASE_PROJECT_REF)) throw new Error('Invalid project ref');
if (process.env.VITE_SUPABASE_URL !== `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`) throw new Error('Frontend and backend project mismatch');
if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) throw new Error('Frontend must use a publishable key, never a privileged key');
const origin = new URL(process.env.FRONTEND_ORIGIN);
if (origin.protocol !== 'https:' || origin.origin !== process.env.FRONTEND_ORIGIN) throw new Error('Invalid frontend HTTPS origin');
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(process.env.VITE_BASE_PATH)) throw new Error('Invalid frontend base path');

databaseTarget(process.env);
console.log('Deployment configuration validated');
