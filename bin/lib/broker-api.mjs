const DEFAULT_BASE_URL = 'https://hol.org/registry/api/v1';

export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  const withoutTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailing.endsWith('/api/v1')) {
    return withoutTrailing;
  }
  if (withoutTrailing.endsWith('/registry')) {
    return `${withoutTrailing}/api/v1`;
  }
  return `${withoutTrailing}/api/v1`;
}

async function summarizeErrorBody(response) {
  const text = await response.text();
  if (!text) {
    return '';
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

export async function requestJson(params) {
  const headers = {
    'content-type': 'application/json',
    ...(params.headers ?? {}),
  };
  const response = await fetch(params.url, {
    method: params.method,
    headers,
    body: params.body ? JSON.stringify(params.body) : undefined,
    signal: params.signal,
  });
  if (!response.ok) {
    const bodySummary = await summarizeErrorBody(response);
    throw new Error(
      `${params.method} ${params.url} failed with ${response.status}${bodySummary ? `: ${bodySummary}` : ''}`,
    );
  }
  return response.json();
}

export async function requestJsonWithTimeout(url, headers = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestJson({
      method: 'GET',
      url,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBalance(baseUrl, apiKey, accountId) {
  const query = new URLSearchParams({ accountId });
  const response = await requestJson({
    method: 'GET',
    url: `${baseUrl}/credits/balance?${query.toString()}`,
    headers: {
      'x-api-key': apiKey,
      'x-account-id': accountId,
    },
  });
  const balance = Number(response?.balance ?? 0);
  return Number.isFinite(balance) ? balance : 0;
}

export async function fetchProviders(baseUrl, apiKey = '', accountId = '') {
  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  if (accountId) {
    headers['x-account-id'] = accountId;
  }
  return requestJson({
    method: 'GET',
    url: `${baseUrl}/credits/providers`,
    headers,
  });
}
