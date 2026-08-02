import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  normalizeUpdateManifestUrl,
  UpdateService,
  type UpdateFetch,
} from '../src/update/update-service';

describe('UpdateService', () => {
  it('未配置更新源时不发出网络请求', async () => {
    let called = false;
    const service = new UpdateService(
      '0.1.0',
      '',
      'darwin',
      'arm64',
      async () => {
        called = true;
        return response('{}');
      },
    );

    expect(await service.check()).toMatchObject({
      state: 'unconfigured',
      currentVersion: '0.1.0',
    });
    expect(called).toBe(false);
  });

  it('发现匹配当前平台的新版本', async () => {
    const service = serviceWithManifest('0.2.0');

    expect(await service.check()).toMatchObject({
      state: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      artifactUrl: 'https://example.com/DesktopPet.dmg',
    });
  });

  it('服务端版本未提高时报告已是最新版', async () => {
    const service = serviceWithManifest('0.1.0');

    expect(await service.check()).toMatchObject({
      state: 'up-to-date',
      latestVersion: '0.1.0',
      artifactUrl: null,
    });
  });

  it('新版本缺少当前平台产物时返回错误', async () => {
    const service = serviceWithManifest('0.2.0', 'win32');

    expect(await service.check()).toMatchObject({
      state: 'error',
      message: '检查更新失败：新版本没有 darwin-arm64 产物',
    });
  });

  it('拒绝非 HTTPS 远程地址和损坏清单', async () => {
    expect(() => normalizeUpdateManifestUrl('http://example.com/latest.json'))
      .toThrow('必须使用 HTTPS');
    expect(normalizeUpdateManifestUrl('http://localhost:8000/latest.json'))
      .toBe('http://localhost:8000/latest.json');
    const service = new UpdateService(
      '0.1.0',
      'https://example.com/latest.json',
      'darwin',
      'arm64',
      async () => response('{broken'),
    );

    expect((await service.check()).state).toBe('error');
  });
});

describe('compareSemver', () => {
  it('稳定版高于同版本预发布，数字预发布按数值比较', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.2')).toBe(1);
    expect(compareSemver('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
  });
});

function serviceWithManifest(
  version: string,
  artifactPlatform: 'darwin' | 'win32' | 'linux' = 'darwin',
) {
  const fetcher: UpdateFetch = async () => response(JSON.stringify({
    schemaVersion: 1,
    version,
    publishedAt: '2026-07-31T12:00:00.000Z',
    releaseUrl: 'https://example.com/releases/v0.2.0',
    notes: '测试版本',
    artifacts: [{
      platform: artifactPlatform,
      arch: 'arm64',
      fileName: 'DesktopPet.dmg',
      size: 42,
      sha256: 'a'.repeat(64),
      signed: true,
      url: 'https://example.com/DesktopPet.dmg',
    }],
  }));
  return new UpdateService(
    '0.1.0',
    'https://example.com/latest.json',
    'darwin',
    'arm64',
    fetcher,
  );
}

function response(body: string): Pick<Response, 'ok' | 'status' | 'text'> {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}
