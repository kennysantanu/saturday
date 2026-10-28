import puppeteer from 'puppeteer';
import { generateDocumentPdf } from '../../src/lib/server/files/pdf.js';
// Disposable-process fault injection; production services have no test switches.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deleteJob } from '../../src/lib/server/local/jobs.js';
import {
	uploadDocument,
	createDocument,
	copyDocument
} from '../../src/lib/server/files/documents.js';
import { LocalFileStore, filePaths } from '../../src/lib/server/files/store.js';
import { jobDeletionPath } from '../../src/lib/server/job-deletion-state.js';
const options = JSON.parse(process.argv[2]);
const crash = () => process.kill(process.pid, 'SIGKILL');
const resume = () => new Promise((resolve) => process.once('message', resolve));
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
	if (sql === 'COMMIT' && existsSync(jobDeletionPath()) && options.point === 'before-commit')
		crash();
	const result = exec.call(this, sql);
	if (sql === 'COMMIT' && existsSync(jobDeletionPath()) && options.point === 'after-commit')
		crash();
	return result;
};
let paused = false;
const lstat = fs.lstat;
fs.lstat = async (path, ...args) => {
	if (options.mode === 'copy' && String(path).endsWith('/documents/source.md') && !paused) {
		paused = true;
		process.send({ ready: true });
		await resume();
	}
	return lstat(path, ...args);
};
const mkdir = fs.mkdir;
fs.mkdir = async (path, ...args) => {
	if (options.point === 'notify-lock' && path === join(filePaths().state, 'lock') && !paused) {
		paused = true;
		process.send({ ready: true });
	}
	return mkdir(path, ...args);
};
const rename = fs.rename;
fs.rename = async (from, to) => {
	if (to === jobDeletionPath() && options.point === 'before-intent') crash();
	const result = await rename(from, to);
	if (to === jobDeletionPath() && options.point === 'after-intent') crash();
	if (
		to === join(filePaths().root, 'manifest.json') &&
		existsSync(jobDeletionPath()) &&
		options.point === 'after-manifest'
	)
		crash();
	return result;
};
const remove = fs.rm;
fs.rm = async (path, ...args) => {
	if (path === jobDeletionPath() && options.point === 'before-clear') crash();
	const result = await remove(path, ...args);
	if (path === jobDeletionPath() && options.point === 'after-clear') crash();
	return result;
};
syncBuiltinESMExports();
const deleteFile = LocalFileStore.prototype.delete;
let removed = 0;
LocalFileStore.prototype.delete = async function (key) {
	if (options.point === 'fail-file')
		throw Object.assign(new Error('Injected permission failure'), { code: 'EACCES' });
	if (options.point === 'hold-file' && removed === 0) {
		process.send({ ready: true });
		await resume();
	}
	await deleteFile.call(this, key);
	removed++;
	if (options.point === `after-file-${removed}`) crash();
};
try {
	let result;
	if (options.mode === 'pdf') {
		// Pause only the renderer in this subprocess; the real publication path remains unchanged.
		puppeteer.executablePath = () => process.execPath;
		puppeteer.launch = async () => ({
			newPage: async () => ({
				setJavaScriptEnabled: async () => {},
				setRequestInterception: async () => {},
				on() {},
				setContent: async () => {},
				evaluate: async () => true,
				pdf: async () => {
					process.send({ ready: true });
					await resume();
					return Buffer.from('%PDF-1.7\n');
				}
			}),
			close: async () => {}
		});
		result = await generateDocumentPdf({
			id: options.id,
			token: options.token,
			scope: options.job_id
		});
	} else if (options.mode === 'upload') {
		const stream = Readable.from(
			(async function* () {
				yield 'first chunk';
				process.send({ ready: true });
				await resume();
				yield 'last chunk';
			})()
		);
		result = await uploadDocument({ scope: options.job_id, filename: 'late.txt', stream });
	} else if (options.mode === 'copy') {
		result = await copyDocument({
			id: options.id,
			token: options.token,
			destination_scope: options.job_id,
			filename: 'copy.md'
		});
	} else if (options.mode === 'create') {
		result = await createDocument({
			scope: options.job_id,
			filename: 'early.md',
			content: 'included'
		});
	} else
		result = await deleteJob({
			job_id: options.job_id,
			dataset_id: options.dataset_id,
			confirm: true
		});
	console.log(JSON.stringify(result));
} catch (error) {
	console.log(JSON.stringify({ code: error.code, message: error.message }));
	process.exitCode = 1;
}
