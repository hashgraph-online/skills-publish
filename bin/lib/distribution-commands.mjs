import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyDistributionKit } from './apply-distribution-kit.mjs';
import { stringifyCodemetaDocument } from './codemeta.mjs';
import { buildDistributionKit } from './distribution-kit.mjs';
import { submitToIndexNow } from './indexnow.mjs';

async function loadSkillJson(skillDir) {
  const filePath = path.join(skillDir, 'skill.json');
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid skill.json at ${filePath}`);
  }
  return parsed;
}

async function maybeLoadSkillJson(skillDir) {
  try {
    return await loadSkillJson(skillDir);
  } catch {
    return null;
  }
}

async function resolveNameVersion(options, positionals, context) {
  const skillDir = path.resolve(process.cwd(), positionals[0] ?? options['skill-dir'] ?? '.');
  const explicitName = String(options.name ?? '').trim();
  const explicitVersion = String(options.version ?? '').trim();
  if (explicitName && explicitVersion) {
    return { name: explicitName, version: explicitVersion };
  }

  let parsed = null;
  try {
    parsed = await loadSkillJson(skillDir);
  } catch (error) {
    if (!explicitName || !explicitVersion) {
      context.fail(
        `Unable to resolve skill identity. Provide --name and --version, or ensure ${path.relative(process.cwd(), skillDir) || '.'}/skill.json exists.`,
      );
    }
  }

  const name = explicitName || String(parsed?.name ?? '').trim();
  const version = explicitVersion || String(parsed?.version ?? '').trim();
  if (!name || !version) {
    context.fail('Missing skill name/version. Provide --name and --version or valid skill.json.');
  }

  return { name, version };
}

function printResult(payload, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${payload}\n`);
}

function resolveFormat(value, fallback) {
  const format = String(value ?? fallback).trim().toLowerCase();
  return format || fallback;
}

export async function runDistributionCommand(command, options, positionals, context) {
  const identity = await resolveNameVersion(options, positionals, context);
  const skillDir = path.resolve(process.cwd(), positionals[0] ?? options['skill-dir'] ?? '.');
  const parsedSkillJson = await maybeLoadSkillJson(skillDir);
  const kit = buildDistributionKit({
    name: identity.name,
    version: identity.version,
    apiBaseUrl: options['api-base-url'],
    label: options.label,
    style: options.style,
    metric: options.metric,
    skillJson: parsedSkillJson,
  });

  if (command === 'badge') {
    const format = resolveFormat(options.format, 'markdown');
    if (format === 'markdown') {
      printResult(kit.snippets.badgeMarkdown, options);
      return;
    }
    if (format === 'html') {
      printResult(kit.snippets.badgeHtml, options);
      return;
    }
    if (format === 'image') {
      printResult(kit.urls.badgeImageUrl, options);
      return;
    }
    if (format === 'api') {
      printResult(kit.urls.badgeApiUrl, options);
      return;
    }
    if (format === 'json') {
      process.stdout.write(
        `${JSON.stringify(
          {
            apiUrl: kit.urls.badgeApiUrl,
            imageUrl: kit.urls.badgeImageUrl,
            markdown: kit.snippets.badgeMarkdown,
            html: kit.snippets.badgeHtml,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    context.fail('Unsupported --format for badge. Use markdown|html|image|api|json.', 'badge');
    return;
  }

  if (command === 'install-url') {
    const format = resolveFormat(options.format, 'summary');
    if (format === 'summary') {
      const text = [
        `Skill: ${kit.name}@${kit.version}`,
        `Canonical page: ${kit.urls.skillPageUrl}`,
        `Latest page: ${kit.urls.skillLatestUrl}`,
        `Pinned SKILL.md: ${kit.urls.pinnedSkillMdUrl}`,
        `Latest SKILL.md: ${kit.urls.latestSkillMdUrl}`,
        `Pinned manifest: ${kit.urls.pinnedManifestUrl}`,
        `Latest manifest: ${kit.urls.latestManifestUrl}`,
        `Pinned install metadata: ${kit.urls.installMetadataPinnedUrl}`,
        `Latest install metadata: ${kit.urls.installMetadataLatestUrl}`,
      ].join('\n');
      printResult(text, options);
      return;
    }
    if (format === 'pinned-skill-md') {
      printResult(kit.urls.pinnedSkillMdUrl, options);
      return;
    }
    if (format === 'latest-skill-md') {
      printResult(kit.urls.latestSkillMdUrl, options);
      return;
    }
    if (format === 'pinned-manifest') {
      printResult(kit.urls.pinnedManifestUrl, options);
      return;
    }
    if (format === 'latest-manifest') {
      printResult(kit.urls.latestManifestUrl, options);
      return;
    }
    if (format === 'pinned-install-metadata') {
      printResult(kit.urls.installMetadataPinnedUrl, options);
      return;
    }
    if (format === 'latest-install-metadata') {
      printResult(kit.urls.installMetadataLatestUrl, options);
      return;
    }
    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(kit.urls, null, 2)}\n`);
      return;
    }
    context.fail(
      'Unsupported --format for install-url. Use summary|pinned-skill-md|latest-skill-md|pinned-manifest|latest-manifest|pinned-install-metadata|latest-install-metadata|json.',
      'install-url',
    );
    return;
  }

  if (command === 'release-notes') {
    printResult(kit.snippets.releaseNotes, options);
    return;
  }

  if (command === 'readme-snippet') {
    printResult(kit.snippets.readmeSnippet, options);
    return;
  }

  if (command === 'attested-kit') {
    const format = resolveFormat(options.format, 'json');
    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(kit, null, 2)}\n`);
      return;
    }
    if (format === 'summary') {
      const text = [
        `Skill: ${kit.name}@${kit.version}`,
        `Canonical page: ${kit.urls.skillPageUrl}`,
        `Entity metadata: ${kit.urls.entityUrl}`,
        `OpenAPI: ${kit.urls.openapiUrl}`,
        `Badge: ${kit.urls.badgeImageUrl}`,
      ].join('\n');
      printResult(text, options);
      return;
    }
    if (format === 'docs') {
      printResult(kit.snippets.docsSnippet, options);
      return;
    }
    if (format === 'citation') {
      printResult(kit.snippets.citationSnippet, options);
      return;
    }
    if (format === 'codemeta') {
      printResult(stringifyCodemetaDocument(kit.machineReadable.codemeta), options);
      return;
    }
    if (format === 'package') {
      printResult(kit.snippets.packageMetadataJson, options);
      return;
    }
    context.fail(
      'Unsupported --format for attested-kit. Use json|summary|docs|citation|codemeta|package.',
      'attested-kit',
    );
    return;
  }

  if (command === 'apply-kit') {
    const repoDir = path.resolve(process.cwd(), options['repo-dir'] ?? '.');
    const result = await applyDistributionKit({
      repoDir,
      readmePath: String(options['readme-path'] ?? 'README.md').trim(),
      docsPath: String(options['docs-path'] ?? '').trim(),
      codemetaPath: String(options['codemeta-path'] ?? 'codemeta.json').trim(),
      distribution: kit,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'submit-indexnow') {
    const result = await submitToIndexNow(kit.indexing.urls);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  context.fail(`Unsupported distribution command: ${command}`, command);
}
