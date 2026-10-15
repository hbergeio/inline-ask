import { Plugin } from 'obsidian';
import { JobManager } from './background';
import { createKeyStore, type KeyStore } from './secrets';
import { DEFAULT_SETTINGS, InlineAskSettingTab, type InlineAskSettings } from './settings';
import { AskSuggest } from './suggest';
import { typedField } from './typed';

interface StoredData extends Partial<InlineAskSettings> {
	/** Only used when this Obsidian version has no SecretStorage. */
	apiKey?: string;
}

export default class InlineAskPlugin extends Plugin {
	settings!: InlineAskSettings;
	keys!: KeyStore;
	jobs!: JobManager;
	private fallbackKey = '';

	async onload() {
		await this.loadSettings();
		this.keys = createKeyStore(this.app, {
			read: () => this.fallbackKey,
			write: async (key) => {
				this.fallbackKey = key;
				await this.saveSettings();
			},
		});
		this.jobs = new JobManager(this);

		this.registerEditorExtension([typedField, this.jobs.extension()]);
		this.registerEditorSuggest(new AskSuggest(this));
		this.registerEvent(this.app.workspace.on('file-open', () => this.jobs.refreshDecorations()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.jobs.refreshDecorations()));
		this.addSettingTab(new InlineAskSettingTab(this.app, this));
	}

	onunload() {
		this.jobs.unload();
	}

	async loadSettings() {
		const data = ((await this.loadData()) ?? {}) as StoredData;
		const d = DEFAULT_SETTINGS;
		this.settings = {
			...d,
			...data,
			levels: {
				easy: { ...d.levels.easy, ...data.levels?.easy },
				medium: { ...d.levels.medium, ...data.levels?.medium },
				hard: { ...d.levels.hard, ...data.levels?.hard },
			},
		};
		delete (this.settings as StoredData).apiKey;
		this.fallbackKey = data.apiKey ?? '';
	}

	async saveSettings() {
		const data: StoredData = { ...this.settings };
		if (this.fallbackKey) data.apiKey = this.fallbackKey;
		await this.saveData(data);
	}
}
