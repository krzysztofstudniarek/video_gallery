import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const valid = {
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'synthetic',
  SUPABASE_DB_PASSWORD: 'synthetic',
  FRONTEND_ORIGIN: 'https://example.test',
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  VITE_BASE_PATH: '/video_gallery/',
};
function check(overrides) {
  return spawnSync(process.execPath, ['scripts/preflight.mjs'], {
    env: { ...process.env, ...valid, ...overrides }, encoding: 'utf8',
  });
}
test('valid configuration passes without printing values', () => {
  const result = check({});
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Deployment configuration validated');
});
test('reject privileged frontend key', () => {
  assert.notEqual(check({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic' }).status, 0);
});
test('reject mismatched frontend/backend project', () => {
  assert.notEqual(check({ VITE_SUPABASE_URL: 'https://another-project.supabase.co' }).status, 0);
});
test('reject missing credentials and path in CORS origin', () => {
  assert.notEqual(check({ SUPABASE_ACCESS_TOKEN: '' }).status, 0);
  assert.notEqual(check({ FRONTEND_ORIGIN: 'https://example.test/video_gallery/' }).status, 0);
});
