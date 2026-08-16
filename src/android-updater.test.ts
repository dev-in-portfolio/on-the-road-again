import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSecureApkUrl, verifyApkBytes } from './android-updater.ts';

const bytes = new TextEncoder().encode('apk-bytes').buffer;
const base = {
  version: '1.0.2', build: 10002, minimumBuild: 10001, critical: false, channel: 'stable' as const,
  apk: 'https://example.com/otra.apk', sha256: '', size: bytes.byteLength, releaseNotes: '', packageName: 'com.darkstar.otra',
};

test('APK verification rejects package, size, and checksum mismatches', async () => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  await verifyApkBytes({ ...base, sha256 }, bytes);
  await assert.rejects(() => verifyApkBytes({ ...base, sha256, packageName: 'com.other.app' }, bytes), /package identity/i);
  await assert.rejects(() => verifyApkBytes({ ...base, sha256, size: 1 }, bytes), /size/i);
  await assert.rejects(() => verifyApkBytes({ ...base, sha256: '0'.repeat(64) }, bytes), /SHA-256/i);
});

test('APK downloads must use HTTPS', () => {
  assertSecureApkUrl('https://example.com/otra.apk');
  assert.throws(() => assertSecureApkUrl('http://example.com/otra.apk'), /HTTPS/i);
});
