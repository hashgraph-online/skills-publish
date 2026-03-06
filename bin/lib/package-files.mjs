import { readdir } from 'node:fs/promises';
import path from 'node:path';

const BLOCKED_DIRECTORY_NAMES = new Set([
  '.git',
  '.github',
  '.idea',
  '.next',
  '.turbo',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'temp',
  'tmp',
]);

const BLOCKED_FILE_NAMES = new Set([
  '.gitignore',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.yarnrc',
  '.yarnrc.yml',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'yarn.lock',
]);

const BLOCKED_EXTENSIONS = new Set([
  '.cer',
  '.crt',
  '.db',
  '.der',
  '.jks',
  '.kdbx',
  '.key',
  '.keystore',
  '.log',
  '.pem',
  '.p12',
  '.pfx',
  '.sqlite',
  '.sqlite3',
]);

function isHiddenSegment(segment) {
  return segment.startsWith('.');
}

function isEnvFile(baseName) {
  return baseName === '.env' || baseName.startsWith('.env.');
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join(path.posix.sep);
}

function classifyPackagePath(relativePath, isDirectory) {
  const normalizedPath = toPosix(relativePath);
  const segments = normalizedPath.split('/');
  const baseName = segments[segments.length - 1]?.toLowerCase() ?? '';

  if (segments.some((segment) => BLOCKED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return 'blocked-directory';
  }

  if (segments.some((segment) => isHiddenSegment(segment) && segment !== '.')) {
    return 'hidden-path';
  }

  if (!isDirectory && isEnvFile(baseName)) {
    return 'env-file';
  }

  if (!isDirectory && BLOCKED_FILE_NAMES.has(baseName)) {
    return 'blocked-file';
  }

  if (!isDirectory) {
    const extension = path.posix.extname(baseName);
    if (BLOCKED_EXTENSIONS.has(extension)) {
      return 'blocked-extension';
    }
  }

  return null;
}

export async function discoverSkillPackageFiles(rootDir) {
  const includedFiles = [];
  const excludedFiles = [];

  async function walk(relativeDir = '') {
    const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDir
        ? path.posix.join(relativeDir, entry.name)
        : entry.name;
      const exclusionReason = classifyPackagePath(relativePath, entry.isDirectory());
      if (exclusionReason) {
        excludedFiles.push({
          relativePath: entry.isDirectory() ? `${relativePath}/` : relativePath,
          reason: exclusionReason,
        });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      includedFiles.push({
        relativePath,
        absolutePath: path.join(rootDir, relativePath),
      });
    }
  }

  await walk();

  includedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  excludedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    includedFiles,
    excludedFiles,
  };
}
