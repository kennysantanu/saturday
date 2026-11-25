function formatSeen(value) {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export async function waitForCondition(
	label,
	check,
	{ timeoutMs = 15000, intervalMs = 50, describe } = {}
) {
	const deadline = Date.now() + timeoutMs;
	let lastValue;
	let lastError = null;
	for (;;) {
		try {
			lastError = null;
			lastValue = await check();
			if (lastValue) return lastValue;
		} catch (error) {
			lastError = error;
		}
		if (Date.now() >= deadline) break;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	let detail = lastValue;
	if (describe) {
		try {
			detail = await describe();
		} catch (error) {
			detail = `describe failed: ${error?.message || error}`;
		}
	}
	const errorPart = lastError ? ` (last error: ${lastError.message || lastError})` : '';
	throw new Error(
		`Timed out after ${timeoutMs}ms waiting for ${label}; saw: ${formatSeen(detail)}${errorPart}`
	);
}

export async function waitForValue(
	label,
	read,
	predicate,
	{ timeoutMs = 15000, intervalMs = 50, describe } = {}
) {
	let lastSeen;
	await waitForCondition(
		label,
		async () => {
			lastSeen = await read();
			return Boolean(await predicate(lastSeen));
		},
		{
			timeoutMs,
			intervalMs,
			describe: async () => (describe ? describe(lastSeen) : lastSeen)
		}
	);
	return lastSeen;
}

export async function describePageState(page) {
	return page.evaluate(() => ({
		url: location.href,
		dialogs: [...document.querySelectorAll('[data-slot="dialog-content"], [role="dialog"]')].map(
			(el) => ({
				role: el.getAttribute('role'),
				slot: el.getAttribute('data-slot'),
				state: el.getAttribute('data-state'),
				title: el.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ?? null,
				busy: el.getAttribute('aria-busy')
			})
		),
		alerts: [...document.querySelectorAll('[role="alert"]')].map((el) =>
			el.textContent.replace(/\s+/g, ' ').trim()
		),
		toasts: [...document.querySelectorAll('.toast')].map((el) =>
			el.textContent.replace(/\s+/g, ' ').trim()
		),
		busyForms: [...document.querySelectorAll('form[aria-busy="true"]')].map(
			(el) => el.id || 'form'
		),
		invalidFields: [...document.querySelectorAll('[aria-invalid="true"]')].map((el) => ({
			id: el.id || el.getAttribute('name') || el.tagName,
			value: 'value' in el ? el.value : null,
			error: el.getAttribute('aria-describedby')
				? (document.getElementById(el.getAttribute('aria-describedby'))?.textContent?.trim() ??
					null)
				: null
		})),
		dialogFields: [
			...document.querySelectorAll(
				'[data-slot="dialog-content"] input, [data-slot="dialog-content"] textarea, [data-slot="dialog-content"] select'
			)
		].map((el) => ({
			id: el.id || el.getAttribute('name'),
			value: el.value
		}))
	}));
}

export async function waitForPage(
	page,
	label,
	fn,
	args = [],
	{ timeoutMs = 15000, intervalMs = 50, describe } = {}
) {
	return waitForCondition(label, async () => page.evaluate(fn, ...args), {
		timeoutMs,
		intervalMs,
		describe: describe ? () => describe() : () => describePageState(page)
	});
}

export async function waitForSelectorReady(
	page,
	selector,
	{ label = `selector ${selector}`, timeoutMs = 15000, intervalMs = 50, visible = false } = {}
) {
	await waitForCondition(
		label,
		async () => {
			const handle = await page.$(selector);
			if (!handle) return false;
			try {
				if (!visible) return true;
				return await handle.evaluate((el) => {
					const rect = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					return (
						style.visibility !== 'hidden' &&
						style.display !== 'none' &&
						parseFloat(style.opacity) > 0 &&
						rect.width > 0 &&
						rect.height > 0 &&
						!el.disabled &&
						el.getAttribute('aria-disabled') !== 'true'
					);
				});
			} finally {
				await handle.dispose();
			}
		},
		{
			timeoutMs,
			intervalMs,
			describe: () => describePageState(page)
		}
	);
}

export async function waitForSelectorGone(
	page,
	selector,
	{ label = `${selector} to disappear`, timeoutMs = 15000, intervalMs = 50 } = {}
) {
	await waitForCondition(
		label,
		async () => {
			const handles = await page.$$(selector);
			await Promise.all(handles.map((h) => h.dispose()));
			return handles.length === 0;
		},
		{
			timeoutMs,
			intervalMs,
			describe: () => describePageState(page)
		}
	);
}

export async function waitForDialogClosed(
	page,
	{ label = 'dialog to close', timeoutMs = 15000, intervalMs = 50 } = {}
) {
	await waitForSelectorGone(
		page,
		'[data-slot="dialog-content"], [data-slot="dialog-overlay"], [role="dialog"]',
		{ label, timeoutMs, intervalMs }
	);
}

export async function clickWhenReady(
	page,
	selector,
	{ label = `clickable ${selector}`, timeoutMs = 15000, intervalMs = 50 } = {}
) {
	await waitForSelectorReady(page, selector, { label, timeoutMs, intervalMs, visible: true });
	await page.click(selector);
}
