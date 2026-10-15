import { App, Notice, PluginSettingTab, Setting, SuggestModal } from 'obsidian';
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

export class InlineAskSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: InlineAskPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		// --- API key -------------------------------------------------------------------------------------------
		new Setting(containerEl).setName('OpenRouter').setHeading();
		const keys = this.plugin.keys;
		const hasKey = keys.get() !== null;
		let draft = '';
		new Setting(containerEl)
			.setName('API key')
			.setDesc(
				(hasKey ? 'A key is set' : 'No key set') +
					`. Stored in ${keys.location}; it is never synced or written to a note.`,
			)
			.addText((text) => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.setPlaceholder(hasKey ? 'Paste a new key to replace' : 'sk-or-…').onChange((v) => (draft = v.trim()));
			})
			.addButton((b) =>
				b
					.setButtonText(hasKey ? 'Replace' : 'Save')
					.setCta()
					.onClick(async () => {
						if (!draft) {
							new Notice('Paste a key first');
							return;
						}
						await keys.set(draft);
						new Notice('Inline Ask: API key saved');
						this.display();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText('Clear')
					.setDisabled(!hasKey)
					.onClick(async () => {
						await keys.clear();
						new Notice('Inline Ask: API key cleared');
						this.display();
					}),
			);

		const test = new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Checks the key and sends a one-word test request to the easy model.');
		test.addButton((b) =>
			b.setButtonText('Test').onClick(async () => {
				const key = keys.get();
				if (!key) {
					test.setDesc('No key set.');
					return;
				}
				b.setDisabled(true);
				test.setDesc('Testing…');
				try {
					await checkKey(key);
					const model = settings.levels.easy.model;
					const reply = await complete({
						apiKey: key,
						model,
						effort: settings.levels.easy.effort,
						system: 'Reply with exactly: OK',
						user: 'Test',
						json: false,
						timeoutMs: 30_000,
					});
					test.setDesc(`Connected. Key is valid; ${model} replied "${reply.trim().slice(0, 40)}".`);
				} catch (e) {
					test.setDesc(`Failed: ${e instanceof Error ? e.message : String(e)}`);
				} finally {
					b.setDisabled(false);
				}
			}),
		);

		// --- Levels --------------------------------------------------------------------------------------------
		for (const level of ['easy', 'medium', 'hard'] as Level[]) {
			const ls = settings.levels[level];
			const label = LEVEL_LABELS[level];
			new Setting(containerEl).setName(`${label.name}: ${label.syntax}`).setHeading();
			new Setting(containerEl).setName('Enabled').addToggle((t) =>
				t.setValue(ls.enabled).onChange(async (v) => {
					ls.enabled = v;
					await save();
				}),
			);
			const modelSetting = new Setting(containerEl).setName('Model').setDesc(ls.model);
			modelSetting.addButton((b) =>
				b.setButtonText('Choose…').onClick(() => {
					new ModelPickerModal(this.app, async (m) => {
						ls.model = m.id;
						modelSetting.setDesc(m.id);
						await save();
					}).open();
				}),
			);
			new Setting(containerEl)
				.setName('Reasoning effort')
				.setDesc('Sent as reasoning.effort; ignored by models without reasoning.')
				.addDropdown((d) =>
					d
						.addOptions(EFFORTS)
						.setValue(ls.effort)
						.onChange(async (v) => {
							ls.effort = v as Effort;
							await save();
						}),
				);
		}

		// --- General -------------------------------------------------------------------------------------------
		new Setting(containerEl).setName('Behaviour').setHeading();
		new Setting(containerEl)
			.setName('Alternatives')
			.setDesc('How many answers the dropdown shows (for ? and ??).')
			.addSlider((s) =>
				s
					.setLimits(2, 5, 1)
					.setValue(settings.alternatives)
					.onChange(async (v) => {
						settings.alternatives = v;
						await save();
					}),
			);
		new Setting(containerEl)
			.setName('Context words')
			.setDesc(
				'Words of the note before and after the question that are sent along, so answers fit the sentence. 0 = send only the question.',
			)
			.addText((t) =>
				t.setValue(String(settings.contextWords)).onChange(async (v) => {
					if (v.trim() === '') return; // mid-edit: an empty field is not 0
					const n = Number(v);
					if (!Number.isInteger(n) || n < 0 || n > 500) return;
					settings.contextWords = n;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName('Background answer timeout (minutes)')
			.setDesc('A ??? answer that takes longer than this is abandoned and the question is left as is.')
			.addText((t) =>
				t.setValue(String(settings.hardTimeoutMinutes)).onChange(async (v) => {
					if (v.trim() === '') return; // mid-edit: an empty field is not 0
					const n = Number(v);
					if (!(n >= 0.5 && n <= 60)) return;
					settings.hardTimeoutMinutes = n;
					await save();
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
		this.setPlaceholder('Search OpenRouter models…');
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
