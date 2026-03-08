import path from 'node:path';
import { maskApiKey } from './credential-store.mjs';
import { runSetupFlow } from './setup-command.mjs';
import { listSkillPresetIds, resolveSkillPreset } from './skill-presets.mjs';
import { initializeSkillPackage } from './skill-package.mjs';

export async function runInitCommand(options, positionals, context) {
  const requestedDir = positionals[0] ?? options['skill-dir'] ?? '.';
  const targetDir = path.resolve(process.cwd(), requestedDir);
  const force = Boolean(options.force || options.yes);
  const preset = String(options.preset ?? '').trim().toLowerCase();
  if (preset && !resolveSkillPreset(preset)) {
    context.fail(
      `Unknown preset "${preset}". Available presets: ${listSkillPresetIds().join(', ')}.`,
      'init',
    );
  }
  const initialized = await initializeSkillPackage({
    targetDir,
    name: options.name,
    description: options.description,
    version: options.version,
    preset,
    force,
  }).catch((error) => {
    context.fail(
      error instanceof Error ? error.message : String(error),
      'init',
    );
  });

  process.stdout.write(
    `${context.colors.green('Initialized')} ${context.colors.bold(path.relative(process.cwd(), targetDir) || '.')}\n`,
  );
  if (initialized?.preset) {
    process.stdout.write(`${context.colors.cyan('Preset')}: ${initialized.preset}\n`);
  }
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
    process.stdout.write(`Credited: ${result.funding.credited ?? 'pending'}\n`);
    process.stdout.write(`Balance:  ${result.funding.balanceAfterFunding ?? 'pending'} credits\n`);
    if (result.funding.transactionId) {
      process.stdout.write(`Txn:      ${result.funding.transactionId}\n`);
    }
    if (result.funding.purchaseId) {
      process.stdout.write(`Purchase: ${result.funding.purchaseId}\n`);
    }
  } else if (result.fundingError) {
    process.stdout.write(`${context.colors.yellow('Funding skipped')}: ${result.fundingError}\n`);
  } else {
    process.stdout.write(
      `${context.colors.yellow('No funding executed')}. Pass --hbar <amount> or --credits <amount> to top up now.\n`,
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
