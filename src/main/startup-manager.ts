import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { linuxAutostartEntry } from '../core/startup';

const LINUX_AUTOSTART_FILE = 'DesktopPetV2.desktop';

export async function setLaunchAtStartup(enabled: boolean): Promise<boolean> {
  if (!app.isPackaged) {
    return false;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: [],
    });
    return app.getLoginItemSettings({
      path: process.execPath,
      args: [],
    }).openAtLogin;
  }
  if (process.platform === 'linux') {
    const autostartDirectory = path.join(configHome(), 'autostart');
    const autostartFile = path.join(
      autostartDirectory,
      LINUX_AUTOSTART_FILE,
    );
    if (!enabled) {
      await fs.rm(autostartFile, { force: true });
      return false;
    }
    await fs.mkdir(autostartDirectory, { recursive: true });
    await fs.writeFile(
      autostartFile,
      linuxAutostartEntry(process.execPath),
      'utf8',
    );
    return true;
  }
  return false;
}

function configHome(): string {
  const configured = process.env.XDG_CONFIG_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.config');
}
