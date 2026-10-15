import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

// Pending `???` decorations: the question is dimmed and a ⏳ sits right after it while the answer is fetched.
// Decorations only, so the file is never touched while waiting.

export const addPending = StateEffect.define<{ id: number; from: number; to: number }>();
export const removePending = StateEffect.define<number>();

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
		// side -1: the widget belongs to the text before it, so text typed after the closing ??? goes after the ⏳
		// instead of carrying it along (side 1 made the ⏳ follow the cursor).
		Decoration.widget({ widget: new HourglassWidget(), side: -1, jobId: id }).range(to),
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

function jobRanges(state: EditorState, id: number): { from: number; to: number; widget: boolean }[] {
	const out: { from: number; to: number; widget: boolean }[] = [];
	state.field(pendingField, false)?.between(0, state.doc.length, (from, to, d) => {
		if ((d.spec as { jobId?: number }).jobId === id) out.push({ from, to, widget: from === to });
	});
	return out;
}

/** The dimmed question span of a job, if it still exists. */
export function markRange(state: EditorState, id: number): { from: number; to: number } | null {
	const mark = jobRanges(state, id).find((r) => !r.widget);
	return mark ? { from: mark.from, to: mark.to } : null;
}

/** Position of a job's ⏳ widget. */
export function hourglassPos(state: EditorState, id: number): number | null {
	return jobRanges(state, id).find((r) => r.widget)?.from ?? null;
}

/** Any decoration (mark or ⏳) left for this job. */
export function hasPending(state: EditorState, id: number): boolean {
	return jobRanges(state, id).length > 0;
}
