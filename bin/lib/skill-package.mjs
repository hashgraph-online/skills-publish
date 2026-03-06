import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSkillJson, buildSkillMarkdown, resolveSkillPreset } from './skill-presets.mjs';

export function normalizeSkillName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 120);
}

export async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { parsed };
    }
    return { error: 'skill.json must be a JSON object.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readNonEmptyString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function readStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferHeading(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*$/u);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return '';
}

function inferDescription(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    return trimmed;
  }
  return '';
}

function mergeTags(existingTags, fallbackTags, skillName) {
  const seed = existingTags.length > 0 ? existingTags : fallbackTags;
  const merged = [...new Set([skillName, ...seed].filter(Boolean))];
  return merged;
}

function buildNormalizedSkillJson(params) {
  const preset = resolveSkillPreset(params.preset);
  const existing = params.existingSkillJson ?? {};
  const inferredHeading = inferHeading(params.skillMdText);
  const inferredDescription = inferDescription(params.skillMdText);
  const candidateName =
    readNonEmptyString(params.name) ||
    readNonEmptyString(existing.name) ||
    normalizeSkillName(inferredHeading) ||
    normalizeSkillName(path.basename(params.skillDir));
  const skillName = normalizeSkillName(candidateName) || 'my-skill';
  const version =
    readNonEmptyString(params.version) ||
    readNonEmptyString(existing.version) ||
    '1.0.0';
  const description =
    readNonEmptyString(params.description) ||
    readNonEmptyString(existing.description) ||
    inferredDescription ||
    `Describe what ${skillName} helps users do.`;
  const generated = buildSkillJson({
    skillName,
    version,
    description,
    preset: preset?.id,
  });
  const existingTags = readStringArray(existing.tags);
  const generatedTags = readStringArray(generated.tags);
  const category =
    readNonEmptyString(existing.category) || readNonEmptyString(generated.category);

  return {
    ...existing,
    ...generated,
    name: skillName,
    version,
    description,
    license: readNonEmptyString(existing.license) || generated.license,
    author: existing.author || generated.author,
    category: category || undefined,
    tags: mergeTags(existingTags, generatedTags, skillName),
  };
}

export async function readSkillPackageState(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillJsonPath = path.join(skillDir, 'skill.json');
  const hasSkillMd = await pathExists(skillMdPath);
  const hasSkillJson = await pathExists(skillJsonPath);
  const skillMdText = hasSkillMd ? await readFile(skillMdPath, 'utf8') : '';
  const skillJsonRaw = hasSkillJson ? await readFile(skillJsonPath, 'utf8') : '';
  const parsedSkillJsonState = hasSkillJson ? parseJsonObject(skillJsonRaw) : {};
  const parsedSkillJson = parsedSkillJsonState.parsed ?? null;
  const invalidSkillJson = hasSkillJson && !parsedSkillJson;
  const missingFields = [];

  if (!hasSkillMd) {
    missingFields.push('SKILL.md');
  }
  if (!hasSkillJson) {
    missingFields.push('skill.json');
  }
  if (parsedSkillJson) {
    if (!readNonEmptyString(parsedSkillJson.name)) {
      missingFields.push('name');
    }
    if (!readNonEmptyString(parsedSkillJson.version)) {
      missingFields.push('version');
    }
    if (!readNonEmptyString(parsedSkillJson.description)) {
      missingFields.push('description');
    }
    if (!readNonEmptyString(parsedSkillJson.license)) {
      missingFields.push('license');
    }
    if (!parsedSkillJson.author) {
      missingFields.push('author');
    }
  }

  return {
    skillDir,
    skillMdPath,
    skillJsonPath,
    hasSkillMd,
    hasSkillJson,
    skillMdText,
    skillJsonRaw,
    parsedSkillJson,
    invalidSkillJson,
    skillJsonError: parsedSkillJsonState.error ?? '',
    missingFields,
  };
}

export async function initializeSkillPackage(params) {
  const targetDir = path.resolve(process.cwd(), params.targetDir);
  const skillName = normalizeSkillName(params.name || path.basename(targetDir)) || 'my-skill';
  const version = String(params.version ?? '1.0.0').trim() || '1.0.0';
  const description = String(
    params.description ?? 'Describe what this skill helps users do.',
  ).trim();
  const preset = String(params.preset ?? '').trim().toLowerCase();
  const skillMdPath = path.join(targetDir, 'SKILL.md');
  const skillJsonPath = path.join(targetDir, 'skill.json');
  const skillMdExists = await pathExists(skillMdPath);
  const skillJsonExists = await pathExists(skillJsonPath);

  if ((skillMdExists || skillJsonExists) && !params.force) {
    throw new Error(
      `Target already contains skill files (${path.relative(process.cwd(), targetDir)}). Use --force to overwrite.`,
    );
  }

  await mkdir(targetDir, { recursive: true });
  const skillMd = buildSkillMarkdown({
    skillName,
    description,
    preset,
  });
  const skillJson = buildSkillJson({
    skillName,
    version,
    description,
    preset,
  });

  await writeFile(skillMdPath, `${skillMd}\n`, 'utf8');
  await writeFile(skillJsonPath, `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');

  return {
    skillDir: targetDir,
    skillName,
    version,
    description,
    preset,
  };
}

export async function repairSkillPackage(params) {
  const skillDir = path.resolve(process.cwd(), params.skillDir);
  const state = await readSkillPackageState(skillDir);
  const preset = String(params.preset ?? '').trim().toLowerCase();
  const fixes = [];
  let normalizedSkillJson = state.parsedSkillJson;

  if (!state.hasSkillMd && !state.hasSkillJson) {
    const initialized = await initializeSkillPackage({
      targetDir: skillDir,
      name: params.name,
      version: params.version,
      description: params.description,
      preset,
      force: true,
    });
    return {
      ...initialized,
      fixes: ['created SKILL.md', 'created skill.json'],
    };
  }

  if (!state.hasSkillMd) {
    normalizedSkillJson = buildNormalizedSkillJson({
      existingSkillJson: state.parsedSkillJson ?? {},
      skillMdText: '',
      skillDir,
      name: params.name,
      version: params.version,
      description: params.description,
      preset,
    });
    const skillMd = buildSkillMarkdown({
      skillName: normalizedSkillJson.name,
      description: normalizedSkillJson.description,
      preset,
    });
    await writeFile(state.skillMdPath, `${skillMd}\n`, 'utf8');
    fixes.push('created SKILL.md');
  }

  const requiresSkillJsonRepair =
    !state.hasSkillJson ||
    state.invalidSkillJson ||
    state.missingFields.some((field) =>
      ['name', 'version', 'description', 'license', 'author'].includes(field),
    );

  if (requiresSkillJsonRepair) {
    const nextSkillJson = buildNormalizedSkillJson({
      existingSkillJson: state.parsedSkillJson ?? {},
      skillMdText: state.skillMdText,
      skillDir,
      name: params.name,
      version: params.version,
      description: params.description,
      preset,
    });
    await writeFile(
      state.skillJsonPath,
      `${JSON.stringify(nextSkillJson, null, 2)}\n`,
      'utf8',
    );
    normalizedSkillJson = nextSkillJson;
    if (!state.hasSkillJson) {
      fixes.push('created skill.json');
    } else if (state.invalidSkillJson) {
      fixes.push('rewrote invalid skill.json');
    } else {
      fixes.push('filled missing skill.json metadata');
    }
  }

  const finalState = await readSkillPackageState(skillDir);
  const finalSkillJson =
    finalState.parsedSkillJson ??
    normalizedSkillJson ??
    buildNormalizedSkillJson({
      existingSkillJson: {},
      skillMdText: finalState.skillMdText,
      skillDir,
      name: params.name,
      version: params.version,
      description: params.description,
      preset,
    });

  return {
    skillDir,
    skillName: finalSkillJson.name,
    version: finalSkillJson.version,
    description: finalSkillJson.description,
    preset,
    fixes,
  };
}
