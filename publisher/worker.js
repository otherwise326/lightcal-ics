import {
  PublisherError,
  createPublisher,
  createRepositoryPolicy,
  publicUrlForPath,
  validatePublishRequest,
} from './index.js';
import { createGithubContentsClient } from './github.js';

export const MAX_HTTP_BODY_BYTES = 320 * 1024;
export const PUBLISH_PATH = '/v1/publish';
export const STATUS_PATH = '/v1/status';

class HttpError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
  }
}

function reject(code, status) {
  throw new HttpError(code, status);
}

function requiredEnv(env, key) {
  const value = String(env?.[key] ?? '').trim();
  if (!value) reject('publisher_runtime_misconfigured', 503);
  return value;
}

function allowedOrigin(env) {
  const value = requiredEnv(env, 'ALLOWED_ORIGIN');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    reject('publisher_runtime_misconfigured', 503);
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.pathname !== '/') {
    reject('publisher_runtime_misconfigured', 503);
  }
  return parsed.origin;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function responseHeaders(origin) {
  return {
    ...corsHeaders(origin),
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function jsonResponse(payload, status, origin) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders(origin) });
}

function safeErrorResponse(error, origin) {
  const known = error instanceof HttpError || error instanceof PublisherError;
  const code = known ? error.code : 'publisher_internal_error';
  const status = known ? error.status : 500;
  return jsonResponse({ ok: false, error: { code } }, status, origin);
}

async function bodyText(request) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_BODY_BYTES) {
    reject('publisher_request_too_large', 413);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTTP_BODY_BYTES) reject('publisher_request_too_large', 413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    reject('publisher_request_invalid_json', 400);
  } finally {
    reader.releaseLock();
  }
}

async function requestJson(request) {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') reject('publisher_content_type_required', 415);
  const raw = await bodyText(request);
  try {
    return JSON.parse(raw);
  } catch {
    reject('publisher_request_invalid_json', 400);
  }
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/iu.test(value)) reject('publisher_runtime_misconfigured', 503);
  return Uint8Array.from(value.match(/.{2}/gu), (pair) => Number.parseInt(pair, 16));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function authenticate(request, env) {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/u.exec(authorization);
  const supplied = await sha256(match?.[1] ?? '');
  const expected = hexToBytes(requiredEnv(env, 'PUBLISHER_CLIENT_TOKEN_SHA256'));
  if (!match || !timingSafeEqual(supplied, expected)) reject('publisher_unauthorized', 401);
}

async function applyRateLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') reject('publisher_runtime_misconfigured', 503);
  const result = await binding.limit({ key });
  if (!result?.success) reject('publisher_rate_limited', 429);
}

function repositoryPolicy(env) {
  return {
    owner: requiredEnv(env, 'OUTPUT_OWNER'),
    repo: requiredEnv(env, 'OUTPUT_REPO'),
    branch: requiredEnv(env, 'OUTPUT_BRANCH'),
    outputPrefix: requiredEnv(env, 'OUTPUT_PREFIX'),
    publicBaseUrl: requiredEnv(env, 'PUBLIC_BASE_URL'),
    appCodeRepository: {
      owner: requiredEnv(env, 'APP_OWNER'),
      repo: requiredEnv(env, 'APP_REPO'),
    },
  };
}

async function publish(request, env, fetchImpl) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  await applyRateLimit(env.PRE_AUTH_RATE_LIMITER, `publish:${ip}`);
  await authenticate(request, env);
  await applyRateLimit(env.CLIENT_RATE_LIMITER, 'publisher-client');
  const input = await requestJson(request);
  const github = createGithubContentsClient({ token: requiredEnv(env, 'GITHUB_TOKEN'), fetchImpl });
  return createPublisher({ policy: repositoryPolicy(env), github }).publish(input);
}

async function publicationStatus(request, env, fetchImpl) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  await applyRateLimit(env.PRE_AUTH_RATE_LIMITER, `status:${ip}`);
  await authenticate(request, env);
  await applyRateLimit(env.STATUS_RATE_LIMITER, 'publisher-client');
  const input = validatePublishRequest(await requestJson(request));
  const policy = createRepositoryPolicy(repositoryPolicy(env));
  const path = `${policy.outputPrefix}/${input.filename}`;
  const publicUrl = publicUrlForPath(policy, path);
  const checkUrl = new URL(publicUrl);
  checkUrl.searchParams.set('lightcal-check', crypto.randomUUID());
  let ready = false;
  try {
    const response = await fetchImpl(checkUrl, { cache: 'no-store' });
    ready = response.ok && await response.text() === input.ics;
  } catch {
    ready = false;
  }
  return Object.freeze({ ready, publicUrl });
}

export function createWorker({ fetchImpl = fetch } = {}) {
  return Object.freeze({
    async fetch(request, env) {
      let origin;
      try {
        origin = allowedOrigin(env);
      } catch (error) {
        return safeErrorResponse(error, 'null');
      }
      try {
        const requestOrigin = request.headers.get('Origin');
        if (requestOrigin !== origin) reject('publisher_origin_forbidden', 403);
        const url = new URL(request.url);
        if (![PUBLISH_PATH, STATUS_PATH].includes(url.pathname) || url.search) reject('publisher_route_not_found', 404);
        if (request.method === 'OPTIONS') {
          if (request.headers.get('Access-Control-Request-Method') !== 'POST') reject('publisher_preflight_forbidden', 403);
          return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }
        if (request.method !== 'POST') reject('publisher_method_not_allowed', 405);
        const result = url.pathname === PUBLISH_PATH
          ? await publish(request, env, fetchImpl)
          : await publicationStatus(request, env, fetchImpl);
        return jsonResponse({ ok: true, result }, 200, origin);
      } catch (error) {
        return safeErrorResponse(error, origin);
      }
    },
  });
}

export default createWorker();
