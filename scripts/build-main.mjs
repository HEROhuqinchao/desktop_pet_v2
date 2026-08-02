import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'dist', 'main');

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['@napi-rs/keyring', 'better-sqlite3', 'electron', 'sharp'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(projectRoot, 'src', 'main', 'main.ts')],
    outfile: path.join(outputRoot, 'main.cjs'),
  }),
  build({
    ...shared,
    entryPoints: [path.join(projectRoot, 'src', 'preload', 'preload.ts')],
    outfile: path.join(outputRoot, 'preload.cjs'),
  }),
]);
