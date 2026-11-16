#!/usr/bin/env node
// npm publish dry-run for the publishable packages. Verifies what WOULD be
// uploaded (file list, tarball size, metadata) without touching the registry.
// The real publish commands live in PUBLISH.md and are run manually.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = readdirSync(path.join(root, 'packages')).filter((p) => p !== 'server-common');

let failed = false;
for (const pkg of packages) {
  const cwd = path.join(root, 'packages', pkg);
  console.log(`\n=== npm publish --dry-run ${pkg} ===`);
  try {
    const out = execFileSync('npm', ['publish', '--dry-run'], { cwd, encoding: 'utf8' });
    console.log(out);
  } catch (err) {
    failed = true;
    console.error(err.stdout ?? '', err.stderr ?? err.message);
  }
}
process.exit(failed ? 1 : 0);
