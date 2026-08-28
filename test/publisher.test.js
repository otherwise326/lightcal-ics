import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIcs } from '../src/domain/ics.js';
import {
  MAX_ICS_BYTES,
  PublisherError,
  createPublisher,
  createRepositoryPolicy,
  validateIcs,
  validatePublishRequest,
} from '../publisher/index.js';

const ICS = generateIcs([{
  id: 'work:day:2026-09-01',
  title: '07-16',
  allDay: true,
  startDate: '2026-09-01',
  endDateExclusive: '2026-09-02',
}], { generatedAt: '2026-08-28T04:00:00.000Z' });

const POLICY = {
  owner: 'lightcal-owner',
  repo: 'lightcal-public-ics',
  branch: 'main',
  outputPrefix: 'published',
  publicBaseUrl: 'https://lightcal-owner.github.io/lightcal-public-ics',
  appCodeRepository: { owner: 'lightcal-owner', repo: 'lightcal-ics' },
};

const SHA = {
  new: '1'.repeat(40),
  old: '2'.repeat(40),
  replacement: '3'.repeat(40),
  fresh: '4'.repeat(40),
  retried: '5'.repeat(40),
};

function mockGithub({ existingSha = null, putSteps = [{ sha: SHA.new }], getSteps } = {}) {
  const calls = [];
  const reads = getSteps ? [...getSteps] : [{ sha: existingSha }];
  const writes = [...putSteps];
  return {
    calls,
    async getContent(input) {
      calls.push({ method: 'get', input });
      const step = reads.shift();
      if (step instanceof Error || step?.status) throw step;
      return step?.sha ? step : null;
    },
    async putContent(input) {
      calls.push({ method: 'put', input });
      const step = writes.shift();
      if (step instanceof Error || step?.status) throw step;
      return step;
    },
  };
}

function assertPublisherError(fn, code) {
  assert.throws(fn, (error) => error instanceof PublisherError && error.code === code);
}

test('publisher creates only the fixed repository path and returns a stable public URL', async () => {
  const github = mockGithub();
  const publisher = createPublisher({ policy: POLICY, github });
  const result = await publisher.publish({ filename: '九月班表.ics', ics: ICS });
  assert.deepEqual(result, {
    filename: '九月班表.ics',
    path: 'published/九月班表.ics',
    bytes: new TextEncoder().encode(ICS).length,
    operation: 'created',
    sha: SHA.new,
    publicUrl: 'https://lightcal-owner.github.io/lightcal-public-ics/published/%E4%B9%9D%E6%9C%88%E7%8F%AD%E8%A1%A8.ics',
  });
  assert.deepEqual(github.calls.map(({ method }) => method), ['get', 'put']);
  assert.deepEqual(github.calls[1].input, {
    owner: 'lightcal-owner',
    repo: 'lightcal-public-ics',
    path: 'published/九月班表.ics',
    branch: 'main',
    message: 'Publish 九月班表.ics',
    contentBase64: Buffer.from(ICS).toString('base64'),
  });
});

test('publisher replaces an existing file with its SHA and keeps the same public URL', async () => {
  const github = mockGithub({ existingSha: SHA.old, putSteps: [{ sha: SHA.replacement }] });
  const result = await createPublisher({ policy: POLICY, github }).publish({ filename: '九月班表.ics', ics: ICS });
  assert.equal(result.operation, 'replaced');
  assert.equal(result.publicUrl, 'https://lightcal-owner.github.io/lightcal-public-ics/published/%E4%B9%9D%E6%9C%88%E7%8F%AD%E8%A1%A8.ics');
  assert.equal(github.calls[1].input.sha, SHA.old);
});

test('one SHA conflict refetches and retries once with the newest SHA', async () => {
  const github = mockGithub({
    getSteps: [{ sha: SHA.old }, { sha: SHA.fresh }],
    putSteps: [{ status: 409 }, { sha: SHA.retried }],
  });
  const result = await createPublisher({ policy: POLICY, github }).publish({ filename: '班表.ics', ics: ICS });
  assert.equal(result.operation, 'replaced');
  assert.equal(result.sha, SHA.retried);
  assert.deepEqual(github.calls.map(({ method }) => method), ['get', 'put', 'get', 'put']);
  assert.equal(github.calls[3].input.sha, SHA.fresh);
});

test('a repeated SHA conflict fails explicitly after one bounded retry', async () => {
  const github = mockGithub({
    getSteps: [{ sha: SHA.old }, { sha: SHA.fresh }],
    putSteps: [{ status: 409 }, { status: 409 }],
  });
  await assert.rejects(
    createPublisher({ policy: POLICY, github }).publish({ filename: '班表.ics', ics: ICS }),
    (error) => error instanceof PublisherError && error.code === 'publisher_write_conflict' && error.status === 409,
  );
});

test('request accepts exactly filename plus complete ICS and never an arbitrary path', () => {
  assert.deepEqual(validatePublishRequest({ filename: '班表.ics', ics: ICS }), {
    filename: '班表.ics',
    ics: ICS,
    bytes: new TextEncoder().encode(ICS).length,
  });
  assertPublisherError(() => validatePublishRequest({ filename: '班表.ics', ics: ICS, path: '../app/index.html' }), 'publisher_request_fields_invalid');
  assertPublisherError(() => validatePublishRequest({ filename: '../班表.ics', ics: ICS }), 'publisher_filename_invalid');
  assertPublisherError(() => validatePublishRequest({ filename: 'folder/班表.ics', ics: ICS }), 'publisher_filename_invalid');
});

test('invalid, incomplete, duplicate-UID, non-CRLF, and oversized ICS are rejected', () => {
  assertPublisherError(() => validateIcs('not a calendar'), 'publisher_ics_invalid_line_endings');
  assertPublisherError(() => validateIcs(ICS.replace('METHOD:PUBLISH\r\n', '')), 'publisher_ics_calendar_contract_missing');
  assertPublisherError(() => validateIcs(ICS.replace('DTEND;VALUE=DATE:20260902\r\n', '')), 'publisher_ics_event_contract_missing');
  const duplicate = ICS.replace('END:VCALENDAR\r\n', `${ICS.slice(ICS.indexOf('BEGIN:VEVENT'), ICS.indexOf('END:VEVENT') + 'END:VEVENT\r\n'.length)}END:VCALENDAR\r\n`);
  assertPublisherError(() => validateIcs(duplicate), 'publisher_ics_duplicate_or_empty_uid');
  const twoUids = ICS.replace('UID:work%3Aday%3A2026-09-01@lightcal-ics.local\r\n', 'UID:first@lightcal-ics.local\r\nUID:second@lightcal-ics.local\r\n');
  assertPublisherError(() => validateIcs(twoUids), 'publisher_ics_duplicate_or_empty_uid');
  assertPublisherError(() => validateIcs(ICS.replaceAll('\r\n', '\n')), 'publisher_ics_invalid_line_endings');
  const oversized = `BEGIN:VCALENDAR\r\n${'A'.repeat(MAX_ICS_BYTES)}\r\nEND:VCALENDAR\r\n`;
  assertPublisherError(() => validateIcs(oversized), 'publisher_ics_too_large');
});

test('bad GitHub credentials fail closed without leaking the upstream error or secret', async () => {
  const secret = 'server-only-secret-never-expose';
  const github = mockGithub({ getSteps: [{ status: 401, message: `Bad credentials ${secret}` }] });
  await assert.rejects(
    createPublisher({ policy: POLICY, github }).publish({ filename: '班表.ics', ics: ICS }),
    (error) => {
      assert.equal(error.code, 'publisher_upstream_unauthorized');
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    },
  );
});

test('malformed GitHub SHA responses fail closed before they are trusted', async () => {
  await assert.rejects(
    createPublisher({ policy: POLICY, github: mockGithub({ getSteps: [{ sha: 'not-a-git-sha' }] }) })
      .publish({ filename: '班表.ics', ics: ICS }),
    (error) => error instanceof PublisherError && error.code === 'publisher_upstream_invalid_response',
  );
  await assert.rejects(
    createPublisher({ policy: POLICY, github: mockGithub({ putSteps: [{ sha: 'not-a-git-sha' }] }) })
      .publish({ filename: '班表.ics', ics: ICS }),
    (error) => error instanceof PublisherError && error.code === 'publisher_upstream_invalid_response',
  );
});

test('repository policy is fixed server configuration and rejects unsafe values', () => {
  assert.deepEqual(createRepositoryPolicy(POLICY), POLICY);
  assertPublisherError(() => createRepositoryPolicy({ ...POLICY, repo: '../app-code' }), 'publisher_repo_invalid');
  assertPublisherError(() => createRepositoryPolicy({ ...POLICY, outputPrefix: '../published' }), 'publisher_output_prefix_invalid');
  assertPublisherError(() => createRepositoryPolicy({ ...POLICY, publicBaseUrl: 'http://example.com/ics' }), 'publisher_public_base_url_invalid');
  assertPublisherError(() => createRepositoryPolicy({ ...POLICY, outputPrefix: '/published' }), 'publisher_output_prefix_invalid');
  assertPublisherError(() => createRepositoryPolicy({ ...POLICY, repo: 'lightcal-ics' }), 'publisher_repository_separation_required');
});
