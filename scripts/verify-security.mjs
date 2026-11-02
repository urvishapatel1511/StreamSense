import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parseEnv } from 'node:util';

// Compare locally, output only counts/relative paths. Never print credential values or excerpts.
const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = join(root, '.env');
const privateEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const secretValues = Object.entries(privateEnv)
  .filter(([name, value]) => /SECRET|TOKEN|TWITCH_CLIENT_ID/.test(name) && value.length >= 8 && !/^(replace_|your_)/i.test(value))
  .flatMap(([, value]) => [value, encodeURIComponent(value)]);
const paths = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && (/\.(?:[cm]?js|jsx|tsx?|json|html|css|md)$/.test(entry.name) || ['.env.example', '.gitignore'].includes(entry.name))) paths.push(path);
  }
}
collect(root);
const leaked = paths.filter(path => secretValues.some(value => readFileSync(path, 'utf8').includes(value)));
if (leaked.length) {
  console.error(`FAIL: locally configured credential material found in ${leaked.length} source/build/document files.`);
  for (const path of leaked) console.error(relative(root, path));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${paths.length} source/build/document files scanned; no configured credential material found.`);
  if (!secretValues.length) console.log('NOTE: no local credential values available to compare; this is not proof against unknown secrets.');
}
const example = parseEnv(readFileSync(join(root, '.env.example'), 'utf8'));
assert.ok(/^replace_/.test(example.TWITCH_CLIENT_ID ?? ''), 'Client ID example must be a placeholder.');
assert.ok(/^replace_/.test(example.TWITCH_CLIENT_SECRET ?? ''), 'Client secret example must be a placeholder.');
assert.ok(!Object.keys(example).some(key => /ACCESS_TOKEN|REFRESH_TOKEN/.test(key)));
const ignore = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/);
for (const rule of ['.env', '.env.*', 'node_modules/', 'dist/']) assert.ok(ignore.includes(rule));
console.log('PASS: .env.example has placeholders; credential/generated-file ignore rules are present.');
console.log('LIMIT: exact local-value scan only, not an exhaustive secret/security audit or Git history inspection.');
