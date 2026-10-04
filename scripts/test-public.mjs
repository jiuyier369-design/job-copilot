import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = JSON.parse(readFileSync(new URL('../tests/public-suite.json', import.meta.url), 'utf8'));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
