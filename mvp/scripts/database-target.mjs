export function databaseTarget(env) {
  const ref = env.SUPABASE_PROJECT_REF;
  const host = env.SUPABASE_DB_POOLER_HOST;
  if (!/^[a-z]{20}$/.test(ref ?? "")) throw new Error("Invalid project ref");
  if (!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host ?? "")) {
    throw new Error("Set SUPABASE_DB_POOLER_HOST to the Session pooler host from Supabase Connect");
  }
  // Password stays in the child process environment, never the URL/arguments.
  return `postgresql://postgres.${ref}@${host}:5432/postgres?sslmode=require`;
}
