const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

class GithubRequestError extends Error {
  constructor(status) {
    super('github_request_failed');
    this.name = 'GithubRequestError';
    this.status = status;
  }
}

function encodedPath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'lightcal-ics-publisher',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    throw new GithubRequestError(502);
  }
}

export function createGithubContentsClient({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('github_token_required');
  if (typeof fetchImpl !== 'function') throw new Error('github_fetch_required');

  return Object.freeze({
    async getContent({ owner, repo, path, ref }) {
      const url = new URL(`${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath(path)}`);
      url.searchParams.set('ref', ref);
      const response = await fetchImpl(url, { headers: headers(token) });
      if (response.status === 404) return null;
      if (!response.ok) throw new GithubRequestError(response.status);
      const payload = await safeJson(response);
      return { sha: payload?.sha };
    },

    async putContent({ owner, repo, path, branch, message, contentBase64, sha }) {
      const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath(path)}`;
      const response = await fetchImpl(url, {
        method: 'PUT',
        headers: headers(token),
        body: JSON.stringify({
          message,
          content: contentBase64,
          branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!response.ok) throw new GithubRequestError(response.status);
      const payload = await safeJson(response);
      return { sha: payload?.content?.sha };
    },
  });
}
