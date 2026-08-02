import fs from 'node:fs';
import path from 'node:path';

export interface EncryptionAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export interface CredentialStore {
  getSecret(): string | null;
  setSecret(secret: string): void;
  deleteSecret(): void;
}

export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): boolean;
}

export class SystemKeyringCredentialStore implements CredentialStore {
  constructor(private readonly entry: KeyringEntry) {}

  getSecret(): string | null {
    try {
      return this.entry.getPassword() || null;
    } catch {
      return null;
    }
  }

  setSecret(secret: string): void {
    const normalized = secret.trim();
    if (!normalized) throw new Error('在线对话密钥不能为空');
    this.entry.setPassword(normalized);
  }

  deleteSecret(): void {
    try {
      this.entry.deletePassword();
    } catch {
      return;
    }
  }
}

export class EncryptedCredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly adapter: EncryptionAdapter,
    private readonly platform = process.platform,
  ) {}

  getSecret(): string | null {
    if (!fs.existsSync(this.filePath) || !this.encryptionIsSafe()) {
      return null;
    }
    try {
      const value = this.adapter.decryptString(fs.readFileSync(this.filePath));
      return value || null;
    } catch {
      return null;
    }
  }

  setSecret(secret: string): void {
    const normalized = secret.trim();
    if (!normalized) throw new Error('在线对话密钥不能为空');
    if (!this.encryptionIsSafe()) {
      throw new Error('当前系统安全密钥存储不可用');
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, this.adapter.encryptString(normalized), {
      mode: 0o600,
    });
    fs.renameSync(temporary, this.filePath);
  }

  deleteSecret(): void {
    if (fs.existsSync(this.filePath)) {
      fs.rmSync(this.filePath);
    }
  }

  private encryptionIsSafe(): boolean {
    if (!this.adapter.isEncryptionAvailable()) return false;
    return !(
      this.platform === 'linux'
      && this.adapter.getSelectedStorageBackend?.() === 'basic_text'
    );
  }
}
