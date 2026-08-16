import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAndroidUpdateAvailable, parseAndroidRelease } from './mobile-updates.ts';

const valid = { version: '1.0.1', build: 10001, minimumBuild: 10000, critical: false, channel: 'stable', apk: 'https://example.com/otra.apk', sha256: 'a'.repeat(64), size: 12, releaseNotes: 'Fixes', packageName: 'com.darkstar.otra' };

describe('Android update metadata', () => {
  it('accepts a valid signed-release manifest shape', () => assert.equal(parseAndroidRelease(valid)?.build, 10001));
  it('rejects malformed or unsafe metadata', () => {
    assert.equal(parseAndroidRelease({ ...valid, apk: 'http://example.com/app.apk' }), null);
    assert.equal(parseAndroidRelease({ ...valid, packageName: 'other.app' }), null);
    assert.equal(parseAndroidRelease({ ...valid, sha256: 'not-a-hash' }), null);
  });
  it('only treats a strictly newer build as an update', () => {
    const release = parseAndroidRelease(valid)!;
    assert.equal(isAndroidUpdateAvailable(10000, release), true);
    assert.equal(isAndroidUpdateAvailable(10001, release), false);
    assert.equal(isAndroidUpdateAvailable(10002, release), false);
  });
});
