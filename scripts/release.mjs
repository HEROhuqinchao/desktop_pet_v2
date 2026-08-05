import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = readJson(path.join(projectRoot, 'package.json'));
const packageLock = readJson(path.join(projectRoot, 'package-lock.json'));
const version = String(packageJson.version ?? '');

const command = process.argv[2];
const options = parseOptions(process.argv.slice(3));

if (command === 'verify') {
  verifySource(options);
} else if (command === 'metadata') {
  createPlatformMetadata(options);
} else if (command === 'merge') {
  mergeReleaseMetadata(options);
} else {
  throw new Error('用法：release.mjs <verify|metadata|merge> [options]');
}

function verifySource(values) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json 版本不是有效 SemVer：${version}`);
  }
  const lockRootVersion = String(packageLock.packages?.['']?.version ?? '');
  if (String(packageLock.version ?? '') !== version || lockRootVersion !== version) {
    throw new Error(
      `版本来源不一致：package=${version}, lock=${packageLock.version}, lockRoot=${lockRootVersion}`,
    );
  }
  const tag = optionalString(values, 'tag');
  const releaseMode = optionalString(values, 'release-mode') || 'signed';
  if (!['signed', 'unsigned'].includes(releaseMode)) {
    throw new Error(`不支持的发布模式：${releaseMode}`);
  }
  const expectedTag = releaseMode === 'unsigned'
    ? `v${version}-unsigned`
    : `v${version}`;
  if (tag && tag !== expectedTag) {
    throw new Error(
      `标签 ${tag} 与 ${releaseMode} 发布要求的 ${expectedTag} 不一致`,
    );
  }
  for (const relative of [
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'build/icon.icns',
    'build/icon.ico',
    'build/icon.png',
    'build/entitlements.mac.plist',
    'build/entitlements.mac.inherit.plist',
    '.github/workflows/ci.yml',
    '.github/workflows/package.yml',
    'RELEASE_NOTES.md',
  ]) {
    const target = path.join(projectRoot, relative);
    if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`发布必需文件缺失：${relative}`);
    }
  }
  if (hasFlag(values, 'require-clean')) {
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    if (dirty) throw new Error('正式发布要求 Git 工作区干净');
  }
  console.log(`Desktop Pet V2 source verified: v${version}`);
}

function createPlatformMetadata(values) {
  const platform = requiredString(values, 'platform');
  const arch = requiredString(values, 'arch');
  const directory = path.resolve(requiredString(values, 'directory'));
  const output = path.resolve(requiredString(values, 'output'));
  const signed = requiredString(values, 'signed') === 'true';
  const files = findExpectedArtifacts(directory, platform, arch);
  const artifacts = files.map((filePath) => ({
    platform,
    arch,
    fileName: path.basename(filePath),
    size: fs.statSync(filePath).size,
    sha256: sha256(filePath),
    signed,
  }));
  const metadata = {
    schemaVersion: 1,
    version,
    gitCommit: currentCommit(),
    generatedAt: new Date().toISOString(),
    platform,
    arch,
    signed,
    artifacts,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  const checksumPath = path.join(
    path.dirname(output),
    `checksums-${platform}-${arch}.sha256`,
  );
  fs.writeFileSync(
    checksumPath,
    `${artifacts.map((item) => `${item.sha256}  ${item.fileName}`).join('\n')}\n`,
    'ascii',
  );
  console.log(`Created ${path.basename(output)} with ${artifacts.length} artifacts`);
}

function mergeReleaseMetadata(values) {
  const input = path.resolve(requiredString(values, 'input'));
  const output = path.resolve(requiredString(values, 'output'));
  const baseUrl = secureUrl(requiredString(values, 'base-url'));
  const releaseUrl = secureUrl(requiredString(values, 'release-url'));
  const expected = csvValues(requiredString(values, 'expected'));
  const requireSigned = new Set(csvValues(optionalString(values, 'require-signed')));
  const metadataFiles = walkFiles(input).filter((filePath) =>
    /^build-meta-.+\.json$/.test(path.basename(filePath)),
  );
  const metadata = metadataFiles.map(readJson);
  const byTarget = new Map();
  for (const item of metadata) {
    if (item.schemaVersion !== 1 || item.version !== version) {
      throw new Error(`平台元数据版本无效：${JSON.stringify(item)}`);
    }
    const target = `${item.platform}-${item.arch}`;
    if (byTarget.has(target)) throw new Error(`平台元数据重复：${target}`);
    if (requireSigned.has(item.platform) && item.signed !== true) {
      throw new Error(`正式发布要求 ${target} 产物签名`);
    }
    byTarget.set(target, item);
  }
  for (const target of expected) {
    if (!byTarget.has(target)) throw new Error(`缺少平台元数据：${target}`);
  }
  const artifacts = [];
  for (const target of expected) {
    const item = byTarget.get(target);
    for (const artifact of item.artifacts ?? []) {
      const filePath = findUniqueFile(input, artifact.fileName);
      const actualHash = sha256(filePath);
      if (actualHash !== artifact.sha256 || fs.statSync(filePath).size !== artifact.size) {
        throw new Error(`发布文件与平台元数据不一致：${artifact.fileName}`);
      }
      artifacts.push({
        ...artifact,
        url: `${baseUrl}/${encodeURIComponent(artifact.fileName)}`,
      });
    }
  }
  const manifest = {
    schemaVersion: 1,
    version,
    publishedAt: new Date().toISOString(),
    releaseUrl,
    notes: `Desktop Pet V2 ${version}`,
    artifacts,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const checksumFile = path.join(path.dirname(output), 'SHA256SUMS.txt');
  fs.writeFileSync(
    checksumFile,
    `${artifacts.map((item) => `${item.sha256}  ${item.fileName}`).join('\n')}\n`,
    'ascii',
  );
  console.log(`Merged release manifest with ${artifacts.length} artifacts`);
}

function findExpectedArtifacts(directory, platform, arch) {
  const escapedVersion = escapeRegex(version);
  const escapedArch = escapeRegex(arch);
  const linuxArchPattern = arch === 'x64'
    ? '(x86_64\\.AppImage|amd64\\.deb)'
    : `${escapedArch}\\.(AppImage|deb)`;
  const patterns = {
    darwin: new RegExp(`^DesktopPet-${escapedVersion}-macOS-${escapedArch}\\.(dmg|zip)$`),
    win32: new RegExp(`^DesktopPet-${escapedVersion}-Windows-${escapedArch}-(Setup|Portable)\\.exe$`),
    'win32-store': new RegExp(`^DesktopPet-${escapedVersion}-Windows-${escapedArch}-Store\\.appx$`),
    linux: new RegExp(`^DesktopPet-${escapedVersion}-Linux-${linuxArchPattern}$`),
  };
  const expectedCounts = {
    darwin: 2,
    win32: 2,
    'win32-store': 1,
    linux: 2,
  };
  const pattern = patterns[platform];
  if (!pattern) throw new Error(`不支持的平台：${platform}`);
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  const expectedCount = expectedCounts[platform];
  if (files.length !== expectedCount) {
    throw new Error(`${platform}-${arch} 应有 ${expectedCount} 个发布文件，实际 ${files.length}`);
  }
  return files;
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function findUniqueFile(root, fileName) {
  const matches = walkFiles(root).filter((filePath) => path.basename(filePath) === fileName);
  if (matches.length !== 1) {
    throw new Error(`发布文件 ${fileName} 匹配数量应为 1，实际 ${matches.length}`);
  }
  return matches[0];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function currentCommit() {
  return process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
}

function secureUrl(value) {
  const parsed = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password) throw new Error('发布 URL 不能包含认证信息');
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error(`发布 URL 必须使用 HTTPS：${value}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    const key = argument.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function requiredString(values, key) {
  const value = values.get(key);
  if (typeof value !== 'string' || !value) throw new Error(`缺少 --${key}`);
  return value;
}

function optionalString(values, key) {
  const value = values.get(key);
  return typeof value === 'string' ? value : '';
}

function hasFlag(values, key) {
  return values.get(key) === true;
}

function csvValues(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
