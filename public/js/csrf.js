// csrf.js — fetches and caches a CSRF token, wraps fetch for state-changing requests

let csrfTokenCache = null;

async function getCsrfToken() {
  if (csrfTokenCache) return csrfTokenCache;
  const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  const data = await res.json();
  csrfTokenCache = data.csrfToken;
  return csrfTokenCache;
}

// Drop-in replacement for fetch on any POST/PUT/PATCH/DELETE call.
async function secureFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = await getCsrfToken();
    headers['x-csrf-token'] = token;
  }

  return fetch(url, { ...options, credentials: 'include', headers });
}
