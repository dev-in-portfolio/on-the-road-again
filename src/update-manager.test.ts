import assert from 'node:assert/strict';
import test from 'node:test';
import { checkForAndroidUpdate, shouldCheckForUpdate, UPDATE_CHECK_INTERVAL_MS } from './update-manager.ts';

const release = {
  version: '1.0.2', build: 10002, minimumBuild: 10001, critical: false, channel: 'stable',
  apk: 'https://github.com/dev-in-portfolio/on-the-road-again/releases/download/android-v1.0.2/otra.apk',
  sha256: 'a'.repeat(64), size: 123, releaseNotes: 'Fixes', packageName: 'com.darkstar.otra',
};

function storage(values: Record<string, string> = {}) {
  return { getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value; } };
}

test('update checks are throttled unless forced', () => {
  assert.equal(shouldCheckForUpdate(null, 100), true);
  assert.equal(shouldCheckForUpdate(100, 100 + UPDATE_CHECK_INTERVAL_MS - 1), false);
  assert.equal(shouldCheckForUpdate(100, 100, true), true);
});

test('newer metadata is returned and lower metadata is ignored', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify(release), { status: 200 }); };
  const first = await checkForAndroidUpdate({ force: true, now: 1000, storage: storage(), fetchImpl });
  assert.equal(first.release?.build, 10002);
  const older = { ...release, build: 10001 };
  const second = await checkForAndroidUpdate({ force: true, now: 2000, storage: storage(), fetchImpl: async () => new Response(JSON.stringify(older)) });
  assert.equal(second.release, null);
  assert.equal(calls, 1);
});

test('malformed, missing, and failed checks do not block startup', async () => {
  const missing = await checkForAndroidUpdate({ force: true, storage: storage(), fetchImpl: async () => new Response(null, { status: 404 }) });
  assert.equal(missing.release, null);
  const malformed = await checkForAndroidUpdate({ force: true, storage: storage(), fetchImpl: async () => new Response('{}') });
  assert.match(malformed.error || '', /malformed/i);
  const failed = await checkForAndroidUpdate({ force: true, storage: storage(), fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(failed.release, null);
  assert.equal(failed.error, 'offline');
});

test('a recent successful check is not fetched again', async () => {
  const now = Date.now(); const state = storage(); let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify(release)); };
  await checkForAndroidUpdate({ force: true, now, storage: state, fetchImpl });
  await checkForAndroidUpdate({ now: now + 10, storage: state, fetchImpl });
  assert.equal(calls, 1);
});
