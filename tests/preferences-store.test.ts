import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PreferencesStore,
  defaultPreferences,
} from '../src/main/preferences-store';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('PreferencesStore', () => {
  it('round-trips settings and normalized display position', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-pet-v2-'),
    );
    temporaryDirectories.push(directory);
    const store = new PreferencesStore(
      path.join(directory, 'preferences.json'),
    );
    const preferences = defaultPreferences();
    preferences.settings.scale = 1.35;
    preferences.settings.activityFrequency = 80;
    preferences.position = {
      displayId: '123',
      xRatio: 0.25,
      yRatio: 0.75,
      valid: true,
    };

    store.save(preferences);

    expect(store.load()).toEqual(preferences);
  });

  it('falls back safely when the file is invalid', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-pet-v2-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'preferences.json');
    fs.writeFileSync(filePath, '{broken', 'utf8');

    expect(new PreferencesStore(filePath).load()).toEqual(
      defaultPreferences(),
    );
  });

  it('只保留 HTTPS 或 localhost 更新清单地址', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-pet-v2-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'preferences.json');
    const preferences = defaultPreferences();
    preferences.settings.updateManifestUrl = 'http://example.com/latest.json';
    fs.writeFileSync(filePath, JSON.stringify(preferences), 'utf8');

    expect(new PreferencesStore(filePath).load().settings.updateManifestUrl)
      .toBe('');

    preferences.settings.updateManifestUrl = 'http://localhost:8080/latest.json';
    fs.writeFileSync(filePath, JSON.stringify(preferences), 'utf8');
    expect(new PreferencesStore(filePath).load().settings.updateManifestUrl)
      .toBe('http://localhost:8080/latest.json');
  });
});
