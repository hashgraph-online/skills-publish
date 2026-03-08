function trimString(value) {
  return String(value ?? '').trim();
}

function normalizeRepositoryUrl(repository) {
  if (!repository) {
    return '';
  }
  if (typeof repository === 'string') {
    return repository.replace(/^git\+/u, '').replace(/\.git$/u, '');
  }
  if (typeof repository === 'object' && !Array.isArray(repository)) {
    return trimString(repository.url).replace(/^git\+/u, '').replace(/\.git$/u, '');
  }
  return '';
}

function normalizeAuthor(author) {
  const raw = trimString(author);
  if (!raw) {
    return null;
  }
  const match = /^(?<name>[^<]+?)(?:\s*<(?<email>[^>]+)>)?$/u.exec(raw);
  if (!match?.groups) {
    return {
      '@type': 'Organization',
      name: raw,
    };
  }
  const name = trimString(match.groups.name);
  const email = trimString(match.groups.email);
  return {
    '@type': 'Person',
    name: name || raw,
    ...(email ? { email } : {}),
  };
}

function buildKeywords(skillJson) {
  if (!Array.isArray(skillJson.keywords)) {
    return [];
  }
  return skillJson.keywords
    .map((value) => trimString(value))
    .filter(Boolean);
}

export function buildCodemetaDocument(params) {
  const { skillJson, distribution } = params;
  const repositoryUrl = normalizeRepositoryUrl(skillJson.repository ?? skillJson.repo);
  const author = normalizeAuthor(skillJson.author);
  const keywords = buildKeywords(skillJson);

  return {
    '@context': 'https://doi.org/10.5063/schema/codemeta-2.0',
    '@type': 'SoftwareSourceCode',
    name: distribution.metadata.name,
    version: distribution.metadata.version,
    description: distribution.metadata.description,
    ...(distribution.metadata.license ? { license: distribution.metadata.license } : {}),
    ...(repositoryUrl ? { codeRepository: repositoryUrl } : {}),
    ...(distribution.urls.skillPageUrl ? { url: distribution.urls.skillPageUrl } : {}),
    ...(distribution.urls.entityUrl ? { identifier: distribution.urls.entityUrl } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(author ? { author } : {}),
    publisher: {
      '@type': 'Organization',
      name: 'Hashgraph Online',
      url: 'https://hol.org',
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'Hashgraph Online Registry',
      url: distribution.urls.registryBaseUrl,
    },
    subjectOf: [
      distribution.urls.skillPageUrl,
      distribution.urls.entityUrl,
      distribution.urls.badgeApiUrl,
      distribution.urls.openapiUrl,
    ].filter(Boolean),
  };
}

export function stringifyCodemetaDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}
