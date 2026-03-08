import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringifyCodemetaDocument } from './codemeta.mjs';

const README_MARKER = 'hol-attested-distribution';
const DOCS_MARKER = 'hol-attested-distribution-docs';

function buildMarkedBlock(marker, content) {
  return [
    `<!-- ${marker}:start -->`,
    content.trim(),
    `<!-- ${marker}:end -->`,
  ].join('\n');
}

function upsertMarkedBlock(source, marker, content) {
  const block = buildMarkedBlock(marker, content);
  const pattern = new RegExp(
    `<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`,
    'u',
  );
  if (pattern.test(source)) {
    return source.replace(pattern, block);
  }
  const trimmed = source.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readOrEmpty(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function applyDistributionKit(params) {
  const {
    repoDir,
    readmePath,
    docsPath,
    codemetaPath,
    distribution,
  } = params;

  const writtenFiles = [];

  if (readmePath) {
    const absoluteReadmePath = path.join(repoDir, readmePath);
    const currentReadme = await readOrEmpty(absoluteReadmePath);
    const nextReadme = upsertMarkedBlock(
      currentReadme,
      README_MARKER,
      distribution.snippets.readmeSnippet,
    );
    await ensureParentDir(absoluteReadmePath);
    await writeFile(absoluteReadmePath, nextReadme, 'utf8');
    writtenFiles.push(absoluteReadmePath);
  }

  if (docsPath) {
    const absoluteDocsPath = path.join(repoDir, docsPath);
    const currentDocs = await readOrEmpty(absoluteDocsPath);
    const nextDocs = upsertMarkedBlock(
      currentDocs,
      DOCS_MARKER,
      distribution.snippets.docsSnippet,
    );
    await ensureParentDir(absoluteDocsPath);
    await writeFile(absoluteDocsPath, nextDocs, 'utf8');
    writtenFiles.push(absoluteDocsPath);
  }

  if (codemetaPath) {
    const absoluteCodemetaPath = path.join(repoDir, codemetaPath);
    await ensureParentDir(absoluteCodemetaPath);
    await writeFile(
      absoluteCodemetaPath,
      stringifyCodemetaDocument(distribution.machineReadable.codemeta),
      'utf8',
    );
    writtenFiles.push(absoluteCodemetaPath);
  }

  return {
    ok: true,
    writtenFiles,
  };
}
