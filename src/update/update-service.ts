import type {
  UpdateArtifact,
  UpdateManifest,
  UpdateStatus,
} from '../shared/contracts';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const CHECK_TIMEOUT_MS = 10_000;

export type UpdateFetch = (
  input: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

export class UpdateService {
  private manifestUrl: string;
  private latestStatus: UpdateStatus;

  constructor(
    private readonly currentVersion: string,
    manifestUrl: string,
    private readonly platform: NodeJS.Platform,
    private readonly arch: string,
    private readonly fetcher: UpdateFetch = fetch,
  ) {
    this.manifestUrl = safeNormalizeUpdateManifestUrl(manifestUrl);
    this.latestStatus = initialUpdateStatus(currentVersion, this.manifestUrl);
  }

  configure(manifestUrl: string): UpdateStatus {
    this.manifestUrl = safeNormalizeUpdateManifestUrl(manifestUrl);
    this.latestStatus = initialUpdateStatus(this.currentVersion, this.manifestUrl);
    return this.status();
  }

  status(): UpdateStatus {
    return { ...this.latestStatus };
  }

  async check(): Promise<UpdateStatus> {
    if (!this.manifestUrl) {
      this.latestStatus = initialUpdateStatus(this.currentVersion, '');
      return this.status();
    }
    this.latestStatus = {
      ...initialUpdateStatus(this.currentVersion, this.manifestUrl),
      state: 'checking',
      message: '正在检查更新',
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await this.fetcher(this.manifestUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
        throw new Error('更新清单体积超过 1 MiB');
      }
      const manifest = parseUpdateManifest(JSON.parse(text));
      const checkedAt = new Date().toISOString();
      const comparison = compareSemver(manifest.version, this.currentVersion);
      if (comparison <= 0) {
        this.latestStatus = {
          state: 'up-to-date',
          currentVersion: this.currentVersion,
          latestVersion: manifest.version,
          message: `当前已是最新版本 v${this.currentVersion}`,
          manifestUrl: this.manifestUrl,
          releaseUrl: manifest.releaseUrl,
          artifactUrl: null,
          checkedAt,
        };
        return this.status();
      }
      const artifact = manifest.artifacts.find(
        (item) => item.platform === this.platform && item.arch === this.arch,
      );
      if (!artifact) {
        throw new Error(`新版本没有 ${this.platform}-${this.arch} 产物`);
      }
      this.latestStatus = {
        state: 'available',
        currentVersion: this.currentVersion,
        latestVersion: manifest.version,
        message: `发现新版本 v${manifest.version}`,
        manifestUrl: this.manifestUrl,
        releaseUrl: manifest.releaseUrl,
        artifactUrl: artifact.url,
        checkedAt,
      };
    } catch (error) {
      this.latestStatus = {
        state: 'error',
        currentVersion: this.currentVersion,
        latestVersion: null,
        message: `检查更新失败：${errorMessage(error)}`,
        manifestUrl: this.manifestUrl,
        releaseUrl: null,
        artifactUrl: null,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
    return this.status();
  }
}

export function normalizeUpdateManifestUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('更新清单地址必须是字符串');
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2_048) throw new Error('更新清单地址过长');
  const parsed = new URL(trimmed);
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password) throw new Error('更新地址不能包含认证信息');
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('更新清单地址必须使用 HTTPS');
  }
  parsed.hash = '';
  return parsed.toString();
}

export function safeNormalizeUpdateManifestUrl(value: unknown): string {
  try {
    return normalizeUpdateManifestUrl(value);
  } catch {
    return '';
  }
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = a.numbers[index] - b.numbers[index];
    if (difference !== 0) return Math.sign(difference);
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const first = a.prerelease[index];
    const second = b.prerelease[index];
    if (first === undefined) return -1;
    if (second === undefined) return 1;
    if (first === second) continue;
    const firstNumber = /^\d+$/.test(first) ? Number(first) : null;
    const secondNumber = /^\d+$/.test(second) ? Number(second) : null;
    if (firstNumber !== null && secondNumber !== null) {
      return firstNumber < secondNumber ? -1 : 1;
    }
    if (firstNumber !== null) return -1;
    if (secondNumber !== null) return 1;
    return first < second ? -1 : 1;
  }
  return 0;
}

function initialUpdateStatus(currentVersion: string, manifestUrl: string): UpdateStatus {
  return {
    state: manifestUrl ? 'idle' : 'unconfigured',
    currentVersion,
    latestVersion: null,
    message: manifestUrl ? '尚未检查更新' : '尚未配置更新清单地址',
    manifestUrl,
    releaseUrl: null,
    artifactUrl: null,
    checkedAt: null,
  };
}

function parseUpdateManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('更新清单顶层格式无效');
  }
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || !Array.isArray(source.artifacts)) {
    throw new Error('更新清单版本或产物数组无效');
  }
  const version = String(source.version ?? '');
  parseSemver(version);
  const releaseUrl = normalizeUpdateManifestUrl(String(source.releaseUrl ?? ''));
  if (!releaseUrl) throw new Error('更新清单缺少发布页');
  const artifacts = source.artifacts.map(parseUpdateArtifact);
  if (artifacts.length === 0 || artifacts.length > 32) {
    throw new Error('更新清单产物数量无效');
  }
  const publishedAt = String(source.publishedAt ?? '');
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('发布时间无效');
  return {
    schemaVersion: 1,
    version,
    publishedAt,
    releaseUrl,
    notes: String(source.notes ?? '').slice(0, 5_000),
    artifacts,
  };
}

function parseUpdateArtifact(value: unknown): UpdateArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('更新产物格式无效');
  }
  const source = value as Record<string, unknown>;
  const platform = String(source.platform ?? '');
  const arch = String(source.arch ?? '');
  const fileName = String(source.fileName ?? '');
  const sha256 = String(source.sha256 ?? '');
  const size = Number(source.size);
  const signed = source.signed;
  const url = normalizeUpdateManifestUrl(String(source.url ?? ''));
  if (
    !['darwin', 'win32', 'linux'].includes(platform)
    || !['arm64', 'x64'].includes(arch)
    || !/^[A-Za-z0-9._-]{1,180}$/.test(fileName)
    || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(size)
    || size <= 0
    || typeof signed !== 'boolean'
    || !url
  ) {
    throw new Error('更新产物字段无效');
  }
  return {
    platform: platform as UpdateArtifact['platform'],
    arch,
    fileName,
    size,
    sha256,
    signed,
    url,
  };
}

function parseSemver(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) throw new Error(`版本号无效：${value}`);
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
