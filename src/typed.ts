import { StateField } from '@codemirror/state';

// Remembers "the user just typed a `?` at this position". Triggers only fire right after typing the closing
// marker, so moving the cursor back over an existing `?q?` (or pasting one) never sends a request.

export interface TypedQuestionMark {
	/** Unique per typing event; used to send at most one request per trigger. */
	id: number;
	/** Document offset just after the typed `?`. */
	pos: number;
}

let counter = 0;

export const typedField = StateField.define<TypedQuestionMark | null>({
	create: () => null,
	update(value, tr) {
		if (tr.docChanged && tr.isUserEvent('input.type')) {
			let pos = -1;
			let endsWithMark = false;
			tr.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
				pos = toB;
				endsWithMark = inserted.toString().endsWith('?');
			});
			return endsWithMark ? { id: ++counter, pos } : null;
		}
		if (tr.docChanged) return null;
		if (tr.selection) {
			const sel = tr.selection.main;
			return value && sel.empty && sel.head === value.pos ? value : null;
		}
		return value;
	},
});
