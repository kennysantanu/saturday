import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function connectMcp({
	entry = 'build/mcp/index.js',
	env = process.env,
	cwd = process.cwd(),
	node = process.execPath
} = {}) {
	const child = spawn(node, [entry], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
	const pending = new Map();
	let next = 1,
		stderr = '';
	const lines = createInterface({ input: child.stdout });
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	child.stdin.on('error', () => {});
	const fail = (error) => {
		for (const task of pending.values()) {
			clearTimeout(task.timer);
			task.reject(error);
		}
		pending.clear();
	};
	child.on('error', fail);
	child.on('exit', () => fail(new Error(`MCP exited: ${stderr}`)));
	lines.on('line', (line) => {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return fail(new Error('Invalid MCP output'));
		}
		const task = pending.get(message.id);
		if (!task) return;
		pending.delete(message.id);
		clearTimeout(task.timer);
		if (message.error) task.reject(new Error(JSON.stringify(message.error)));
		else task.resolve(message.result);
	});
	const request = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = next++,
				timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`MCP timeout: ${stderr}`));
				}, 15000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	const close = async () => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM');
			await new Promise((resolve) => child.once('exit', resolve));
		}
		lines.close();
	};
	try {
		const initialized = await request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'saturday-test', version: '1' }
		});
		child.stdin.write(
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
		);
		return {
			request,
			initialized,
			close,
			raw: (name, args = {}) => request('tools/call', { name, arguments: args }),
			call: async (name, args = {}) => {
				const result = await request('tools/call', { name, arguments: args });
				if (result.isError) throw new Error(result.content[0].text);
				return JSON.parse(result.content[0].text);
			}
		};
	} catch (error) {
		await close();
		throw error;
	}
}
