import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { Editor, MarkdownView, Notice, TFile } from 'obsidian';
import { askReplacement, editorView, type Detected } from './ask';
import { findNearest } from './parse';
import type InlineAskPlugin from './main';

// `???question???` jobs: mark the span as pending with a CodeMirror decoration (the file is never touched while
// waiting), ask in the background, then find the exact original text again and replace it.

interface Job {
	id: number;
	file: TFile;
	/** The full original span, e.g. "???question???". */
	original: string;
	/** Last known offset, used to pick the right occurrence if the text appears more than once. */
	hint: number;
}

const addPending = StateEffect.define<{ id: number; from: number; to: number }>();
const removePending = StateEffect.define<number>();

class HourglassWidget extends WidgetType {
	toDOM(): HTMLElement {
		return createSpan({ cls: 'inline-ask-hourglass', text: ' ⏳', attr: { 'aria-label': 'Answering in the background' } });
	}
	eq(): boolean {
		return true;
	}
}

function pendingDecorations(id: number, from: number, to: number) {
	return [
		Decoration.mark({ class: 'inline-ask-pending', jobId: id }).range(from, to),
		Decoration.widget({ widget: new HourglassWidget(), side: 1, jobId: id }).range(to),
	];
}

export const pendingField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(addPending)) {
				deco = deco.update({ add: pendingDecorations(e.value.id, e.value.from, e.value.to), sort: true });
			} else if (e.is(removePending)) {
				const id = e.value;
				deco = deco.update({ filter: (_f, _t, d) => (d.spec as { jobId?: number }).jobId !== id });
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

function markRange(view: EditorView, id: number): { from: number; to: number } | null {
	let found: { from: number; to: number } | null = null;
	view.state.field(pendingField, false)?.between(0, view.state.doc.length, (from, to, d) => {
		if ((d.spec as { jobId?: number }).jobId === id && from < to) {
			found = { from, to };
			return false;
		}
		return undefined;
	});
	return found;
}

export class JobManager {
	private jobs = new Map<number, Job>();
	private lastTypedId = -1;
	private nextId = 1;
	private unloaded = false;

	constructor(private plugin: InlineAskPlugin) {}

	extension(): Extension {
		return pendingField;
	}

	start(editor: Editor, file: TFile, found: Detected): void {
		// onTrigger can run several times for the same keystroke; one request per typed marker.
		if (found.typedId === this.lastTypedId) return;
		this.lastTypedId = found.typedId;

		const view = editorView(editor);
		const doc = editor.getValue();
		const job: Job = { id: this.nextId++, file, original: doc.slice(found.from, found.to), hint: found.from };
		this.jobs.set(job.id, job);
		view?.dispatch({ effects: addPending.of({ id: job.id, from: found.from, to: found.to }) });

		const settings = this.plugin.settings;
		askReplacement({
			settings,
			apiKey: this.plugin.keys.get(),
			level: 'hard',
			question: found.trigger.question,
			doc,
			from: found.from,
			to: found.to,
			timeoutMs: settings.hardTimeoutMinutes * 60_000,
		})
			.then((answer) => this.finish(job, answer))
			.catch((e: unknown) => {
				if (this.unloaded) return;
				this.clearDecorations(job.id);
				this.jobs.delete(job.id);
				new Notice(`Inline Ask: ??? failed: ${e instanceof Error ? e.message : String(e)}. The question was left as is.`, 8000);
			});
	}

	/** Re-add pending marks when a note with running jobs is (re)opened in an editor. */
	refreshDecorations(): void {
		for (const { view, cm } of this.openViews()) {
			const text = cm.state.doc.toString();
			for (const job of this.jobs.values()) {
				if (view.file !== job.file || markRange(cm, job.id)) continue;
				const at = findNearest(text, job.original, job.hint);
				if (at !== -1) cm.dispatch({ effects: addPending.of({ id: job.id, from: at, to: at + job.original.length }) });
			}
		}
	}

	unload(): void {
		this.unloaded = true;
		for (const id of this.jobs.keys()) this.clearDecorations(id);
		this.jobs.clear();
	}

	private async finish(job: Job, answer: string): Promise<void> {
		if (this.unloaded) return;
		this.jobs.delete(job.id);
		const { file } = job;
		if (this.plugin.app.vault.getAbstractFileByPath(file.path) !== file) {
			this.clearDecorations(job.id);
			new Notice('Inline Ask: the note was deleted, so the ??? answer was discarded.');
			return;
		}

		// Prefer an open editor of the note (its buffer may be newer than the file on disk).
		const views = this.openViews().filter((v) => v.view.file === file);
		let replaced = false;
		if (views.length) {
			const withMark = views.find((v) => markRange(v.cm, job.id)) ?? views[0]!;
			const cm = withMark.cm;
			const mark = markRange(cm, job.id);
			const text = cm.state.doc.toString();
			const at =
				mark && text.slice(mark.from, mark.to) === job.original
					? mark.from
					: findNearest(text, job.original, mark?.from ?? job.hint);
			if (at !== -1) {
				cm.dispatch({
					changes: { from: at, to: at + job.original.length, insert: answer },
					effects: removePending.of(job.id),
					userEvent: 'input.inline-ask',
				});
				replaced = true;
			}
		} else {
			// Note not open: atomic edit of the file itself. Only this note is ever written.
			await this.plugin.app.vault.process(file, (data) => {
				const at = findNearest(data, job.original, job.hint);
				if (at === -1) return data;
				replaced = true;
				return data.slice(0, at) + answer + data.slice(at + job.original.length);
			});
		}
		this.clearDecorations(job.id);
		if (!replaced) {
			new Notice('Inline Ask: the ??? question was edited or deleted, so the answer was discarded.', 8000);
		}
	}

	private clearDecorations(id: number): void {
		for (const { cm } of this.openViews()) {
			if (markRange(cm, id) || hasWidget(cm, id)) cm.dispatch({ effects: removePending.of(id) });
		}
	}

	private openViews(): { view: MarkdownView; cm: EditorView }[] {
		const out: { view: MarkdownView; cm: EditorView }[] = [];
		for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const cm = editorView(view.editor);
			if (cm) out.push({ view, cm });
		}
		return out;
	}
}

function hasWidget(view: EditorView, id: number): boolean {
	let found = false;
	view.state.field(pendingField, false)?.between(0, view.state.doc.length, (_f, _t, d) => {
		if ((d.spec as { jobId?: number }).jobId === id) {
			found = true;
			return false;
		}
		return undefined;
	});
	return found;
}
