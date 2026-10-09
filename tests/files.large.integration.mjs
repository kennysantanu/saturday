// Optional stress check: node --max-old-space-size=128 --test tests/files.large.integration.mjs
// Uses temporary disk space for an incompressible collection above 1 GiB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
test('file backups and streamed imports exceed 1 GiB with bounded memory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-large-files-'));
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	process.env.SATURDAY_DB_PATH = join(root, 'absent.sqlite');
	const s = await import('../src/lib/server/files/store.js');
	const b = await import('../src/lib/server/files/backups.js');
	let peak = process.memoryUsage().rss;
	const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
	try {
		await mkdir(join(root, 'files', 'documents'), { recursive: true });
		const sample = join(root, 'sample');
		const chunk = randomBytes(1024 * 1024);
		await pipeline(
			Readable.from(
				(function* () {
					for (let i = 0; i < 25; i++) yield chunk;
				})()
			),
			createWriteStream(sample)
		);
		const hash = await s.digest(sample);
		const documents = [];
		for (let i = 0; i < 43; i++) {
			const key = `documents/file-${i}.bin`;
			await copyFile(sample, join(root, 'files', key));
			documents.push({
				id: randomUUID(),
				key,
				...hash,
				created_via: 'manual',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				token: randomUUID()
			});
		}
		await writeFile(
			join(root, 'files', 'manifest.json'),
			JSON.stringify({
				format: 'saturday.files.numeric',
				dataset_id: randomUUID(),
				format_version: 1,
				token: randomUUID(),
				documents,
				designations: {}
			})
		);
		const backup = await b.createFileBackup();
		assert.ok(backup.bytes > 1024 ** 3, 'Compressed archive must itself exceed 1 GiB');
		const imported = await b.importFileBackup(
			createReadStream((await b.getFileBackup(backup.backup_id)).path)
		);
		assert.equal(imported.file_count, 43);
		assert.equal(imported.sha256, backup.sha256);
		assert.ok(peak < 512 * 1024 ** 2, `Peak RSS ${peak} must remain bounded below 512 MiB`);
		console.log(
			JSON.stringify({
				archive_bytes: backup.bytes,
				expanded_bytes: 43 * hash.size,
				peak_rss: peak
			})
		);
	} finally {
		clearInterval(timer);
		await rm(root, { recursive: true, force: true });
	}
});
