import * as fs from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	inspectExtension,
	extensionCatalog,
	extensionPaths
} from '../src/lib/server/extensions.js';
export async function generateExtensions(
	root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
) {
	const candidates = new Map();
	const examples = join(root, 'examples', 'extensions');
	let names = [];
	try {
		names = await fs.readdir(examples);
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
	for (const name of names) {
		const path = join(examples, name);
		if ((await fs.stat(path)).isDirectory()) {
			const info = await inspectExtension(path);
			candidates.set(info.manifest.id, { ...info, path });
		}
	}
	for (const entry of (await extensionCatalog()).installed) {
		if (entry.pending_remove) continue;
		const path = join(extensionPaths().code, entry.id),
			info = await inspectExtension(path);
		if (info.fingerprint !== entry.fingerprint)
			throw new Error(`Installed extension ${entry.id} changed. Use an explicit update.`);
		candidates.set(entry.id, { ...info, path });
	}
	const serverPath = join(root, 'src', 'lib', 'server', 'extensions.generated.js'),
		clientPath = join(root, 'src', 'lib', 'extensions.generated.js');
	const imports = (output, server) =>
		[...candidates]
			.map(([id, e]) => {
				const entry = server ? e.manifest.server : e.manifest.page;
				const spec = entry
					? './' + relative(dirname(output), join(e.path, entry)).split('\\').join('/')
					: null;
				return `${JSON.stringify(id)}: {manifest: ${JSON.stringify(e.manifest)}, fingerprint: ${JSON.stringify(e.fingerprint)}, ${server ? 'server' : 'page'}: ${spec ? `() => import(${JSON.stringify(spec)})` : 'null'}}`;
			})
			.join(',\n');
	for (const [path, server] of [
		[serverPath, true],
		[clientPath, false]
	]) {
		await fs.mkdir(dirname(path), { recursive: true });
		await fs.writeFile(
			path,
			`// Generated; do not edit.\nexport const extensionRegistry = {\n${imports(path, server)}\n};\n`
		);
	}
	return candidates;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await generateExtensions();
