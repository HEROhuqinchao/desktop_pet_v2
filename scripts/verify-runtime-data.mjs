import fs from 'node:fs';
import path from 'node:path';

const dataRoot = path.resolve(process.argv[2] ?? 'data');
const validators = new Map([
  ['achievements.json', (value) => validateIdArray(value, 1)],
  ['catch_food.json', (value) => validateGameConfig(value)],
  ['dialogues.json', (value) => validateDialogues(value)],
  ['dodge_mouse.json', (value) => validateGameConfig(value)],
  ['events.json', (value) => validateIdArray(value, 10)],
  ['foods.json', (value) => validateIdArray(value, 3)],
  ['holidays.json', (value) => validateHolidays(value)],
  ['personalities.json', (value) => validatePersonalities(value)],
]);

if (!fs.statSync(dataRoot, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`运行时数据目录不存在：${dataRoot}`);
}

for (const [fileName, validate] of validators) {
  const filePath = path.join(dataRoot, fileName);
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`缺少运行时数据文件：${filePath}`);
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `运行时数据不是合法 JSON：${filePath}；${String(error)}`,
      { cause: error },
    );
  }
  if (!validate(value)) {
    throw new Error(`运行时数据结构不符合契约：${filePath}`);
  }
}

console.log(`runtime data OK: ${dataRoot} (${validators.size} files)`);

function validateIdArray(value, minimumLength) {
  if (!Array.isArray(value) || value.length < minimumLength) {
    return false;
  }
  const ids = value.map((entry) =>
    isRecord(entry) && typeof entry.id === 'string' ? entry.id : '',
  );
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function validateGameConfig(value) {
  return isRecord(value)
    && Number.isFinite(value.duration_seconds)
    && isRecord(value.modes)
    && ['easy', 'standard', 'challenge'].every((mode) =>
      isRecord(value.modes[mode]),
    );
}

function validateDialogues(value) {
  return isRecord(value)
    && Object.keys(value).length >= 20
    && Object.values(value).every(
      (lines) =>
        Array.isArray(lines)
        && lines.length > 0
        && lines.every((line) => typeof line === 'string' && line.length > 0),
    );
}

function validatePersonalities(value) {
  return isRecord(value)
    && isRecord(value.lime)
    && typeof value.lime.name === 'string'
    && typeof value.lime.tone === 'string';
}

function validateHolidays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const dates = value.map((entry) => {
    if (
      !isRecord(entry)
      || !Number.isInteger(entry.month)
      || !Number.isInteger(entry.day)
      || typeof entry.name !== 'string'
      || typeof entry.message !== 'string'
    ) {
      return '';
    }
    return `${entry.month}-${entry.day}`;
  });
  return dates.every(Boolean) && new Set(dates).size === dates.length;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
