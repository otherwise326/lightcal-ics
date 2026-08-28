import { sanitizeIcsFilename } from '../src/domain/schedule.js';

export const MAX_ICS_BYTES = 256 * 1024;
export const MAX_FILENAME_BYTES = 180;

const encoder = new TextEncoder();
const ALLOWED_COMPONENTS = new Set(['VCALENDAR', 'VTIMEZONE', 'STANDARD', 'VEVENT', 'VALARM']);

export class PublisherError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'PublisherError';
    this.code = code;
    this.status = status;
  }
}

function reject(code, status) {
  throw new PublisherError(code, status);
}

function requiredConfigText(value, code) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u001f\u007f]/u.test(text)) reject(code, 500);
  return text;
}

function validateRepositoryName(value, code) {
  const text = requiredConfigText(value, code);
  if (!/^[A-Za-z0-9_.-]+$/u.test(text) || text === '.' || text === '..') reject(code, 500);
  return text;
}

function validateBranch(value) {
  const branch = requiredConfigText(value, 'publisher_branch_invalid');
  if (!/^[A-Za-z0-9._/-]+$/u.test(branch)
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('..')
    || branch.includes('//')) {
    reject('publisher_branch_invalid', 500);
  }
  return branch;
}

function validateOutputPrefix(value) {
  const prefix = requiredConfigText(value, 'publisher_output_prefix_invalid');
  if (prefix.startsWith('/') || prefix.endsWith('/')) reject('publisher_output_prefix_invalid', 500);
  const segments = prefix.split('/');
  if (segments.some((segment) => !/^[A-Za-z0-9_.-]+$/u.test(segment) || segment === '.' || segment === '..')) {
    reject('publisher_output_prefix_invalid', 500);
  }
  return prefix;
}

function validatePublicBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(requiredConfigText(value, 'publisher_public_base_url_invalid'));
  } catch {
    reject('publisher_public_base_url_invalid', 500);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    reject('publisher_public_base_url_invalid', 500);
  }
  return parsed.href.replace(/\/$/u, '');
}

export function createRepositoryPolicy(input) {
  const appCodeRepository = {
    owner: validateRepositoryName(input?.appCodeRepository?.owner, 'publisher_app_owner_invalid'),
    repo: validateRepositoryName(input?.appCodeRepository?.repo, 'publisher_app_repo_invalid'),
  };
  const policy = {
    owner: validateRepositoryName(input?.owner, 'publisher_owner_invalid'),
    repo: validateRepositoryName(input?.repo, 'publisher_repo_invalid'),
    branch: validateBranch(input?.branch),
    outputPrefix: validateOutputPrefix(input?.outputPrefix),
    publicBaseUrl: validatePublicBaseUrl(input?.publicBaseUrl),
    appCodeRepository: Object.freeze(appCodeRepository),
  };
  if (policy.owner === appCodeRepository.owner && policy.repo === appCodeRepository.repo) {
    reject('publisher_repository_separation_required', 500);
  }
  return Object.freeze(policy);
}

export function validateFilename(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) reject('publisher_filename_invalid');
  if (encoder.encode(value).length > MAX_FILENAME_BYTES) reject('publisher_filename_too_long');
  if (sanitizeIcsFilename(value) !== value || value === '.ics' || /[/\\]/u.test(value)) reject('publisher_filename_invalid');
  return value;
}

function validatePhysicalLines(ics) {
  if (!ics.endsWith('\r\n') || /(?<!\r)\n|\r(?!\n)/u.test(ics)) reject('publisher_ics_invalid_line_endings');
  const physicalLines = ics.slice(0, -2).split('\r\n');
  if (physicalLines.some((line) => line.length === 0 || encoder.encode(line).length > 75)) reject('publisher_ics_invalid_content_line');
  return physicalLines;
}

function unfoldLines(physicalLines) {
  const logicalLines = [];
  for (const line of physicalLines) {
    if (/^[ \t]/u.test(line)) {
      if (logicalLines.length === 0) reject('publisher_ics_invalid_folding');
      logicalLines[logicalLines.length - 1] += line.slice(1);
    } else {
      logicalLines.push(line);
    }
  }
  return logicalLines;
}

function validateComponentTree(lines) {
  const stack = [];
  const eventProperties = [];
  const eventUids = new Set();
  let currentEvent;
  let calendarCount = 0;
  let eventCount = 0;
  for (const line of lines) {
    const begin = /^BEGIN:([A-Z0-9-]+)$/u.exec(line);
    if (begin) {
      const component = begin[1];
      if (!ALLOWED_COMPONENTS.has(component)) reject('publisher_ics_component_not_allowed');
      if (component === 'VCALENDAR') {
        calendarCount += 1;
        if (stack.length !== 0) reject('publisher_ics_invalid_component_tree');
      } else if (stack.length === 0 || stack[0] !== 'VCALENDAR') {
        reject('publisher_ics_invalid_component_tree');
      }
      if (component === 'VEVENT') {
        if (stack.at(-1) !== 'VCALENDAR') reject('publisher_ics_invalid_component_tree');
        currentEvent = new Set();
        eventProperties.push(currentEvent);
        eventCount += 1;
      }
      if (component === 'VTIMEZONE' && stack.at(-1) !== 'VCALENDAR') reject('publisher_ics_invalid_component_tree');
      if (component === 'VALARM' && stack.at(-1) !== 'VEVENT') reject('publisher_ics_invalid_component_tree');
      if (component === 'STANDARD' && stack.at(-1) !== 'VTIMEZONE') reject('publisher_ics_invalid_component_tree');
      stack.push(component);
      continue;
    }

    const end = /^END:([A-Z0-9-]+)$/u.exec(line);
    if (end) {
      const component = end[1];
      if (stack.pop() !== component) reject('publisher_ics_invalid_component_tree');
      if (component === 'VEVENT') currentEvent = undefined;
      continue;
    }

    const property = /^([A-Z0-9-]+)(?:;[^:]*)?:(.*)$/u.exec(line);
    if (!property || stack.length === 0) reject('publisher_ics_invalid_content_line');
    if (currentEvent && stack.at(-1) === 'VEVENT') {
      if (property[1] === 'UID' && currentEvent.has('UID')) reject('publisher_ics_duplicate_or_empty_uid');
      currentEvent.add(property[1]);
      if (property[1] === 'UID') {
        if (!property[2] || eventUids.has(property[2])) reject('publisher_ics_duplicate_or_empty_uid');
        eventUids.add(property[2]);
      }
    }
  }
  if (stack.length !== 0 || calendarCount !== 1 || eventCount < 1) reject('publisher_ics_invalid_component_tree');
  for (const properties of eventProperties) {
    for (const required of ['UID', 'DTSTART', 'DTEND', 'SUMMARY']) {
      if (!properties.has(required)) reject('publisher_ics_event_contract_missing');
    }
  }
}

export function validateIcs(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) reject('publisher_ics_invalid');
  const size = encoder.encode(value).length;
  if (size > MAX_ICS_BYTES) reject('publisher_ics_too_large', 413);
  const physicalLines = validatePhysicalLines(value);
  const logicalLines = unfoldLines(physicalLines);
  if (logicalLines[0] !== 'BEGIN:VCALENDAR' || logicalLines.at(-1) !== 'END:VCALENDAR') reject('publisher_ics_invalid_calendar');
  if (!logicalLines.includes('VERSION:2.0') || !logicalLines.some((line) => line.startsWith('PRODID:')) || !logicalLines.includes('METHOD:PUBLISH')) {
    reject('publisher_ics_calendar_contract_missing');
  }
  validateComponentTree(logicalLines);
  return { ics: value, bytes: size };
}

export function validatePublishRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('publisher_request_invalid');
  const keys = Object.keys(input).sort();
  if (keys.length !== 2 || keys[0] !== 'filename' || keys[1] !== 'ics') reject('publisher_request_fields_invalid');
  const filename = validateFilename(input.filename);
  const { ics, bytes } = validateIcs(input.ics);
  return Object.freeze({ filename, ics, bytes });
}

function githubStatus(error) {
  return Number(error?.status ?? error?.response?.status);
}

async function callGithub(operation) {
  try {
    return await operation();
  } catch (error) {
    const status = githubStatus(error);
    if (status === 401 || status === 403) reject('publisher_upstream_unauthorized', 502);
    if (status === 409) throw new PublisherError('publisher_write_conflict', 409);
    throw new PublisherError('publisher_upstream_failed', 502);
  }
}

function validateGithubSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/iu.test(value)) reject('publisher_upstream_invalid_response', 502);
  return value;
}

async function readGithubContent(github, target) {
  const current = await callGithub(() => github.getContent(target));
  if (current === null) return null;
  return { sha: validateGithubSha(current?.sha) };
}

function encodedPublicUrl(policy, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${policy.publicBaseUrl}/${encodedPath}`;
}

export function createPublisher({ policy: policyInput, github }) {
  const policy = createRepositoryPolicy(policyInput);
  if (!github || typeof github.getContent !== 'function' || typeof github.putContent !== 'function') {
    reject('publisher_github_client_invalid', 500);
  }

  return Object.freeze({
    async publish(input) {
      const request = validatePublishRequest(input);
      const path = `${policy.outputPrefix}/${request.filename}`;
      const target = { owner: policy.owner, repo: policy.repo, path, ref: policy.branch };
      let current = await readGithubContent(github, target);
      let operation = current ? 'replaced' : 'created';
      const write = () => github.putContent({
        owner: policy.owner,
        repo: policy.repo,
        path,
        branch: policy.branch,
        message: `Publish ${request.filename}`,
        contentBase64: Buffer.from(request.ics, 'utf8').toString('base64'),
        ...(current?.sha ? { sha: current.sha } : {}),
      });

      let written;
      try {
        written = await callGithub(write);
      } catch (error) {
        if (error?.code !== 'publisher_write_conflict') throw error;
        current = await readGithubContent(github, target);
        if (!current?.sha) throw error;
        operation = 'replaced';
        try {
          written = await callGithub(write);
        } catch (retryError) {
          if (retryError?.code === 'publisher_write_conflict') reject('publisher_write_conflict', 409);
          throw retryError;
        }
      }

      const writtenSha = validateGithubSha(written?.sha);
      return Object.freeze({
        filename: request.filename,
        path,
        bytes: request.bytes,
        operation,
        sha: writtenSha,
        publicUrl: encodedPublicUrl(policy, path),
      });
    },
  });
}
