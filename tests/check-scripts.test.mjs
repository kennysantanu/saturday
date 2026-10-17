import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkScriptNames } from '../scripts/check-scripts.mjs';

test('script checks catch undefined names across function scopes and shorthand properties', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-script-check-'));
	const file = join(root, 'install.mjs');
	try {
		await writeFile(
			file,
			`import { join } from 'node:path';
function walk(dir) { const path = join(dir, 'file'); return path; }
export function install(root) {
  const descriptor = join(root, 'installation.json');
  console.log(process.platform, descriptor);
  return { descriptor_path: path, missingProperty, typo: descripto };
}`
		);
		const diagnostics = checkScriptNames([file]);
		assert.equal(diagnostics.length, 3);
		assert.deepEqual(
			new Set(diagnostics.map((diagnostic) => diagnostic.code)),
			new Set([2304, 18004, 2552])
		);
		await writeFile(
			file,
			`import { join } from 'node:path';
function walk(dir) { const path = join(dir, 'file'); return path; }
export function install(root) {
  const descriptor = join(root, 'installation.json');
  console.log(process.platform, walk(root));
  return { descriptor_path: descriptor };
}`
		);
		assert.deepEqual(checkScriptNames([file]), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
