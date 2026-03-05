import { constants } from 'node:fs';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 120);
}

function normalizeTrigger(value) {
  const raw = String(value ?? 'release').trim().toLowerCase();
  if (raw === 'release' || raw === 'manual') {
    return raw;
  }
  throw new Error('Invalid trigger. Use --trigger release or --trigger manual.');
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'undefined') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const lowered = String(value).trim().toLowerCase();
  if (!lowered) {
    return fallback;
  }
  return lowered === '1' || lowered === 'true' || lowered === 'yes';
}

function normalizeSkillDir(value) {
  const trimmed = toPosix(String(value ?? '').trim());
  if (!trimmed) {
    throw new Error('Skill directory cannot be empty.');
  }
  if (trimmed.startsWith('/')) {
    throw new Error('Skill directory must be relative.');
  }
  if (trimmed.includes('..')) {
    throw new Error('Skill directory cannot contain parent path segments.');
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(trimmed)) {
    throw new Error('Skill directory contains invalid characters.');
  }
  return trimmed;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join(path.posix.sep);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    await access(targetPath, constants.R_OK);
    const entries = await readdir(targetPath);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

async function detectSkillDir(repoDir) {
  const rootSkillMd = path.join(repoDir, 'SKILL.md');
  const rootSkillJson = path.join(repoDir, 'skill.json');
  if ((await pathExists(rootSkillMd)) && (await pathExists(rootSkillJson))) {
    return '.';
  }

  const skillsDir = path.join(repoDir, 'skills');
  if (!(await isDirectory(skillsDir))) {
    return '';
  }

  const children = await readdir(skillsDir, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) {
      continue;
    }
    const candidate = path.join('skills', child.name);
    const candidateAbs = path.join(repoDir, candidate);
    if (
      (await pathExists(path.join(candidateAbs, 'SKILL.md'))) &&
      (await pathExists(path.join(candidateAbs, 'skill.json')))
    ) {
      return toPosix(candidate);
    }
  }

  return '';
}

function buildReleaseWorkflow(skillDir, annotate) {
  return `name: Publish Skill

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - name: Publish skill package
        uses: hashgraph-online/skill-publish@v1
        with:
          api-key: \${{ secrets.RB_API_KEY }}
          skill-dir: ${skillDir}
          annotate: "${annotate ? 'true' : 'false'}"
          github-token: \${{ github.token }}
`;
}

function buildManualWorkflow(skillDir, annotate) {
  return `name: Publish Skill (Manual)

on:
  workflow_dispatch:
    inputs:
      version:
        type: string
        required: false

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - name: Publish skill package
        uses: hashgraph-online/skill-publish@v1
        with:
          api-key: \${{ secrets.RB_API_KEY }}
          skill-dir: ${skillDir}
          version: \${{ inputs.version }}
          annotate: "${annotate ? 'true' : 'false'}"
          github-token: \${{ github.token }}
`;
}

function buildWorkflowTemplate(skillDir, trigger, annotate) {
  if (trigger === 'manual') {
    return buildManualWorkflow(skillDir, annotate);
  }
  return buildReleaseWorkflow(skillDir, annotate);
}

async function writeWorkflow(params) {
  const outputPath = path.join(params.repoDir, params.workflowPath);
  const outputDir = path.dirname(outputPath);
  const exists = await pathExists(outputPath);
  if (exists && !params.force) {
    throw new Error(
      `Workflow already exists at ${path.relative(process.cwd(), outputPath)}. Use --force to overwrite.`,
    );
  }
  await mkdir(outputDir, { recursive: true });
  const template = buildWorkflowTemplate(params.skillDir, params.trigger, params.annotate);
  await writeFile(outputPath, `${template}\n`, 'utf8');
  return outputPath;
}

async function directoryHasContent(dirPath) {
  if (!(await pathExists(dirPath))) {
    return false;
  }
  const entries = await readdir(dirPath);
  return entries.length > 0;
}

async function writeSkillPackage(params) {
  const skillDir = path.join(params.repoDir, params.skillDir);
  await mkdir(skillDir, { recursive: true });

  const skillMd = `# ${params.skillName}

## Overview
${params.description}

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
    name: params.skillName,
    version: params.version,
    description: params.description,
    license: 'Apache-2.0',
    author: process.env.USER || 'Skill Author',
    category: 'general',
    tags: [params.skillName],
  };

  await writeFile(path.join(skillDir, 'SKILL.md'), `${skillMd}\n`, 'utf8');
  await writeFile(path.join(skillDir, 'skill.json'), `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');
}

async function writeRepoReadme(repoDir, skillName, skillDir) {
  const readmePath = path.join(repoDir, 'README.md');
  if (await pathExists(readmePath)) {
    return;
  }

  const readme = `# ${skillName}

This repository contains an HCS-26 skill package and CI publishing workflow powered by \`skill-publish\`.

## Publish flow

1. Add \`RB_API_KEY\` as a GitHub repository secret.
2. Update files under \`${skillDir}\`.
3. Create a GitHub release to trigger publish.
`;

  await writeFile(readmePath, `${readme}\n`, 'utf8');
}

export async function runSetupActionCommand(options, positionals, context) {
  const repoDir = path.resolve(process.cwd(), positionals[0] ?? options['repo-dir'] ?? '.');
  if (!(await isDirectory(repoDir))) {
    context.fail(`Repository directory not found: ${repoDir}`, 'setup-action');
  }

  const detectedSkillDir = await detectSkillDir(repoDir);
  const skillDirValue = String(options['skill-dir'] ?? detectedSkillDir).trim();
  if (!skillDirValue) {
    context.fail(
      'Could not detect skill directory. Pass --skill-dir (for example --skill-dir skills/my-skill).',
      'setup-action',
    );
  }
  const requestedSkillDir = normalizeSkillDir(skillDirValue);

  const workflowPath = String(options['workflow-path'] ?? '.github/workflows/publish-skill.yml').trim();
  const trigger = normalizeTrigger(options.trigger);
  const annotate = normalizeBoolean(options.annotate, true);
  const force = Boolean(options.force || options.yes);

  const outputPath = await writeWorkflow({
    repoDir,
    skillDir: requestedSkillDir,
    workflowPath,
    trigger,
    annotate,
    force,
  });

  process.stdout.write(`${context.colors.green('Configured')} ${context.colors.bold(path.relative(process.cwd(), outputPath))}\n`);
  process.stdout.write(`Trigger: ${trigger}\n`);
  process.stdout.write(`Skill dir: ${requestedSkillDir}\n`);
  process.stdout.write('Next: add RB_API_KEY to repository secrets, then push and run the workflow.\n');
}

export async function runScaffoldRepoCommand(options, positionals, context) {
  const targetDir = path.resolve(process.cwd(), positionals[0] ?? options['repo-dir'] ?? './my-skill-repo');
  const force = Boolean(options.force || options.yes);
  if ((await directoryHasContent(targetDir)) && !force) {
    context.fail(
      `Target directory is not empty: ${path.relative(process.cwd(), targetDir)}. Use --force to continue.`,
      'scaffold-repo',
    );
  }

  await mkdir(targetDir, { recursive: true });

  const skillNameCandidate = options.name || path.basename(targetDir);
  const skillName = normalizeName(skillNameCandidate);
  if (!skillName) {
    context.fail('Could not derive a valid skill name. Pass --name explicitly.', 'scaffold-repo');
  }

  const description = String(options.description ?? 'Describe what this skill helps users do.').trim();
  const version = String(options.version ?? '1.0.0').trim() || '1.0.0';
  const skillDir = normalizeSkillDir(options['skill-dir'] ?? `skills/${skillName}`);
  const trigger = normalizeTrigger(options.trigger);
  const workflowPath = String(options['workflow-path'] ?? '.github/workflows/publish-skill.yml').trim();
  const annotate = normalizeBoolean(options.annotate, true);

  await writeSkillPackage({
    repoDir: targetDir,
    skillDir,
    skillName,
    description,
    version,
  });

  const workflowOutput = await writeWorkflow({
    repoDir: targetDir,
    skillDir,
    workflowPath,
    trigger,
    annotate,
    force: true,
  });
  await writeRepoReadme(targetDir, skillName, skillDir);

  process.stdout.write(`${context.colors.green('Scaffolded')} ${context.colors.bold(path.relative(process.cwd(), targetDir) || '.')}\n`);
  process.stdout.write(`Skill package: ${toPosix(path.join(path.relative(process.cwd(), targetDir), skillDir))}\n`);
  process.stdout.write(`Workflow: ${path.relative(process.cwd(), workflowOutput)}\n`);
  process.stdout.write('Next: `cd` into the repo, add RB_API_KEY in GitHub secrets, then create a release.\n');
}
