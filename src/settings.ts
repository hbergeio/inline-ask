import { App, Notice, PluginSettingTab, Setting, SuggestModal, type SettingDefinitionItem } from 'obsidian';
import type InlineAskPlugin from './main';
import { checkKey, complete, listModels, type Effort, type ModelInfo } from './openrouter';
import type { Level } from './trigger';

export interface LevelSettings {
	enabled: boolean;
	model: string;
	effort: Effort;
}

export interface InlineAskSettings {
	levels: Record<Level, LevelSettings>;
	/** Number of alternatives in the dropdown (2-5). */
	alternatives: number;
	/** Words of note text sent before and after the question (0 = none). */
	contextWords: number;
	/** Timeout for `???` jobs, minutes. */
	hardTimeoutMinutes: number;
}

// Defaults picked from https://openrouter.ai/api/v1/models in October 2026; change them in settings.
export const DEFAULT_SETTINGS: InlineAskSettings = {
	levels: {
		easy: { enabled: true, model: 'anthropic/claude-haiku-5.5', effort: 'none' },
		medium: { enabled: true, model: 'anthropic/claude-sonnet-5.5', effort: 'low' },
		hard: { enabled: true, model: 'anthropic/claude-opus-5.5', effort: 'high' },
	},
	alternatives: 3,
	contextWords: 30,
	hardTimeoutMinutes: 5,
};

const LEVEL_LABELS: Record<Level, { name: string; syntax: string }> = {
	easy: { name: 'Easy', syntax: '?question?' },
	medium: { name: 'Medium', syntax: '??question??' },
	hard: { name: 'Hard', syntax: '???question???' },
};

const EFFORTS: Record<Effort, string> = {
	none: 'None (no reasoning)',
	minimal: 'Minimal',
	low: 'Low',
	medium: 'Medium',
	high: 'High',
};

/** Declarative settings tab (Obsidian 1.13+), so every setting shows up in Obsidian's settings search. */
export class InlineAskSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: InlineAskPlugin,
	) {
		super(app, plugin);
	}

	// Control keys are dotted paths into the settings object, e.g. "levels.easy.model".
	getControlValue(key: string): unknown {
		let value: unknown = this.plugin.settings;
		for (const part of key.split('.')) value = (value as Record<string, unknown> | undefined)?.[part];
		return value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const parts = key.split('.');
		const last = parts.pop()!;
		let target = this.plugin.settings as unknown as Record<string, unknown>;
		for (const part of parts) target = target[part] as Record<string, unknown>;
		target[last] = value;
		await this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Connection',
				items: [
					{
						name: 'API key',
						desc: 'Your OpenRouter API key.',
						aliases: ['openrouter', 'key', 'token'],
						render: (setting) => this.renderKey(setting),
					},
					{
						name: 'Test connection',
						desc: 'Checks the key and sends a one-word test request to the easy model.',
						render: (setting) => this.renderTest(setting),
					},
				],
			},
			...(['easy', 'medium', 'hard'] as Level[]).map((level) => this.levelGroup(level)),
			{
				type: 'group',
				heading: 'Behaviour',
				items: [
					{
						name: 'Alternatives',
						desc: 'Number of answers in the dropdown.',
						control: { type: 'slider', key: 'alternatives', min: 2, max: 5, step: 1 },
					},
					{
						name: 'Context words',
						desc: 'Words of the note before and after the question that are sent along, so answers fit the sentence. Use 0 to send only the question.',
						control: {
							type: 'number',
							key: 'contextWords',
							min: 0,
							max: 500,
							step: 1,
							defaultValue: DEFAULT_SETTINGS.contextWords,
							validate: (n) => (Number.isInteger(n) && n >= 0 && n <= 500 ? undefined : 'Enter a whole number from 0 to 500.'),
						},
					},
					{
						name: 'Background answer timeout (minutes)',
						desc: 'A background answer that takes longer than this is abandoned, and the question is left as is.',
						control: {
							type: 'number',
							key: 'hardTimeoutMinutes',
							min: 0.5,
							max: 60,
							step: 'any',
							defaultValue: DEFAULT_SETTINGS.hardTimeoutMinutes,
							validate: (n) => (n >= 0.5 && n <= 60 ? undefined : 'Enter a number of minutes from 0.5 to 60.'),
						},
					},
				],
			},
		];
	}

	private levelGroup(level: Level): SettingDefinitionItem {
		const label = LEVEL_LABELS[level];
		return {
			type: 'group',
			heading: `${label.name}: ${label.syntax}`,
			items: [
				{ name: 'Enabled', control: { type: 'toggle', key: `levels.${level}.enabled` } },
				{
					name: 'Model',
					aliases: [label.name.toLowerCase(), 'openrouter'],
					render: (setting) => {
						const ls = this.plugin.settings.levels[level];
						setting.setDesc(ls.model).addButton((b) =>
							b.setButtonText('Choose…').onClick(() => {
								new ModelPickerModal(this.app, async (m) => {
									ls.model = m.id;
									setting.setDesc(m.id);
									await this.plugin.saveSettings();
								}).open();
							}),
						);
					},
				},
				{
					name: 'Reasoning effort',
					desc: 'Sent as reasoning.effort; ignored by models without reasoning.',
					control: { type: 'dropdown', key: `levels.${level}.effort`, options: EFFORTS },
				},
			],
		};
	}

	private renderKey(setting: Setting): void {
		const keys = this.plugin.keys;
		let draft = '';
		let save: HTMLButtonElement | undefined;
		let clear: HTMLButtonElement | undefined;
		const refresh = () => {
			const hasKey = keys.get() !== null;
			setting.setDesc(
				`${hasKey ? 'A key is set' : 'No key set'}. Stored in ${keys.location}; it is never synced or written to a note.`,
			);
			if (save) save.textContent = hasKey ? 'Replace' : 'Save';
			if (clear) clear.disabled = !hasKey;
		};
		setting
			.addText((text) => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.setPlaceholder('Paste key').onChange((v) => (draft = v.trim()));
			})
			.addButton((b) => {
				save = b.buttonEl;
				b.setCta().onClick(async () => {
					if (!draft) {
						new Notice('Paste a key first');
						return;
					}
					await keys.set(draft);
					new Notice('API key saved');
					refresh();
				});
			})
			.addButton((b) => {
				clear = b.buttonEl;
				b.setButtonText('Clear').onClick(async () => {
					await keys.clear();
					new Notice('API key cleared');
					refresh();
				});
			});
		refresh();
	}

	private renderTest(setting: Setting): void {
		setting.addButton((b) =>
			b.setButtonText('Test').onClick(async () => {
				const key = this.plugin.keys.get();
				if (!key) {
					setting.setDesc('No key set.');
					return;
				}
				b.setDisabled(true);
				setting.setDesc('Testing…');
				try {
					await checkKey(key);
					const easy = this.plugin.settings.levels.easy;
					const reply = await complete({
						apiKey: key,
						model: easy.model,
						effort: easy.effort,
						system: 'Reply with exactly: OK',
						user: 'Test',
						json: false,
						timeoutMs: 30_000,
					});
					setting.setDesc(`Connected. Key is valid; ${easy.model} replied "${reply.trim().slice(0, 40)}".`);
				} catch (e) {
					setting.setDesc(`Failed: ${e instanceof Error ? e.message : String(e)}`);
				} finally {
					b.setDisabled(false);
				}
			}),
		);
	}
}

/** Searchable picker over OpenRouter's public model list. */
class ModelPickerModal extends SuggestModal<ModelInfo> {
	constructor(
		app: App,
		private onPick: (m: ModelInfo) => void | Promise<void>,
	) {
		super(app);
		this.setPlaceholder('Search models…');
		this.emptyStateText = 'No matching models';
	}

	async getSuggestions(query: string): Promise<ModelInfo[]> {
		let models: ModelInfo[];
		try {
			models = await listModels();
		} catch (e) {
			this.emptyStateText = e instanceof Error ? e.message : 'Could not load models';
			return [];
		}
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		return models.filter((m) => {
			const hay = `${m.id} ${m.name}`.toLowerCase();
			return terms.every((t) => hay.includes(t));
		});
	}

	renderSuggestion(m: ModelInfo, el: HTMLElement): void {
		el.createDiv({ text: m.name });
		const tags = [m.structured ? 'structured output' : '', m.reasoning ? 'reasoning' : ''].filter(Boolean);
		el.createEl('small', {
			text: `${m.id} · $${m.promptPrice.toFixed(2)} in / $${m.completionPrice.toFixed(2)} out per M tokens${tags.length ? ' · ' + tags.join(', ') : ''}`,
			cls: 'inline-ask-model-meta',
		});
	}

	onChooseSuggestion(m: ModelInfo): void {
		void this.onPick(m);
	}
}
