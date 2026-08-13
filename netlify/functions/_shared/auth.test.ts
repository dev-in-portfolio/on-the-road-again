import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  authConfigurationError,
  authorize,
  clearSession,
  createSession,
  isAuthorized,
} from './auth.ts';

const ACCESS = 'field-code';
const SECRET = 'a-long-random-test-session-secret';
process.env.OTRA_ACCESS_CODE = ACCESS;
process.env.OTRA_SESSION_SECRET = SECRET;

const httpsRequest = (path: string, cookie?: string) =>
  new Request(`https://example.test${path}`, cookie ? { headers: { cookie } } : undefined);

const cookieHeader = (response: Response): string => response.headers.get('set-cookie') ?? '';

describe('private access sessions', () => {
  it('creates a signed session only for the correct access code', () => {
    const response = createSession(ACCESS, httpsRequest('/api/auth'));
    assert.equal(response.status, 200);
    const cookie = cookieHeader(response);
    assert.ok(cookie.startsWith('otra_session='));
    assert.equal(isAuthorized(httpsRequest('/api/prospects', cookie)), true);
  });

  it('rejects an incorrect access code', () => {
    assert.equal(createSession('wrong-code', httpsRequest('/api/auth')).status, 401);
  });

  it('rejects a non-string access code', () => {
    assert.equal(createSession(null, httpsRequest('/api/auth')).status, 401);
    assert.equal(createSession(123, httpsRequest('/api/auth')).status, 401);
  });

  it('rejects a tampered session', () => {
    const cookie = 'otra_session=v1.9999999999999.bad-signature';
    assert.equal(isAuthorized(httpsRequest('/api/prospects', cookie)), false);
  });

  it('rejects an expired session', () => {
    const expiredAt = Date.now() - 1000;
    const cookie = `otra_session=v1.${expiredAt}.bad-signature`;
    assert.equal(isAuthorized(httpsRequest('/api/prospects', cookie)), false);
  });

  it('rejects a session with a malformed token shape', () => {
    assert.equal(isAuthorized(httpsRequest('/api/prospects', 'otra_session=garbage')), false);
    assert.equal(isAuthorized(httpsRequest('/api/prospects', 'otra_session=v1.notanumber.sig')), false);
  });

  it('sets an HttpOnly, SameSite=Strict cookie with Secure on HTTPS', () => {
    const cookie = cookieHeader(createSession(ACCESS, httpsRequest('/api/auth')));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Max-Age=604800/);
    assert.match(cookie, /Path=\//);
  });

  it('omits Secure over plain HTTP (local/dev)', () => {
    const request = new Request('http://localhost:8888/api/auth');
    const cookie = cookieHeader(createSession(ACCESS, request));
    assert.doesNotMatch(cookie, /Secure/);
  });

  it('logout clears the session cookie', () => {
    const response = clearSession(httpsRequest('/api/auth'));
    assert.equal(response.status, 200);
    const cookie = cookieHeader(response);
    assert.match(cookie, /otra_session=;/);
    assert.match(cookie, /Max-Age=0/);
  });

  it('fails closed when configuration is missing', () => {
    const savedAccess = process.env.OTRA_ACCESS_CODE;
    const savedSecret = process.env.OTRA_SESSION_SECRET;
    process.env.OTRA_ACCESS_CODE = '';
    process.env.OTRA_SESSION_SECRET = '';
    try {
      assert.equal(authConfigurationError()?.status, 503);
      assert.equal(authorize(httpsRequest('/api/prospects'))?.status, 503);
      assert.equal(createSession(ACCESS, httpsRequest('/api/auth')).status, 503);
    } finally {
      process.env.OTRA_ACCESS_CODE = savedAccess;
      process.env.OTRA_SESSION_SECRET = savedSecret;
    }
  });
});

describe('protected endpoint authorization', () => {
  it('allows an authorized request through', () => {
    const cookie = cookieHeader(createSession(ACCESS, httpsRequest('/api/auth')));
    assert.equal(authorize(httpsRequest('/api/prospects', cookie)), null);
  });

  it('rejects an unauthenticated request with 401 (not prospect data)', () => {
    const response = authorize(httpsRequest('/api/prospects'));
    assert.ok(response);
    assert.equal(response.status, 401);
  });
});
