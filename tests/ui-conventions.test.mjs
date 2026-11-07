import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Source-level checks for docs/design-guide.md. Each rule names the shared component to use instead.
const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src');

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

const rel = (path) => relative(root, path).split(sep).join('/');
const files = walk(src)
	.filter((path) => path.endsWith('.svelte'))
	.map((path) => ({ path: rel(path), text: readFileSync(path, 'utf8') }))
	// The installed shadcn primitives are not app code.
	.filter((file) => !file.path.startsWith('src/lib/components/ui/'));

const rules = [
	{
		name: 'Use ConfirmDialog, never window.confirm',
		test: /\b(window\.)?confirm\(/,
		skip: () => false
	},
	{
		name: 'Use NativeSelect inside Field, not a raw <select>',
		test: /<select[\s>]/,
		skip: (f) => f.path.endsWith('native-select.svelte')
	},
	{
		name: 'Use Checkbox or RadioOption, not a raw checkbox or radio input',
		test: /type="(checkbox|radio)"/,
		skip: (f) => /\/(checkbox|radio-option)\.svelte$/.test(f.path)
	},
	{
		name: 'Use Field for labelled controls, not a bare <label>',
		test: /<label[\s>]/,
		skip: (f) => /\/(field|checkbox|radio-option)\.svelte$/.test(f.path)
	},
	{
		name: 'Use the radius tokens (rounded-[var(--r-group)] and friends), not rounded-sm/md/lg/xl/2xl',
		test: /\brounded-(sm|md|lg|xl|2xl|3xl)\b/,
		skip: () => false
	},
	{
		name: 'Secondary text is at least 13px: use text-sm or .meta-text, not text-xs or text-[…]',
		test: /\btext-(xs|\[\d)/,
		skip: () => false
	},
	{
		name: 'Use PageShell for the document title instead of <svelte:head><title>',
		test: /<svelte:head>\s*<title>/,
		skip: (f) => /\/(\+layout|\+error|page-shell)\.svelte$/.test(f.path)
	},
	{
		name: 'Use the PageHeader back prop instead of a hand-written .back-link',
		test: /class="back-link"/,
		skip: (f) => f.path.endsWith('page-header.svelte')
	},
	{
		name: 'Use Pagination for Previous/Next, not hand-built buttons',
		test: />\s*Previous\s*</,
		skip: (f) => f.path.endsWith('pagination.svelte')
	},
	{
		name: 'Use the .link class for in-content links, not class="underline"',
		test: /class="[^"]*\bunderline\b(?!-offset)[^"]*"/,
		skip: () => false
	},
	{
		name: 'Use FilterChips for applied filters, not a hand-built .filter-chip',
		test: /class="filter-chip"/,
		skip: (f) => f.path.endsWith('filter-chips.svelte')
	},
	{
		name: 'Use SearchField for search inputs, not a raw type="search" input',
		test: /<Input[^>]*type="search"|^\s*type="search"/,
		skip: (f) => f.path.endsWith('search-field.svelte')
	},
	{
		name: 'Omit FilterBar action instead of passing an empty string (submits to the current page)',
		test: /\baction=""/,
		skip: () => false
	},
	{
		name: 'Use filterLabels or resultCount from $lib/filter-labels.js instead of ad hoc "matching filters" text',
		test: /\} matching (filters|search)/,
		skip: () => false
	},
	{
		name: 'Use a toast for a finished save, not a success Notice (Notice is for errors and persistent information)',
		test: /tone="success"/,
		skip: (f) => f.path.endsWith('notice.svelte') || f.path === 'src/routes/settings/+page.svelte'
	},
	{
		name: 'Use toast.error for a failure message, not toast.show',
		test: /toast\.show\(\s*['"`][^'"`]*\b(could not|couldn.t|failed|unable|cannot)\b/i,
		skip: () => false
	},
	{
		name: 'Dialogs are sm:max-w-md (short), sm:max-w-lg (forms and pickers) or the default; never 2xl',
		test: /<Dialog\.Content[^>]*sm:max-w-(2xl|xl|3xl|4xl|xs)/,
		skip: () => false
	},
	{
		name: 'Dialogs share one bottom-sheet style; do not add a one-off sheet class',
		test: /class="[^"]*\brecent-sheet\b/,
		skip: () => false
	},
	{
		name: 'Wrap use:enhance in enhanceWithFocus, withPending or a guard so the form shows progress',
		test: /use:enhance(?!=\{(enhanceWithFocus|enhanceNetwork|(?:guard|[A-Za-z_$][\w$]*Guard)\.enhance|withPending\())/,
		skip: () => false
	}
];

for (const rule of rules) {
	test(rule.name, () => {
		const hits = [];
		for (const file of files) {
			if (rule.skip(file)) continue;
			file.text.split('\n').forEach((line, index) => {
				if (rule.test.test(line)) hits.push(`${file.path}:${index + 1}  ${line.trim()}`);
			});
		}
		assert.deepEqual(hits, [], `${rule.name}\n  ${hits.join('\n  ')}`);
	});
}

test('Every page is wrapped in PageShell (or renders a shared page component)', () => {
	const pages = files.filter((f) => /\/\+page\.svelte$/.test(f.path));
	const missing = pages
		.filter((f) => !/PageShell|document-list|document-editor/.test(f.text))
		.map((f) => f.path);
	assert.deepEqual(missing, []);
});

test('Forms that collect free text warn before losing edits', () => {
	const forms = files.filter((f) =>
		/(jobs\/new|jobs\/\[id\]\/edit|networks\/new|networks\/\[id\]\/edit)\/\+page\.svelte$/.test(
			f.path
		)
	);
	assert.equal(forms.length, 4);
	const missing = forms.filter((f) => !f.text.includes('<UnsavedGuard')).map((f) => f.path);
	assert.deepEqual(missing, []);
});

test('Dialog footers use the standard dismissal labels', () => {
	// Cancel leaves a form, Keep editing answers the discard prompt, Later defers a restart, and
	// Close dismisses information. Anything else on a ghost button is a one-off.
	const allowed = new Set(['Cancel', 'Close', 'Later', 'Keep editing']);
	const odd = [];
	for (const file of files) {
		for (const footer of file.text.match(/<Dialog\.Footer[\s\S]*?<\/Dialog\.Footer\s*>/g) ?? [])
			for (const button of footer.match(/<Button[\s\S]*?<\/Button\s*>/g) ?? []) {
				if (!/variant="ghost"/.test(button)) continue;
				// The label is the text after the opening tag's last ">" (attributes may hold "=>").
				const label = button
					.replace(/<\/Button\s*>$/, '')
					.slice(button.lastIndexOf('>', button.length - 9) + 1)
					.trim();
				if (!allowed.has(label)) odd.push(`${file.path}: ${label}`);
			}
	}
	assert.deepEqual(odd, []);
});

test('ConfirmDialog locks itself while its form is being sent', () => {
	const dialog = files.find((f) => f.path.endsWith('confirm-dialog.svelte'));
	assert.match(dialog.text, /aria-busy/);
	assert.match(dialog.text, /MutationObserver/);
});
