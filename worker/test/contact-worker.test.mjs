import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmailMessage, handleRequest } from '../src/index.mjs';

const ALLOWED_ORIGIN = 'https://a5507203.github.io';
const VALID_PAYLOAD = {
  submissionId: '4aabf24e-2f25-45df-a5cc-83cc5f7cf504',
  country: '中国',
  organizationType: 'enterprise',
  givenName: '小明',
  familyName: '王',
  workEmail: 'visitor@example.com',
  phone: '13800000000',
  organizationName: '示例公司',
  organizationWebsite: 'https://example.com',
  requirements: '希望了解 <空间训练场> & COS。',
  fax: '',
};

function createLimiter(success = true) {
  return {
    calls: [],
    async limit(options) {
      this.calls.push(options);
      return { success };
    },
  };
}

function createEnv(overrides = {}) {
  return {
    RESEND_API_KEY: 'test-secret',
    CONTACT_FROM_EMAIL: 'Melsy Website <website@mail.melsyai.com>',
    CONTACT_TO_EMAIL: 'contact@melsyai.com',
    ALLOWED_ORIGINS: `${ALLOWED_ORIGIN},https://www.melsyai.com,https://melsyai.com`,
    CONTACT_ACTOR_RATE_LIMITER: createLimiter(),
    CONTACT_GLOBAL_RATE_LIMITER: createLimiter(),
    ...overrides,
  };
}

function createRequest({ method = 'POST', origin = ALLOWED_ORIGIN, payload = VALID_PAYLOAD, headers = {} } = {}) {
  const requestHeaders = new Headers({ Origin: origin, ...headers });
  let body;
  if (payload !== undefined && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    requestHeaders.set('Content-Type', requestHeaders.get('Content-Type') ?? 'application/json');
    body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  }
  return new Request('https://worker.example/contact', { method, headers: requestHeaders, body });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('OPTIONS returns exact CORS headers for an allowed origin', async () => {
  const response = await handleRequest(createRequest({ method: 'OPTIONS', payload: undefined }), createEnv());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('rejects a disallowed origin without exposing CORS permission', async () => {
  let resendCalls = 0;
  const response = await handleRequest(
    createRequest({ origin: 'https://evil.example' }),
    createEnv(),
    { fetchImpl: async () => { resendCalls += 1; } },
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(resendCalls, 0);
});

test('rejects unsupported methods and content types', async () => {
  const methodResponse = await handleRequest(createRequest({ method: 'GET', payload: undefined }), createEnv());
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('Allow'), 'POST, OPTIONS');

  const typeResponse = await handleRequest(
    createRequest({ payload: 'plain text', headers: { 'Content-Type': 'text/plain' } }),
    createEnv(),
  );
  assert.equal(typeResponse.status, 415);
});

test('rejects invalid JSON, oversized content, and invalid fields before Resend', async () => {
  let resendCalls = 0;
  const options = { fetchImpl: async () => { resendCalls += 1; } };

  const invalidJson = await handleRequest(createRequest({ payload: '{' }), createEnv(), options);
  assert.equal(invalidJson.status, 400);

  const oversized = await handleRequest(
    createRequest({ payload: { ...VALID_PAYLOAD, requirements: 'x'.repeat(17000) } }),
    createEnv(),
    options,
  );
  assert.equal(oversized.status, 413);

  const invalidField = await handleRequest(
    createRequest({ payload: { ...VALID_PAYLOAD, workEmail: 'not-an-email' } }),
    createEnv(),
    options,
  );
  assert.equal(invalidField.status, 422);
  assert.equal(resendCalls, 0);
});

test('valid request sends fixed from/to, safe HTML, reply-to, and idempotency header', async () => {
  const calls = [];
  const env = createEnv();
  const response = await handleRequest(createRequest(), env, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: 'resend-email-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(response.status, 200);
  assert.equal((await readJson(response)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers['User-Agent'], 'melsy-contact-worker/1.0');
  assert.equal(calls[0].options.headers['Idempotency-Key'], `melsy-contact/${VALID_PAYLOAD.submissionId}`);
  const email = JSON.parse(calls[0].options.body);
  assert.equal(email.from, env.CONTACT_FROM_EMAIL);
  assert.deepEqual(email.to, [env.CONTACT_TO_EMAIL]);
  assert.equal(email.reply_to, VALID_PAYLOAD.workEmail);
  assert.match(email.html, /&lt;空间训练场&gt; &amp; COS/);
  assert.doesNotMatch(email.html, /<空间训练场>/);
  assert.equal(env.CONTACT_ACTOR_RATE_LIMITER.calls.length, 1);
  assert.equal(env.CONTACT_GLOBAL_RATE_LIMITER.calls.length, 1);
});

test('honeypot returns a generic success without sending email', async () => {
  let resendCalls = 0;
  const env = createEnv();
  const response = await handleRequest(
    createRequest({ payload: { ...VALID_PAYLOAD, fax: 'bot-filled' } }),
    env,
    { fetchImpl: async () => { resendCalls += 1; } },
  );
  assert.equal(response.status, 200);
  assert.equal((await readJson(response)).ok, true);
  assert.equal(resendCalls, 0);
  assert.equal(env.CONTACT_ACTOR_RATE_LIMITER.calls.length, 0);
});

test('rate limit and provider failure return stable errors without upstream details', async () => {
  const rateLimited = await handleRequest(
    createRequest(),
    createEnv({ CONTACT_ACTOR_RATE_LIMITER: createLimiter(false) }),
  );
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get('Retry-After'), '60');
  assert.equal((await readJson(rateLimited)).error.code, 'RATE_LIMITED');

  const providerFailure = await handleRequest(createRequest(), createEnv(), {
    fetchImpl: async () => new Response(JSON.stringify({ message: 'secret upstream detail' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.equal(providerFailure.status, 502);
  const payload = await readJson(providerFailure);
  assert.equal(payload.error.code, 'EMAIL_PROVIDER_ERROR');
  assert.doesNotMatch(JSON.stringify(payload), /secret upstream detail/);
});

test('missing runtime configuration fails closed and health remains non-sensitive', async () => {
  const missingConfig = await handleRequest(createRequest(), createEnv({ RESEND_API_KEY: '' }));
  assert.equal(missingConfig.status, 503);
  assert.equal((await readJson(missingConfig)).error.code, 'SERVICE_UNAVAILABLE');

  const health = await handleRequest(new Request('https://worker.example/health'), {});
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await readJson(health)).sort(), ['ok', 'requestId']);
});

test('email projection escapes every user value and keeps configuration authoritative', () => {
  const env = createEnv();
  const message = createEmailMessage({
    ...VALID_PAYLOAD,
    country: '<script>alert(1)</script>',
  }, env);
  assert.equal(message.from, env.CONTACT_FROM_EMAIL);
  assert.deepEqual(message.to, [env.CONTACT_TO_EMAIL]);
  assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(message.html, /<script>alert/);
});
