import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EncryptedCredentialStore,
  SystemKeyringCredentialStore,
} from '../src/main/credential-store';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('EncryptedCredentialStore', () => {
  it('只把加密字节写入文件并可读取和删除', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-secret-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'provider.key');
    const store = new EncryptedCredentialStore(filePath, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(
        Buffer.from(value).map((byte) => byte ^ 0x5a),
      ),
      decryptString: (value) => Buffer.from(value)
        .map((byte) => byte ^ 0x5a)
        .toString(),
      getSelectedStorageBackend: () => 'unknown',
    });

    store.setSecret('sk-secret');
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('sk-secret');
    expect(store.getSecret()).toBe('sk-secret');
    store.deleteSecret();
    expect(store.getSecret()).toBeNull();
  });

  it('Linux 明文后端或不可用加密能力时拒绝保存', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-secret-'));
    temporaryDirectories.push(directory);
    const store = new EncryptedCredentialStore(
      path.join(directory, 'provider.key'),
      {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString(),
        getSelectedStorageBackend: () => 'basic_text',
      },
      'linux',
    );

    expect(() => store.setSecret('secret')).toThrow('安全密钥存储不可用');
  });
});

describe('SystemKeyringCredentialStore', () => {
  it('通过系统 Keyring 读写并删除密钥', () => {
    let stored: string | null = null;
    const store = new SystemKeyringCredentialStore({
      getPassword: () => stored,
      setPassword: (value) => {
        stored = value;
      },
      deletePassword: () => {
        stored = null;
        return true;
      },
    });

    store.setSecret(' key-secret ');
    expect(store.getSecret()).toBe('key-secret');
    store.deleteSecret();
    expect(store.getSecret()).toBeNull();
  });
});
