import {
	runScheduledBackup,
	getBackupSettings,
	publicBackupError
} from '../src/lib/server/backups.js';
let stopping = false;
let timer;
function tick() {
	if (stopping) return;
	try {
		// Most ticks only read local schedule state; do not lock the database unnecessarily.
		const settings = getBackupSettings();
		const now = Date.now();
		if (
			settings.enabled &&
			!(Date.parse(settings.next_due_at ?? '') > now) &&
			!(Date.parse(settings.retry_after ?? '') > now)
		) {
			const result = runScheduledBackup();
			if (result.error) console.error(`Automatic backup: ${result.error.message}`);
		}
	} catch (error) {
		console.error(`Automatic backup: ${publicBackupError(error).message}`);
	}
	if (!stopping) timer = setTimeout(tick, 60000);
}
for (const signal of ['SIGINT', 'SIGTERM'])
	process.on(signal, () => {
		stopping = true;
		clearTimeout(timer);
	});
tick();
