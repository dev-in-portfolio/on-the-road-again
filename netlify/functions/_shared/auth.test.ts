import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSession, isAuthorized } from './auth.ts';

process.env.OTRA_ACCESS_CODE = 'field-code';
process.env.OTRA_SESSION_SECRET = 'a-long-random-test-session-secret';

describe('private access sessions', () => {
  it('creates a signed session only for the correct access code', async () => {
    const request = new Request('https://example.test/api/auth');
    const response = createSession('field-code', request);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie);
    assert.equal(isAuthorized(new Request('https://example.test/api/prospects', { headers: { cookie } })), true);
  });

  it('rejects an incorrect code and a tampered session', () => {
    const request = new Request('https://example.test/api/auth');
    assert.equal(createSession('wrong-code', request).status, 401);
    assert.equal(isAuthorized(new Request('https://example.test/api/prospects', { headers: { cookie: 'otra_session=v1.9999999999999.bad-signature' } })), false);
  });
});
