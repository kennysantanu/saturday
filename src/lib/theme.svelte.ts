export type ThemePreference = 'system' | 'light' | 'dark';

const storageKey = 'saturday-theme';
export const theme = $state({
	preference: 'system' as ThemePreference,
	ready: false,
	storageAvailable: true
});
let storage: Storage | undefined;
let system: MediaQueryList | undefined;

function preference(value: unknown): ThemePreference {
	return value === 'light' || value === 'dark' ? value : 'system';
}

function apply() {
	document.documentElement.dataset.theme =
		theme.preference === 'system' ? (system?.matches ? 'dark' : 'light') : theme.preference;
}

export function setTheme(value: string) {
	theme.preference = preference(value);
	try {
		if (!storage) throw new Error('Browser storage unavailable');
		if (theme.preference === 'system') storage.removeItem(storageKey);
		else storage.setItem(storageKey, theme.preference);
	} catch {
		theme.preference = 'system';
		theme.storageAvailable = false;
	}
	apply();
}

// Called once by the root layout; no server state or installation setting is involved.
export function initializeTheme() {
	system = window.matchMedia('(prefers-color-scheme: dark)');
	theme.storageAvailable = true;
	try {
		storage = window.localStorage;
		theme.preference = preference(storage.getItem(storageKey));
	} catch {
		storage = undefined;
		theme.preference = 'system';
		theme.storageAvailable = false;
	}
	apply();
	theme.ready = true;
	const systemChanged = () => {
		if (theme.preference === 'system') apply();
	};
	const storageChanged = (event: StorageEvent) => {
		if (event.storageArea !== storage || (event.key !== storageKey && event.key !== null)) return;
		theme.preference = preference(event.newValue);
		apply();
	};
	system.addEventListener('change', systemChanged);
	window.addEventListener('storage', storageChanged);
	return () => {
		system?.removeEventListener('change', systemChanged);
		window.removeEventListener('storage', storageChanged);
		theme.ready = false;
		storage = undefined;
		system = undefined;
	};
}
