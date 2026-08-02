import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const executable = path.resolve(process.argv[2] ?? '');
const resources = path.resolve(process.argv[3] ?? '');
const runtimeDataFiles = [
  'achievements.json',
  'catch_food.json',
  'dialogues.json',
  'dodge_mouse.json',
  'events.json',
  'foods.json',
  'holidays.json',
  'personalities.json',
];
const rendererEntries = [
  'bubble/index.html',
  'game/index.html',
  'panel/index.html',
  'pet/index.html',
  'settings/index.html',
];

if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
  throw new Error(`打包程序不存在：${executable}`);
}
if (!fs.statSync(resources, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`Resources 目录不存在：${resources}`);
}

for (const fileName of runtimeDataFiles) {
  const filePath = path.join(resources, 'data', fileName);
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`打包产物缺少运行时数据：${filePath}`);
  }
  JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const nativeFiles = walkFiles(resources).filter((filePath) => filePath.endsWith('.node'));
const sqlite = findOne(nativeFiles, (filePath) => filePath.includes('better-sqlite3'));
const keyring = findOne(nativeFiles, (filePath) => filePath.includes('keyring'));
const program = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const [resources, rendererJson, ...nativeTargets] = process.argv.slice(1);',
  'for (const relative of JSON.parse(rendererJson)) {',
  "  const target = path.join(resources, 'app.asar', 'dist', 'renderer', relative);",
  '  if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {',
  "    throw new Error('renderer entry missing: ' + target);",
  '  }',
  "  console.log('renderer entry OK: ' + relative);",
  '}',
  'for (const target of nativeTargets) {',
  '  require(path.resolve(target));',
  "  console.log('native module OK: ' + target);",
  '}',
  "console.log('Electron modules ABI=' + process.versions.modules);",
].join('\n');
const result = spawnSync(
  executable,
  ['-e', program, resources, JSON.stringify(rendererEntries), sqlite, keyring],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    timeout: 30_000,
  },
);
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`打包原生模块加载失败，退出码 ${result.status}`);
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

function findOne(files, predicate) {
  const matches = files.filter(predicate);
  if (matches.length === 0) throw new Error('打包产物缺少必需原生模块');
  return matches[0];
}
