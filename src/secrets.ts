import type { App } from 'obsidian';

// The OpenRouter key is stored per device. With SecretStorage (Obsidian 1.11.4+) it lives in the app's
// local secret store, outside the vault. Older versions fall back to the plugin's data.json.

const SECRET_ID = 'inline-ask-openrouter-key';

export interface KeyStore {
	get(): string | null;
	set(key: string): Promise<void>;
	clear(): Promise<void>;
	readonly location: string;
}

export function createKeyStore(
	app: App,
	fallback: { read: () => string; write: (key: string) => Promise<void> },
): KeyStore {
	// minAppVersion guarantees SecretStorage; the check is a guard in case an environment lacks it.
	const storage = (app as Partial<Pick<App, 'secretStorage'>>).secretStorage;
	if (storage && typeof storage.getSecret === 'function') {
		return {
			location: "this device's secret storage",
			get: () => storage.getSecret(SECRET_ID) || null,
			set: async (key) => storage.setSecret(SECRET_ID, key),
			// SecretStorage has no delete; an empty value means "no key".
			clear: async () => storage.setSecret(SECRET_ID, ''),
		};
	}
	return {
		location: "this plugin's data.json on this device",
		get: () => fallback.read() || null,
		set: (key) => fallback.write(key),
		clear: () => fallback.write(''),
	};
}
