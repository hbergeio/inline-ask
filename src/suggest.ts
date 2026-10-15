import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { askAlternatives, detect, DROPDOWN_TIMEOUT_MS } from './ask';
import type InlineAskPlugin from './main';
import type { Level } from './trigger';

type Row = { kind: 'thinking'; level: Level } | { kind: 'answer'; text: string } | { kind: 'error'; message: string };

interface Pending {
	typedId: number;
	level: Level;
}

/** Dropdown for `?question?` and `??question??`, built on Obsidian's EditorSuggest (like the `[[` suggester). */
export class AskSuggest extends EditorSuggest<Row> {
	/** Results per typing event, so re-renders never send a second request for the same trigger. */
	private requests = new Map<number, Row[]>();
	private current: Pending | null = null;
	private dismissed = -1;

	constructor(private plugin: InlineAskPlugin) {
		super(plugin.app);
		this.setInstructions([
			{ command: '↑↓', purpose: 'choose' },
			{ command: '↵', purpose: 'replace question' },
			{ command: 'esc', purpose: 'dismiss' },
		]);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const found = detect(editor, cursor);
		if (!found || !file) return null;
		const { trigger } = found;
		if (!this.plugin.settings.levels[trigger.level].enabled) return null;

		if (trigger.level === 'hard') {
			this.plugin.jobs.start(editor, file, found);
			return null;
		}
		if (found.typedId === this.dismissed) return null;

		this.current = { typedId: found.typedId, level: trigger.level };
		return {
			start: { line: cursor.line, ch: trigger.start },
			end: { line: cursor.line, ch: trigger.end },
			query: trigger.question,
		};
	}

	getSuggestions(context: EditorSuggestContext): Row[] {
		const pending = this.current;
		if (!pending) return [];
		const cached = this.requests.get(pending.typedId);
		if (cached) return cached;

		const thinking: Row[] = [{ kind: 'thinking', level: pending.level }];
		this.requests.set(pending.typedId, thinking);
		this.prune();

		const { editor } = context;
		void askAlternatives({
			settings: this.plugin.settings,
			apiKey: this.plugin.keys.get(),
			level: pending.level,
			question: context.query,
			doc: editor.getValue(),
			from: editor.posToOffset(context.start),
			to: editor.posToOffset(context.end),
			timeoutMs: DROPDOWN_TIMEOUT_MS,
		})
			.then((answers): Row[] => answers.map((text) => ({ kind: 'answer', text })))
			.catch((e: unknown): Row[] => [{ kind: 'error', message: e instanceof Error ? e.message : String(e) }])
			.then((rows) => {
				this.requests.set(pending.typedId, rows);
				// Still showing this trigger? Swap the thinking row for the results.
				if (this.isOpenFor(pending.typedId)) this.show(rows);
			});
		return thinking;
	}

	renderSuggestion(row: Row, el: HTMLElement): void {
		el.addClass('inline-ask-row');
		if (row.kind === 'thinking') {
			el.addClass('inline-ask-thinking');
			el.setText(row.level === 'medium' ? 'Thinking… (may take a few seconds)' : 'Thinking…');
		} else if (row.kind === 'error') {
			el.addClass('inline-ask-error');
			el.setText(row.message);
		} else {
			el.setText(row.text);
		}
	}

	selectSuggestion(row: Row): void {
		const ctx = this.context;
		if (row.kind === 'answer' && ctx) {
			ctx.editor.replaceRange(row.text, ctx.start, ctx.end);
			const end = ctx.editor.offsetToPos(ctx.editor.posToOffset(ctx.start) + row.text.length);
			ctx.editor.setCursor(end);
		}
		this.close();
	}

	close(): void {
		// Esc (or any close) dismisses this trigger for good; typing the marker again starts a new one.
		if (this.current) this.dismissed = this.current.typedId;
		this.current = null;
		super.close();
	}

	private isOpenFor(typedId: number): boolean {
		const open = (this as unknown as { isOpen?: boolean }).isOpen;
		return !!this.context && this.current?.typedId === typedId && open !== false;
	}

	/** EditorSuggest has no public "refresh"; showSuggestions is the internal method trigger() uses. */
	private show(rows: Row[]): void {
		const self = this as unknown as { showSuggestions?: (r: Row[]) => void };
		if (typeof self.showSuggestions === 'function') self.showSuggestions(rows);
	}

	private prune(): void {
		while (this.requests.size > 50) {
			const oldest = this.requests.keys().next().value;
			if (oldest === undefined) break;
			this.requests.delete(oldest);
		}
	}
}
