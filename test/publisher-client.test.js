import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublisherCredentialStorage,
  normalizePublisherEndpoint,
  publishIcs,
  waitForPublishedIcs,
} from '../src/domain/publisher-client.js';

const TOKEN = 'A'.repeat(43);
const ENDPOINT = 'https://lightcal-ics-publisher.example.workers.dev/v1/publish';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('G5 publisher credential stays in a separate versioned device-local record', () => {
  const storage = memoryStorage();
  const adapter = createPublisherCredentialStorage(storage);
  assert.equal(adapter.load(), '');
  assert.equal(adapter.save(TOKEN), TOKEN);
  assert.equal(adapter.load(), TOKEN);
  assert.match(storage.getItem('lightcal-ics.publisher-credential'), /publisherCredential/u);
  assert.throws(() => adapter.save('short'), /publisher_client_token_invalid/u);
  adapter.clear();
  assert.equal(adapter.load(), '');
});

test('G5 publisher client sends only filename plus ICS with bearer authentication', async () => {
  const calls = [];
  const result = await publishIcs({
    endpoint: ENDPOINT,
    token: TOKEN,
    filename: '班表.ics',
    ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        result: {
          filename: '班表.ics',
          path: 'ics/班表.ics',
          bytes: 37,
          operation: 'created',
          publicUrl: 'https://otherwise326.github.io/lightcal-ics-public/ics/%E7%8F%AD%E8%A1%A8.ics',
        },
      });
    },
  });
  assert.equal(result.operation, 'created');
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    filename: '班表.ics',
    ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
  });
});

test('G5 publisher client rejects insecure endpoints and preserves safe server error codes', async () => {
  assert.throws(() => normalizePublisherEndpoint('http://publisher.example/v1/publish'), /publisher_endpoint_invalid/u);
  assert.equal(normalizePublisherEndpoint('http://127.0.0.1:8787/v1/publish'), 'http://127.0.0.1:8787/v1/publish');
  await assert.rejects(publishIcs({
    endpoint: ENDPOINT,
    token: TOKEN,
    filename: '班表.ics',
    ics: 'calendar',
    fetchImpl: async () => Response.json({ ok: false, error: { code: 'publisher_rate_limited' } }, { status: 429 }),
  }), (error) => error.message === 'publisher_rate_limited' && error.status === 429);
});

test('G5 public URL check waits until GitHub Pages serves the exact published ICS', async () => {
  const expectedIcs = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
  const responses = [
    Response.json({ ok: true, result: { ready: false } }),
    Response.json({ ok: true, result: { ready: false } }),
    Response.json({ ok: true, result: { ready: true } }),
  ];
  const sleeps = [];
  const calls = [];
  const result = await waitForPublishedIcs({
    endpoint: ENDPOINT,
    token: TOKEN,
    filename: 'test.ics',
    expectedIcs,
    maxAttempts: 3,
    intervalMs: 1,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    sleepImpl: async (delay) => sleeps.push(delay),
  });
  assert.equal(result, true);
  assert.deepEqual(sleeps, [1, 1]);
  assert.equal(calls[0].url, 'https://lightcal-ics-publisher.example.workers.dev/v1/status');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { filename: 'test.ics', ics: expectedIcs });

  await assert.rejects(waitForPublishedIcs({
    endpoint: ENDPOINT,
    token: TOKEN,
    filename: 'test.ics',
    expectedIcs,
    maxAttempts: 1,
    fetchImpl: async () => Response.json({ ok: true, result: { ready: false } }),
  }), /publisher_public_file_pending/u);
});
