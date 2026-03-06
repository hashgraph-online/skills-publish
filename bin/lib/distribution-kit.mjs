import { buildCodemetaDocument } from './codemeta.mjs';

function trimTrailingSlashes(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '');
}

export function normalizeApiBaseUrl(value) {
  const trimmed = trimTrailingSlashes(value);
  if (!trimmed) {
    return 'https://hol.org/registry/api/v1';
  }
  if (trimmed.endsWith('/api/v1')) {
    return trimmed;
  }
  if (trimmed.endsWith('/registry')) {
    return `${trimmed}/api/v1`;
  }
  return `${trimmed}/api/v1`;
}

function deriveRegistryBaseUrl(apiBaseUrl) {
  const normalizedApiBase = normalizeApiBaseUrl(apiBaseUrl);
  const normalized = trimTrailingSlashes(normalizedApiBase);
  if (normalized.endsWith('/api/v1')) {
    return normalized.slice(0, -'/api/v1'.length);
  }
  return normalized;
}

function buildApiUrl(apiBaseUrl, endpointPath, query = null) {
  const base = normalizeApiBaseUrl(apiBaseUrl);
  const endpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const url = new URL(`${base}${endpoint}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || typeof value === 'undefined' || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildEmbedIframeSnippet(skillPageUrl, name, version) {
  const title = escapeHtml(`${name}@${version} on HOL Registry`);
  const targetUrl = escapeHtml(skillPageUrl);
  return `<iframe src="${targetUrl}" width="100%" height="640" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" title="${title}" style="border:1px solid #e5e7eb;border-radius:12px;"></iframe>`;
}

export function buildDistributionKit(params) {
  const skillJson =
    params.skillJson && typeof params.skillJson === 'object' && !Array.isArray(params.skillJson)
      ? params.skillJson
      : {};
  const name = String(params.name ?? '').trim();
  const version = String(params.version ?? '').trim();
  if (!name || !version) {
    throw new Error('name and version are required to build distribution metadata.');
  }

  const style = String(params.style ?? 'for-the-badge').trim() || 'for-the-badge';
  const metric = String(params.metric ?? 'version').trim() || 'version';
  const label = String(params.label ?? name).trim() || name;
  const registryBaseUrl = deriveRegistryBaseUrl(params.apiBaseUrl);
  const openapiUrl = buildApiUrl(params.apiBaseUrl, '/openapi.json');
  const docsUrl = `${registryBaseUrl}/docs`;
  const pinnedRef = `${name}@${version}`;
  const latestRef = `${name}@latest`;
  const skillPath = encodeURIComponent(name);
  const pinnedPath = encodeURIComponent(pinnedRef);
  const latestPath = encodeURIComponent(latestRef);
  const skillPageUrl = `${registryBaseUrl}/skills/${skillPath}?version=${encodeURIComponent(version)}`;
  const skillLatestUrl = `${registryBaseUrl}/skills/${skillPath}`;
  const entityUrl = `${registryBaseUrl}/skills/${skillPath}/entity.json`;
  const pinnedSkillMdUrl = buildApiUrl(params.apiBaseUrl, `/skills/${pinnedPath}/SKILL.md`);
  const latestSkillMdUrl = buildApiUrl(params.apiBaseUrl, `/skills/${latestPath}/SKILL.md`);
  const pinnedManifestUrl = buildApiUrl(params.apiBaseUrl, `/skills/${pinnedPath}/manifest`);
  const latestManifestUrl = buildApiUrl(params.apiBaseUrl, `/skills/${latestPath}/manifest`);
  const installMetadataPinnedUrl = buildApiUrl(params.apiBaseUrl, `/skills/${pinnedPath}/install`);
  const installMetadataLatestUrl = buildApiUrl(params.apiBaseUrl, `/skills/${latestPath}/install`);
  const badgeApiUrl = buildApiUrl(params.apiBaseUrl, '/skills/badge', {
    name,
    metric,
    style,
    label,
  });
  const badgeImageUrl =
    `https://img.shields.io/endpoint?url=${encodeURIComponent(badgeApiUrl)}`;
  const badgeAlt = `${name} on HOL Registry (${metric})`;
  const badgeMarkdown = `[![${badgeAlt}](${badgeImageUrl})](${skillPageUrl})`;
  const badgeHtml =
    `<a href="${escapeHtml(skillPageUrl)}">` +
    `<img src="${escapeHtml(badgeImageUrl)}" alt="${escapeHtml(badgeAlt)}" /></a>`;
  const markdownLink = `[${name} on HOL Registry](${skillPageUrl})`;
  const htmlLink = `<a href="${escapeHtml(skillPageUrl)}">${escapeHtml(name)} on HOL Registry</a>`;
  const citationSnippet = [
    `If you reference \`${name}@${version}\`, use the canonical HOL page and machine-readable metadata:`,
    '',
    `- Canonical page: ${skillPageUrl}`,
    `- Entity metadata: ${entityUrl}`,
    `- Pinned manifest: ${pinnedManifestUrl}`,
  ].join('\n');
  const docsSnippet = [
    `### ${name}@${version}`,
    '',
    badgeMarkdown,
    '',
    `- Canonical HOL page: ${skillPageUrl}`,
    `- Entity metadata: ${entityUrl}`,
    `- OpenAPI: ${openapiUrl}`,
  ].join('\n');
  const packageMetadata = {
    homepage: skillPageUrl,
    ...(skillJson.repository ? { repository: skillJson.repository } : {}),
    ...(skillJson.bugs ? { bugs: skillJson.bugs } : {}),
  };
  const readmeSnippet = [
    `## ${name}`,
    '',
    badgeMarkdown,
    '',
    `- Canonical page: ${skillPageUrl}`,
    `- Entity metadata: ${entityUrl}`,
    `- Install (pinned SKILL.md): ${pinnedSkillMdUrl}`,
    `- Install (latest SKILL.md): ${latestSkillMdUrl}`,
    `- Manifest (pinned): ${pinnedManifestUrl}`,
    `- OpenAPI: ${openapiUrl}`,
    '',
    '```bash',
    `npx @hol-org/registry skills get --name "${name}" --version "${version}"`,
    '```',
  ].join('\n');
  const releaseNotes = [
    `### ${name}@${version}`,
    '',
    `- Canonical page: ${skillPageUrl}`,
    `- Install metadata (pinned): ${installMetadataPinnedUrl}`,
    `- Install metadata (latest): ${installMetadataLatestUrl}`,
    `- Pinned SKILL.md: ${pinnedSkillMdUrl}`,
    `- Latest SKILL.md: ${latestSkillMdUrl}`,
    `- Pinned manifest: ${pinnedManifestUrl}`,
    `- Latest manifest: ${latestManifestUrl}`,
    `- Entity metadata: ${entityUrl}`,
    '',
    badgeMarkdown,
  ].join('\n');
  const nextActions = [
    `Next actions for ${name}@${version}`,
    `1. Share the canonical page: ${skillPageUrl}`,
    `2. Add the README badge: ${badgeMarkdown}`,
    `3. Pin installs to this release: ${pinnedSkillMdUrl}`,
    `4. Keep the install metadata handy: ${installMetadataPinnedUrl}`,
  ].join('\n');

  const distribution = {
    name,
    version,
    label,
    metric,
    style,
    kind: 'skill',
    kitVersion: 1,
    metadata: {
      name,
      version,
      description: String(skillJson.description ?? '').trim(),
      homepage: String(skillJson.homepage ?? '').trim(),
      license: String(skillJson.license ?? '').trim(),
    },
    refs: {
      pinned: pinnedRef,
      latest: latestRef,
    },
    urls: {
      registryBaseUrl,
      skillPageUrl,
      skillLatestUrl,
      entityUrl,
      docsUrl,
      openapiUrl,
      installMetadataPinnedUrl,
      installMetadataLatestUrl,
      pinnedSkillMdUrl,
      latestSkillMdUrl,
      pinnedManifestUrl,
      latestManifestUrl,
      badgeApiUrl,
      badgeImageUrl,
    },
    snippets: {
      badgeMarkdown,
      badgeHtml,
      markdownLink,
      htmlLink,
      embedIframe: buildEmbedIframeSnippet(skillPageUrl, name, version),
      readmeSnippet,
      docsSnippet,
      citationSnippet,
      releaseNotes,
      nextActions,
      packageMetadataJson: JSON.stringify(packageMetadata, null, 2),
    },
    indexing: {
      host: 'hol.org',
      urls: [skillPageUrl, skillLatestUrl],
    },
  };

  return {
    ...distribution,
    machineReadable: {
      codemeta: buildCodemetaDocument({
        skillJson,
        distribution,
      }),
    },
  };
}
