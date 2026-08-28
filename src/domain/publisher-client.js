export const PUBLISHER_CREDENTIAL_STORAGE_KEY = 'lightcal-ics.publisher-credential';

function normalizedToken(value) {
  const token = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(token)) throw new Error('publisher_client_token_invalid');
  return token;
}

function normalizeSecureUrl(value) {
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('publisher_endpoint_invalid');
  }
  const localHttp = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if ((!localHttp && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('publisher_endpoint_invalid');
  }
  return parsed.href;
}

export function normalizePublisherEndpoint(value) {
  const normalized = normalizeSecureUrl(value);
  if (!normalized) return '';
  const parsed = new URL(normalized);
  if (parsed.pathname !== '/v1/publish') throw new Error('publisher_endpoint_invalid');
  return normalized;
}

function normalizePublicIcsUrl(value) {
  const normalized = normalizeSecureUrl(value);
  if (!normalized || !new URL(normalized).pathname.toLowerCase().endsWith('.ics')) {
    throw new Error('publisher_response_invalid');
  }
  return normalized;
}

function statusEndpoint(endpoint) {
  const parsed = new URL(normalizePublisherEndpoint(endpoint));
  parsed.pathname = '/v1/status';
  return parsed.href;
}

export function createPublisherCredentialStorage(storage, { key = PUBLISHER_CREDENTIAL_STORAGE_KEY } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
    throw new Error('storage_adapter_required');
  }
  return Object.freeze({
    load() {
      const raw = storage.getItem(key);
      if (!raw) return '';
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.schemaVersion !== 1 || parsed?.type !== 'publisherCredential') return '';
        return normalizedToken(parsed.token);
      } catch {
        return '';
      }
    },
    save(value) {
      const token = normalizedToken(value);
      storage.setItem(key, JSON.stringify({ schemaVersion: 1, type: 'publisherCredential', token }));
      return token;
    },
    clear() {
      storage.removeItem(key);
    },
  });
}

function normalizePublishResult(payload) {
  const result = payload?.result;
  if (payload?.ok !== true || !result || typeof result !== 'object') throw new Error('publisher_response_invalid');
  const publicUrl = normalizePublicIcsUrl(result.publicUrl);
  if (!['created', 'replaced'].includes(result.operation)) throw new Error('publisher_response_invalid');
  return Object.freeze({
    filename: String(result.filename ?? ''),
    path: String(result.path ?? ''),
    bytes: Number(result.bytes),
    operation: result.operation,
    publicUrl,
  });
}

export async function publishIcs({ endpoint, token, filename, ics, fetchImpl = fetch } = {}) {
  const url = normalizePublisherEndpoint(endpoint);
  if (!url) throw new Error('publisher_endpoint_missing');
  const credential = normalizedToken(token);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, ics }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('publisher_response_invalid');
  }
  if (!response.ok) {
    const code = String(payload?.error?.code ?? 'publisher_request_failed');
    const error = new Error(code);
    error.status = response.status;
    throw error;
  }
  return normalizePublishResult(payload);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForPublishedIcs({
  endpoint,
  token,
  filename,
  expectedIcs,
  fetchImpl = fetch,
  maxAttempts = 60,
  intervalMs = 10_000,
  sleepImpl = wait,
} = {}) {
  const url = statusEndpoint(endpoint);
  const credential = normalizedToken(token);
  if (typeof filename !== 'string' || !filename) throw new Error('publisher_filename_required');
  if (typeof expectedIcs !== 'string' || !expectedIcs) throw new Error('publisher_expected_ics_required');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('publisher_check_attempts_invalid');
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename, ics: expectedIcs }),
      });
      const payload = await response.json();
      if (response.ok && payload?.ok === true && payload?.result?.ready === true) return true;
      if (!response.ok && ['publisher_unauthorized', 'publisher_rate_limited'].includes(payload?.error?.code)) {
        const error = new Error(payload.error.code);
        error.status = response.status;
        throw error;
      }
    } catch (error) {
      if (['publisher_unauthorized', 'publisher_rate_limited'].includes(error?.message)) throw error;
      // The Worker or GitHub Pages may be between deployments; retry within the bounded window.
    }
    if (attempt < maxAttempts - 1) await sleepImpl(intervalMs);
  }
  throw new Error('publisher_public_file_pending');
}
