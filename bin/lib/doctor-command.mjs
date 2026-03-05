import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCredential, resolveCredentialStorePath } from './credential-store.mjs';

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

function parseNodeVersion(rawVersion) {
  const major = Number.parseInt(String(rawVersion).split('.')[0], 10);
  return Number.isFinite(major) ? major : 0;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function requestJsonWithTimeout(url, headers = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function statusColor(status, colors) {
  if (status === 'pass') {
    return colors.green('[ok]');
  }
  if (status === 'warn') {
    return colors.yellow('[warn]');
  }
  return colors.red('[fail]');
}

function pushCheck(checks, status, label, detail, blocking = false) {
  checks.push({
    status,
    label,
    detail,
    blocking,
  });
}

async function checkSkillPackage(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillJsonPath = path.join(skillDir, 'skill.json');
  const hasSkillMd = await fileExists(skillMdPath);
  const hasSkillJson = await fileExists(skillJsonPath);
  if (!hasSkillMd || !hasSkillJson) {
    return {
      status: 'warn',
      detail: `${path.relative(process.cwd(), skillDir) || '.'} missing ${!hasSkillMd ? 'SKILL.md' : ''}${!hasSkillMd && !hasSkillJson ? ' and ' : ''}${!hasSkillJson ? 'skill.json' : ''}`,
      meta: null,
    };
  }

  try {
    const raw = await readFile(skillJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    const version = typeof parsed?.version === 'string' ? parsed.version.trim() : '';
    if (!name || !version) {
      return {
        status: 'warn',
        detail: `${path.relative(process.cwd(), skillDir) || '.'} has skill.json but missing name/version fields`,
        meta: null,
      };
    }
    return {
      status: 'pass',
      detail: `${path.relative(process.cwd(), skillDir) || '.'} (${name}@${version})`,
      meta: {
        name,
        version,
      },
    };
  } catch (error) {
    return {
      status: 'warn',
      detail: `${path.relative(process.cwd(), skillDir) || '.'} has unreadable skill.json (${error instanceof Error ? error.message : String(error)})`,
      meta: null,
    };
  }
}

export async function runDoctorCommand(options, positionals, context) {
  const checks = [];
  const baseUrl = normalizeBaseUrl(options['api-base-url']);
  const skillDirInput = positionals[0] ?? options['skill-dir'] ?? '.';
  const skillDir = path.resolve(process.cwd(), skillDirInput);
  const nodeMajor = parseNodeVersion(process.versions.node);

  if (nodeMajor >= 20) {
    pushCheck(checks, 'pass', 'Node.js', process.versions.node);
  } else {
    pushCheck(checks, 'fail', 'Node.js', `${process.versions.node} (requires >= 20)`, true);
  }

  try {
    await requestJsonWithTimeout(`${baseUrl}/skills/config`);
    pushCheck(checks, 'pass', 'Registry Broker', `${baseUrl} reachable`);
  } catch (error) {
    pushCheck(
      checks,
      'fail',
      'Registry Broker',
      `${baseUrl} unreachable (${error instanceof Error ? error.message : String(error)})`,
      true,
    );
  }

  const storedCredential = options['api-key']
    ? null
    : loadCredential({
      baseUrl,
      accountId: options['account-id'] ?? '',
      storePath: options['store-path'] ?? '',
    });
  const apiKey = String(options['api-key'] ?? storedCredential?.apiKey ?? '').trim();
  const accountId = String(options['account-id'] ?? storedCredential?.accountId ?? '').trim();

  if (apiKey) {
    const source = options['api-key'] ? 'flag/env' : `store (${resolveCredentialStorePath(options['store-path'] ?? '')})`;
    pushCheck(checks, 'pass', 'API key', `available via ${source}`);
  } else {
    pushCheck(
      checks,
      'warn',
      'API key',
      'not found; run `npx skill-publish setup --account-id <id> --hedera-private-key <key>`',
    );
  }

  if (apiKey && accountId) {
    try {
      const balanceQuery = new URLSearchParams({ accountId });
      const response = await requestJsonWithTimeout(`${baseUrl}/credits/balance?${balanceQuery.toString()}`, {
        'x-api-key': apiKey,
        'x-account-id': accountId,
      });
      const balance = Number(response?.balance ?? 0);
      pushCheck(
        checks,
        'pass',
        'Credits balance',
        `${Number.isFinite(balance) ? balance : 0} credits for ${accountId}`,
      );
    } catch (error) {
      pushCheck(
        checks,
        'warn',
        'Credits balance',
        `could not fetch balance for ${accountId} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  } else if (apiKey && !accountId) {
    pushCheck(
      checks,
      'warn',
      'Credits balance',
      'missing account ID; pass --account-id <id> to verify funding status',
    );
  } else {
    pushCheck(checks, 'warn', 'Credits balance', 'skipped (no API key)');
  }

  const packageCheck = await checkSkillPackage(skillDir);
  pushCheck(checks, packageCheck.status, 'Skill package', packageCheck.detail);

  const blockingFailures = checks.filter((check) => check.status === 'fail' && check.blocking).length;
  const warnings = checks.filter((check) => check.status === 'warn').length;

  const result = {
    mode: 'doctor',
    ok: blockingFailures === 0,
    blockingFailures,
    warnings,
    checks,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (blockingFailures > 0) {
      throw new Error(`Doctor found ${blockingFailures} blocking issue(s).`);
    }
    return;
  }

  process.stdout.write(`${context.colors.bold('Doctor results')}\n`);
  checks.forEach((check) => {
    process.stdout.write(`${statusColor(check.status, context.colors)} ${check.label}: ${check.detail}\n`);
  });
  if (blockingFailures > 0) {
    process.stdout.write(`${context.colors.red(`Doctor found ${blockingFailures} blocking issue(s).`)}\n`);
    throw new Error(`Doctor found ${blockingFailures} blocking issue(s).`);
  }
  if (warnings > 0) {
    process.stdout.write(`${context.colors.yellow(`Doctor completed with ${warnings} warning(s).`)}\n`);
  } else {
    process.stdout.write(`${context.colors.green('Doctor checks passed. You are ready to publish.')}\n`);
  }
}
