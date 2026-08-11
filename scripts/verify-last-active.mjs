// Regression test for the last_active_at tracking feature (middleware.ts +
// supabase/migrations/008_last_active.sql, 009_grant_authenticated_users.sql,
// 010_narrow_authenticated_users_grant.sql).
//
// No automated test suite exists in this project; this standalone script is
// the closest thing to a regression test for a security-relevant piece of
// configuration (the narrowed `authenticated` grant on public.users) and for
// the throttle logic in middleware.ts. Run it whenever either changes:
//
//   node --env-file=.env.local scripts/verify-last-active.mjs
//
// It authenticates as a real test account via Supabase's admin API
// (generateLink + verifyOtp, which does NOT send an email) and exercises the
// same PostgREST query middleware.ts performs, plus a negative-path check
// that the narrowed grant still blocks writes to household_id.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = 'alouthan15@gmail.com';

function log(label, value) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function getAuthenticatedClient() {
  const admin = createClient(url, serviceKey);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr) throw linkErr;

  const tokenHash = linkData.properties.hashed_token;

  const client = createClient(url, anonKey);
  const { data: verifyData, error: verifyErr } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyErr) throw verifyErr;

  return { client, userId: verifyData.user.id };
}

// This is the EXACT same query middleware.ts performs (copied verbatim from
// the implementation, minus the Promise.resolve()/.then()/.catch() wrapper
// needed there only to satisfy event.waitUntil's Promise typing — the
// PostgREST query itself, which is what we're testing, is identical).
async function touchLastActive(client, userId) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { error } = await client
    .from('users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', userId)
    .or(`last_active_at.is.null,last_active_at.lt.${cutoff}`);
  if (error) throw error;
}

async function readLastActive(userId) {
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin
    .from('users')
    .select('id,last_active_at')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data.last_active_at;
}

async function setLastActive(userId, value) {
  const admin = createClient(url, serviceKey);
  const { error } = await admin
    .from('users')
    .update({ last_active_at: value })
    .eq('id', userId);
  if (error) throw error;
}

// Negative-path check for the narrowed authenticated grant (migration 010).
// This is exactly the vulnerability Critical #1 fixed: an authenticated user
// must NOT be able to write household_id (the app's tenancy boundary) on
// their own row via the direct PostgREST client. Expect a 42501 permission
// denied error from Postgres, and the row's household_id must be unchanged.
async function verifyGrantIsNarrow(client, userId, adminClient) {
  const before = await adminClient.from('users').select('household_id').eq('id', userId).single();
  const { error } = await client
    .from('users')
    .update({ household_id: '00000000-0000-0000-0000-000000000000' })
    .eq('id', userId);
  const after = await adminClient.from('users').select('household_id').eq('id', userId).single();
  if (!error) throw new Error('SECURITY REGRESSION: household_id overwrite was NOT blocked');
  if (before.data.household_id !== after.data.household_id) throw new Error('SECURITY REGRESSION: household_id value changed');
  console.log('Negative-path check passed: household_id overwrite blocked with', error.code, error.message);
}

async function main() {
  const { client, userId } = await getAuthenticatedClient();
  log('Authenticated as user', userId);

  await setLastActive(userId, null);
  log('Reset last_active_at to null (clean start)', null);

  await touchLastActive(client, userId);
  const afterFirst = await readLastActive(userId);
  log('After first touch (expect recent timestamp)', afterFirst);

  await touchLastActive(client, userId);
  const afterSecond = await readLastActive(userId);
  log('After second touch, same day (expect UNCHANGED)', afterSecond);
  console.log('Throttle holds:', afterFirst === afterSecond);
  if (afterFirst !== afterSecond) throw new Error('THROTTLE TEST FAILED: value changed on second call within the same day');

  // Note: PostgREST renders timestamptz with a "+00:00" offset, never a "Z"
  // suffix, so comparing afterBackdate against the literal string we wrote
  // ('...Z') would always be unequal regardless of whether the update
  // actually happened — a false-pass trap. Capture the actual backdated
  // value from a read-back instead, and additionally assert the new value is
  // both different AND actually recent (not just different by coincidence).
  const backdatedValue = '2000-01-01T00:00:00Z';
  await setLastActive(userId, backdatedValue);
  const backdatedReadback = await readLastActive(userId);
  await touchLastActive(client, userId);
  const afterBackdate = await readLastActive(userId);
  log('After backdating + touch (expect fresh timestamp)', afterBackdate);
  const released =
    afterBackdate !== backdatedReadback &&
    new Date(afterBackdate) > new Date(Date.now() - 60000);
  console.log('Throttle releases when stale:', released);
  if (!released) throw new Error('THROTTLE-RELEASE TEST FAILED: value did not update after backdating');

  const admin = createClient(url, serviceKey);
  await verifyGrantIsNarrow(client, userId, admin);

  await setLastActive(userId, null);
  log('Cleanup: reset last_active_at back to null', null);

  console.log('\nALL CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
