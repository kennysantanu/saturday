import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { parse } from 'devalue';
import { migrateDatabase } from '../src/lib/server/database.js';
import { createJob, getJob } from '../src/lib/server/services.js';
import { setBackupSettings, listBackups } from '../src/lib/server/backups.js';

test('production Settings download/upload/preview/confirm and supervised worker lifecycle', async () => {
	const scratch = mkdtempSync(join(tmpdir(), 'saturday-web-backup-'));
	const previous = process.env.SATURDAY_DB_PATH;
	process.env.SATURDAY_DB_PATH = join(scratch, 'career.sqlite');
	migrateDatabase();
	const job = createJob({ job_title: 'Backup QA', company_name: 'Example' });
	setBackupSettings({ enabled: true, interval_hours: 1, keep_count: 2 });
	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['scripts/start.mjs'], {
		cwd: resolve('.'),
		env: { ...process.env, PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	try {
		let ready = false;
		for (let i = 0; i < 80; i++) {
			try {
				if ((await fetch(`${base}/settings`)).ok) {
					ready = true;
					break;
				}
			} catch {}
			await new Promise((r) => setTimeout(r, 100));
		}
		assert.ok(ready, logs);
		const settings = await (await fetch(`${base}/settings`)).text();
		assert.ok(settings.includes('Backup and restore'));
		assert.ok(settings.replace(/\s+/g, ' ').includes('Automatic backups'));
		for (let i = 0; i < 30 && !listBackups().backups.some((b) => b.kind === 'scheduled'); i++)
			await new Promise((r) => setTimeout(r, 100));
		assert.ok(
			listBackups().backups.some((b) => b.kind === 'scheduled'),
			'supervisor starts the backup worker'
		);
		const created = await fetch(`${base}/settings?/download`, {
			method: 'POST',
			headers: {
				origin: base,
				accept: 'text/html',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: '',
			redirect: 'manual'
		});
		assert.equal(created.status, 303);
		const path = created.headers.get('location');
		const download = await fetch(`${base}${path}`);
		assert.equal(download.status, 200);
		assert.ok(download.headers.get('content-disposition').includes('attachment'));
		const bytes = new Uint8Array(await download.arrayBuffer());
		assert.equal(Buffer.from(bytes).subarray(0, 16).toString(), 'SQLite format 3\0');
		const extra = createJob({ job_title: 'After backup', company_name: 'Example' });
		const post = async (action, body) => {
			const response = await fetch(`${base}/settings?/${action}`, {
				method: 'POST',
				headers: { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' },
				body
			});
			const result = await response.json();
			return { ...result, data: result.data ? parse(result.data) : null };
		};
		const form = new FormData();
		form.set('backup_file', new File([bytes], 'portable.sqlite'));
		const prepared = await post('prepare', form);
		assert.equal(prepared.type, 'success');
		assert.equal(prepared.data.preview.current.job_count, 2);
		assert.equal(prepared.data.preview.incoming.job_count, 1);
		const confirmation = new FormData();
		confirmation.set('restore_id', prepared.data.preview.restore_id);
		const missing = await post('restore', confirmation);
		assert.equal(missing.type, 'failure');
		assert.ok(getJob(extra.id));
		confirmation.set('confirm', 'true');
		const restored = await post('restore', confirmation);
		assert.equal(restored.type, 'redirect');
		assert.ok(restored.location.includes('recovery='));
		assert.equal(getJob(extra.id), null);
		assert.ok(getJob(job.id));
		const invalid = new FormData();
		invalid.set('backup_file', new File(['bad file'], 'bad.sqlite'));
		assert.equal((await post('prepare', invalid)).type, 'failure');
		const schedule = new FormData();
		schedule.set('interval_hours', '24');
		schedule.set('keep_count', '10');
		assert.equal((await post('schedule', schedule)).type, 'redirect');
		const childExit = new Promise((r) => child.on('close', r));
		child.kill('SIGTERM');
		await childExit;
		assert.ok(!logs.includes('Error:'), logs);
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = new Promise((r) => child.on('close', r));
			child.kill('SIGTERM');
			await exited;
		}
		rmSync(scratch, { recursive: true, force: true });
		if (previous === undefined) delete process.env.SATURDAY_DB_PATH;
		else process.env.SATURDAY_DB_PATH = previous;
	}
});
