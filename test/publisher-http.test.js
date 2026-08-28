import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIcs } from '../src/domain/ics.js';
import { MAX_HTTP_BODY_BYTES, STATUS_PATH, createWorker } from '../publisher/worker.js';

const ORIGIN = 'https://lightcal-ics.pages.dev';
const TOKEN = 'A'.repeat(43);
const ICS = generateIcs([{
  id: 'work:day:2026-09-01',
  title: '07-16',
  allDay: true,
  startDate: '2026-09-01',
  endDateExclusive: '2026-09-02',
}], { generatedAt: '2026-08-28T04:00:00.000Z' });

async function tokenDigest(token = TOKEN) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function limiter(success = true) {
  const calls = [];
  return {
    calls,
    async limit(input) {
      calls.push(input);
      return { success };
    },
  };
}

async function environment(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    APP_OWNER: 'otherwise326',
    APP_REPO: 'lightcal-ics',
    OUTPUT_OWNER: 'otherwise326',
    OUTPUT_REPO: 'lightcal-ics-public',
    OUTPUT_BRANCH: 'main',
    OUTPUT_PREFIX: 'ics',
    PUBLIC_BASE_URL: 'https://otherwise326.github.io/lightcal-ics-public',
    GITHUB_TOKEN: 'github-placeholder-for-test-only',
    PUBLISHER_CLIENT_TOKEN_SHA256: await tokenDigest(),
    PRE_AUTH_RATE_LIMITER: limiter(),
    CLIENT_RATE_LIMITER: limiter(),
    STATUS_RATE_LIMITER: limiter(),
    ...overrides,
  };
}

function publishRequest({ token = TOKEN, origin = ORIGIN, body = { filename: '九月班表.ics', ics: ICS }, headers = {} } = {}) {
  return new Request('https://lightcal-ics-publisher.example.workers.dev/v1/publish', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('G5 worker publishes only to the fixed GitHub repository policy', async () => {
  const githubCalls = [];
  const worker = createWorker({
    async fetchImpl(url, init) {
      githubCalls.push({ url: String(url), init });
      if (!init?.method) return Response.json({ sha: null }, { status: 404 });
      return Response.json({ content: { sha: '1'.repeat(40) } }, { status: 201 });
    },
  });
  const env = await environment();
  const response = await worker.fetch(publishRequest(), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(payload.result.path, 'ics/九月班表.ics');
  assert.equal(payload.result.publicUrl, 'https://otherwise326.github.io/lightcal-ics-public/ics/%E4%B9%9D%E6%9C%88%E7%8F%AD%E8%A1%A8.ics');
  assert.match(githubCalls[0].url, /repos\/otherwise326\/lightcal-ics-public\/contents\/ics\/%E4%B9%9D%E6%9C%88%E7%8F%AD%E8%A1%A8\.ics\?ref=main$/u);
  assert.equal(githubCalls[1].init.method, 'PUT');
  assert.equal(githubCalls[1].init.headers.Authorization, 'Bearer github-placeholder-for-test-only');
  assert.deepEqual(env.PRE_AUTH_RATE_LIMITER.calls, [{ key: 'publish:203.0.113.10' }]);
  assert.deepEqual(env.CLIENT_RATE_LIMITER.calls, [{ key: 'publisher-client' }]);
});

test('G5 worker answers exact-origin CORS preflight without authentication', async () => {
  const worker = createWorker({ fetchImpl: async () => assert.fail('GitHub must not be called') });
  const response = await worker.fetch(new Request('https://publisher.example/v1/publish', {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
  }), await environment());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});

test('G5 worker checks GitHub Pages server-side without allowing an arbitrary URL', async () => {
  const publicCalls = [];
  const worker = createWorker({
    async fetchImpl(url, init) {
      publicCalls.push({ url: String(url), init });
      return new Response(ICS, { status: 200 });
    },
  });
  const request = publishRequest();
  const statusRequest = new Request(new URL(STATUS_PATH, request.url), {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ filename: '九月班表.ics', ics: ICS }),
  });
  const env = await environment();
  const response = await worker.fetch(statusRequest, env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.ready, true);
  assert.match(publicCalls[0].url, /^https:\/\/otherwise326\.github\.io\/lightcal-ics-public\/ics\//u);
  assert.equal(env.STATUS_RATE_LIMITER.calls.length, 1);
});

test('G5 worker rejects wrong origin and bearer token before GitHub', async () => {
  let githubCalls = 0;
  const worker = createWorker({ fetchImpl: async () => { githubCalls += 1; } });
  const env = await environment();
  const wrongOrigin = await worker.fetch(publishRequest({ origin: 'https://attacker.example' }), env);
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await wrongOrigin.json()).error.code, 'publisher_origin_forbidden');

  const wrongToken = await worker.fetch(publishRequest({ token: 'B'.repeat(43) }), env);
  assert.equal(wrongToken.status, 401);
  assert.equal((await wrongToken.json()).error.code, 'publisher_unauthorized');
  assert.equal(githubCalls, 0);
});

test('G5 worker enforces content type, HTTP body cap, and rate limit before GitHub', async () => {
  const worker = createWorker({ fetchImpl: async () => assert.fail('GitHub must not be called') });
  const env = await environment();
  const wrongType = await worker.fetch(publishRequest({ headers: { 'Content-Type': 'text/plain' } }), env);
  assert.equal(wrongType.status, 415);

  const tooLarge = await worker.fetch(publishRequest({ headers: { 'Content-Length': String(MAX_HTTP_BODY_BYTES + 1) } }), env);
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, 'publisher_request_too_large');

  const limitedEnv = await environment({ PRE_AUTH_RATE_LIMITER: limiter(false) });
  const limited = await worker.fetch(publishRequest(), limitedEnv);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'publisher_rate_limited');
});

test('G5 worker redacts GitHub upstream errors and credentials', async () => {
  const secret = 'github-placeholder-for-test-only';
  const worker = createWorker({ fetchImpl: async () => Response.json({ message: `Bad credentials ${secret}` }, { status: 401 }) });
  const response = await worker.fetch(publishRequest(), await environment({ GITHUB_TOKEN: secret }));
  const text = await response.text();
  assert.equal(response.status, 502);
  assert.match(text, /publisher_upstream_unauthorized/u);
  assert.doesNotMatch(text, new RegExp(secret));
  assert.doesNotMatch(text, new RegExp(TOKEN));
});
