// Reports whether the local Saturday web app is answering.
// Usage: npm run status   (PORT overrides the default 3000)
const port = process.env.PORT || '3000';
const url = `http://127.0.0.1:${port}/`;

try {
	const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
	if (response.ok) {
		console.log(`Saturday is running at ${url}`);
	} else {
		console.error(`Something answered at ${url} but returned status ${response.status}.`);
		process.exit(1);
	}
} catch {
	console.error(`Saturday is not running at ${url}.`);
	console.error('Start it with "npm run start", or set PORT if you used another port.');
	process.exit(1);
}
