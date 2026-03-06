import path from 'node:path';
import { requestJsonWithTimeout } from './broker-api.mjs';
import { loadCredential, resolveCredentialStorePath } from './credential-store.mjs';
import { repairSkillPackage, readSkillPackageState } from './skill-package.mjs';

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

function formatSkillPackageDetail(skillDir, state) {
  const label = path.relative(process.cwd(), skillDir) || '.';
  if (!state.hasSkillMd || !state.hasSkillJson) {
    const missing = [];
    if (!state.hasSkillMd) {
      missing.push('SKILL.md');
    }
    if (!state.hasSkillJson) {
      missing.push('skill.json');
    }
    return {
      status: 'warn',
      detail: `${label} missing ${missing.join(' and ')}`,
      meta: null,
    };
  }
  if (state.invalidSkillJson) {
    return {
      status: 'warn',
      detail: `${label} has unreadable skill.json (${state.skillJsonError})`,
      meta: null,
    };
  }
  if (state.missingFields.length > 0) {
    return {
      status: 'warn',
      detail: `${label} missing metadata: ${state.missingFields.join(', ')}`,
      meta: null,
    };
  }
  return {
    status: 'pass',
    detail: `${label} (${state.parsedSkillJson.name}@${state.parsedSkillJson.version})`,
    meta: {
      name: state.parsedSkillJson.name,
      version: state.parsedSkillJson.version,
    },
  };
}

async function checkSkillPackage(skillDir) {
  const state = await readSkillPackageState(skillDir);
  return {
    ...formatSkillPackageDetail(skillDir, state),
    state,
  };
}

async function checkBrokerReachability(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await requestJsonWithTimeout(`${baseUrl}/skills/config`, {}, 12000);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function runDoctorCommand(options, positionals, context) {
  const checks = [];
  const fixes = [];
  const baseUrl = normalizeBaseUrl(options['api-base-url']);
  const skillDirInput = positionals[0] ?? options['skill-dir'] ?? '.';
  const skillDir = path.resolve(process.cwd(), skillDirInput);
  const nodeMajor = parseNodeVersion(process.versions.node);
  const localOnly = Boolean(options['local-only']);

  if (nodeMajor >= 20) {
    pushCheck(checks, 'pass', 'Node.js', process.versions.node);
  } else {
    pushCheck(checks, 'fail', 'Node.js', `${process.versions.node} (requires >= 20)`, true);
  }

  if (localOnly) {
    pushCheck(checks, 'pass', 'Registry Broker', 'skipped (--local-only)');
  } else {
    try {
      await checkBrokerReachability(baseUrl);
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

  if (localOnly) {
    pushCheck(checks, 'pass', 'API key', 'skipped (--local-only)');
  } else if (apiKey) {
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

  if (localOnly) {
    pushCheck(checks, 'pass', 'Credits balance', 'skipped (--local-only)');
  } else if (apiKey && accountId) {
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

  let packageCheck = await checkSkillPackage(skillDir);
  if (options.fix && packageCheck.status !== 'pass') {
    const repaired = await repairSkillPackage({
      skillDir,
      name: options.name,
      version: options.version,
      description: options.description,
      preset: options.preset,
    });
    fixes.push(...repaired.fixes);
    packageCheck = await checkSkillPackage(skillDir);
  }
  pushCheck(checks, packageCheck.status, 'Skill package', packageCheck.detail);

  const blockingFailures = checks.filter((check) => check.status === 'fail' && check.blocking).length;
  const warnings = checks.filter((check) => check.status === 'warn').length;

  const result = {
    mode: 'doctor',
    ok: blockingFailures === 0,
    localOnly,
    blockingFailures,
    warnings,
    fixes,
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
  if (fixes.length > 0) {
    process.stdout.write(`${context.colors.cyan('Applied fixes')}: ${fixes.join(', ')}\n`);
  }
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
