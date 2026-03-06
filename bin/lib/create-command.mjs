import path from 'node:path';
import { runScaffoldRepoCommand } from './repo-commands.mjs';
import { runSetupFlow } from './setup-command.mjs';
import { runDoctorCommand } from './doctor-command.mjs';
import { listSkillPresetIds, resolveSkillPreset } from './skill-presets.mjs';

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 120);
}

function normalizeSkillDir(value, skillName) {
  const raw = String(value ?? `skills/${skillName}`).trim();
  return raw.replace(/\\/gu, '/');
}

function shouldRunSetup(options) {
  if (String(options['api-key'] ?? '').trim()) {
    return false;
  }
  if (!String(options['account-id'] ?? '').trim()) {
    return false;
  }
  return (
    String(options['hedera-private-key'] ?? '').trim().length > 0 ||
    String(options.signature ?? '').trim().length > 0
  );
}

export async function runCreateCommand(options, positionals, context) {
  const repoDir = path.resolve(
    process.cwd(),
    positionals[0] ?? options['repo-dir'] ?? './my-skill-repo',
  );
  const skillName =
    normalizeName(options.name || path.basename(repoDir)) || 'my-skill';
  const preset = String(options.preset ?? '').trim().toLowerCase();

  if (preset && !resolveSkillPreset(preset)) {
    context.fail(
      `Unknown preset "${preset}". Available presets: ${listSkillPresetIds().join(', ')}.`,
      'create',
    );
  }

  const skillDir = normalizeSkillDir(options['skill-dir'], skillName);
  const packageDir = path.join(repoDir, skillDir);

  await runScaffoldRepoCommand(
    {
      ...options,
      name: skillName,
      preset,
      'skill-dir': skillDir,
      'repo-dir': repoDir,
    },
    [repoDir],
    context,
  );

  let setupResult = null;
  if (shouldRunSetup(options)) {
    setupResult = await runSetupFlow({
      ...options,
      save: typeof options.save === 'undefined' ? true : options.save,
      'api-base-url': options['api-base-url'],
      'store-path': options['store-path'],
    });
    options['api-key'] = setupResult.apiKey;
    options['account-id'] = setupResult.accountId;
    options.network = setupResult.network;

    if (!options.json) {
      process.stdout.write(`${context.colors.green('Connected')} ${setupResult.accountId}\n`);
      process.stdout.write(`Stored: ${setupResult.savedPath || 'skipped'}\n`);
      process.stdout.write(`Credits: ${setupResult.balanceBeforeFunding} available before publish\n`);
    }
  }

  const shouldPublish = Boolean(options.publish);
  const canQuote = String(options['api-key'] ?? '').trim().length > 0;
  const localOnlyDoctor =
    typeof options['local-only'] === 'undefined'
      ? !shouldPublish && !canQuote
      : options['local-only'];

  await runDoctorCommand(
    {
      ...options,
      fix: true,
      'local-only': localOnlyDoctor,
      'skill-dir': packageDir,
    },
    [packageDir],
    context,
  );

  if (canQuote) {
    if (!options.json) {
      process.stdout.write(`${context.colors.cyan('Quoting')} ${path.relative(process.cwd(), packageDir) || packageDir}\n`);
    }
    await context.runEntrypoint('quote', {
      ...options,
      'skill-dir': packageDir,
    });
  }

  if (shouldPublish) {
    if (!canQuote) {
      context.fail(
        'Cannot publish from create without an API key. Pass --account-id plus --hedera-private-key, or provide --api-key.',
        'create',
      );
    }
    if (!options.json) {
      process.stdout.write(`${context.colors.cyan('Publishing')} ${path.relative(process.cwd(), packageDir) || packageDir}\n`);
    }
    await context.runEntrypoint('publish', {
      ...options,
      'skill-dir': packageDir,
    });
    return;
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'create',
          repoDir,
          skillDir: packageDir,
          setup: setupResult
            ? {
                accountId: setupResult.accountId,
                baseUrl: setupResult.baseUrl,
                savedPath: setupResult.savedPath,
              }
            : null,
          quoted: canQuote,
          published: false,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`${context.colors.green('Create flow complete')}\n`);
  process.stdout.write(`Repo: ${path.relative(process.cwd(), repoDir) || repoDir}\n`);
  process.stdout.write(`Skill: ${path.relative(process.cwd(), packageDir) || packageDir}\n`);
  if (!canQuote) {
    process.stdout.write(
      `Next: npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key>\n`,
    );
  }
  process.stdout.write(
    `Next: npx skill-publish publish ${path.relative(process.cwd(), packageDir) || packageDir}\n`,
  );
}
