import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORE_VERSION = 1;

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return 'https://hol.org/registry/api/v1';
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

function resolveStorePath(customPath = '') {
  if (customPath && customPath.trim().length > 0) {
    return path.resolve(process.cwd(), customPath.trim());
  }
  return path.join(os.homedir(), '.skill-publish', 'credentials.json');
}

function parseStore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: STORE_VERSION, entries: [] };
  }
  const typed = raw;
  const entries = Array.isArray(typed.entries)
    ? typed.entries.filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
      }
      const candidate = entry;
      return (
        typeof candidate.baseUrl === 'string' &&
        candidate.baseUrl.trim().length > 0 &&
        typeof candidate.accountId === 'string' &&
        candidate.accountId.trim().length > 0 &&
        typeof candidate.apiKey === 'string' &&
        candidate.apiKey.trim().length > 0
      );
    })
    : [];
  return {
    version: STORE_VERSION,
    entries: entries.map((entry) => ({
      baseUrl: normalizeBaseUrl(entry.baseUrl),
      accountId: String(entry.accountId).trim(),
      network: typeof entry.network === 'string' ? entry.network.trim() : '',
      apiKey: String(entry.apiKey).trim(),
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
    })),
  };
}

function readStore(filePath = '') {
  const resolvedPath = resolveStorePath(filePath);
  if (!existsSync(resolvedPath)) {
    return { path: resolvedPath, data: { version: STORE_VERSION, entries: [] } };
  }
  try {
    const content = readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(content);
    return { path: resolvedPath, data: parseStore(parsed) };
  } catch {
    return { path: resolvedPath, data: { version: STORE_VERSION, entries: [] } };
  }
}

function writeStore(filePath, data) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function saveCredential(params) {
  const now = new Date().toISOString();
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const accountId = String(params.accountId ?? '').trim();
  const apiKey = String(params.apiKey ?? '').trim();
  if (!accountId || !apiKey) {
    throw new Error('accountId and apiKey are required to save credentials.');
  }

  const { path: storePath, data } = readStore(params.storePath);
  const nextEntries = data.entries.filter(
    (entry) => !(entry.baseUrl === baseUrl && entry.accountId === accountId),
  );
  nextEntries.unshift({
    baseUrl,
    accountId,
    network: String(params.network ?? '').trim(),
    apiKey,
    createdAt: now,
    updatedAt: now,
  });

  const nextData = {
    version: STORE_VERSION,
    updatedAt: now,
    entries: nextEntries,
  };
  writeStore(storePath, nextData);
  return storePath;
}

export function loadCredential(params) {
  const accountId = String(params.accountId ?? '').trim();
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const { data } = readStore(params.storePath);
  const exact = data.entries.find(
    (entry) => entry.baseUrl === baseUrl && entry.accountId === accountId,
  );
  if (exact) {
    return exact;
  }
  return data.entries.find((entry) => entry.baseUrl === baseUrl) ?? null;
}

export function maskApiKey(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function resolveCredentialStorePath(customPath = '') {
  return resolveStorePath(customPath);
}
