import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { maskApiKey } from './credential-store.mjs';
import { runSetupFlow } from './setup-command.mjs';

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 120);
}

async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runInitCommand(options, positionals, context) {
  const requestedDir = positionals[0] ?? options['skill-dir'] ?? '.';
  const targetDir = path.resolve(process.cwd(), requestedDir);
  const force = Boolean(options.force || options.yes);
  const candidateName = options.name || path.basename(targetDir);
  const skillName = normalizeName(candidateName);
  if (!skillName) {
    context.fail('Could not derive a valid skill name. Pass --name explicitly.', 'init');
  }
  const description = String(options.description ?? 'Describe what this skill helps users do.').trim();
  const version = String(options.version ?? '1.0.0').trim() || '1.0.0';
  const skillMdPath = path.join(targetDir, 'SKILL.md');
  const skillJsonPath = path.join(targetDir, 'skill.json');

  const skillMdExists = await pathExists(skillMdPath);
  const skillJsonExists = await pathExists(skillJsonPath);
  if ((skillMdExists || skillJsonExists) && !force) {
    context.fail(
      `Target already contains skill files (${path.relative(process.cwd(), targetDir)}). Use --force to overwrite.`,
      'init',
    );
  }

  await mkdir(targetDir, { recursive: true });

  const skillMd = `# ${skillName}

## Overview
${description}

## When To Use
- Add the primary scenarios this skill is designed for.

## Inputs
- List required inputs and expected formats.

## Output
- Explain the expected result and format.

## Constraints
- Note boundaries, safety requirements, and assumptions.
`;

  const skillJson = {
    name: skillName,
    version,
    description,
    license: 'Apache-2.0',
    author: process.env.USER || 'Skill Author',
    category: 'general',
    tags: [skillName],
  };

  await writeFile(skillMdPath, `${skillMd}\n`, 'utf8');
  await writeFile(skillJsonPath, `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `${context.colors.green('Initialized')} ${context.colors.bold(path.relative(process.cwd(), targetDir) || '.')}\n`,
  );
  process.stdout.write(
    `${context.colors.cyan('Next')}: npx skill-publish validate ${path.relative(process.cwd(), targetDir) || '.'}\n`,
  );
  process.stdout.write(
    `${context.colors.cyan('Then')}: npx skill-publish doctor ${path.relative(process.cwd(), targetDir) || '.'}\n`,
  );
  process.stdout.write(
    `${context.colors.cyan('Publish')}: npx skill-publish publish ${path.relative(process.cwd(), targetDir) || '.'}\n`,
  );
}

export async function runSetupCommand(options, context) {
  if (typeof options.save === 'undefined') {
    options.save = true;
  }
  const result = await runSetupFlow({
    ...options,
    'no-save': options.save === false,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${context.colors.green('Ledger authentication complete')}\n`);
  process.stdout.write(`Broker:   ${result.baseUrl}\n`);
  process.stdout.write(`Account:  ${result.accountId}\n`);
  process.stdout.write(`Network:  ${result.network}\n`);
  process.stdout.write(`API key:  ${maskApiKey(result.apiKey)}\n`);
  if (result.savedPath) {
    process.stdout.write(`Stored:   ${result.savedPath}\n`);
  } else {
    process.stdout.write(`Stored:   skipped\n`);
  }
  process.stdout.write(`Balance:  ${result.balanceBeforeFunding} credits\n`);
  if (result.funding) {
    process.stdout.write(`${context.colors.green('Credits funded')}\n`);
    process.stdout.write(`HBAR:     ${result.funding.hbarAmount}\n`);
    process.stdout.write(`Credited: ${result.funding.credited}\n`);
    process.stdout.write(`Balance:  ${result.funding.balanceAfterFunding} credits\n`);
    if (result.funding.transactionId) {
      process.stdout.write(`Txn:      ${result.funding.transactionId}\n`);
    }
  } else if (result.fundingError) {
    process.stdout.write(`${context.colors.yellow('Funding skipped')}: ${result.fundingError}\n`);
  } else {
    process.stdout.write(
      `${context.colors.yellow('No funding executed')}. Pass --hbar <amount> to top up credits now.\n`,
    );
  }

  process.stdout.write('\nNext steps\n');
  process.stdout.write('1. npx skill-publish doctor ./skills/my-skill\n');
  process.stdout.write('2. npx skill-publish quote ./skills/my-skill\n');
  process.stdout.write('3. npx skill-publish publish ./skills/my-skill\n');
  process.stdout.write('4. Stored credentials are reused automatically; use --api-key only to override.\n');
  process.stdout.write(`\nManage keys: ${result.docs.apiKeys}\n`);
  process.stdout.write(`Buy credits: ${result.docs.credits}\n`);
}
