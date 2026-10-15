import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { addPending, moonPos, markRange, pendingField, removePending } from '../src/pending.ts';

const Q = '???why is the sky blue???';

function pending(before: string, after = '') {
	let state = EditorState.create({ doc: before + Q + after, extensions: [pendingField] });
	const from = before.length;
	state = state.update({ effects: addPending.of({ id: 1, from, to: from + Q.length }) }).state;
	return { state, from, to: from + Q.length };
}

const type = (state: EditorState, at: number, text: string) =>
	state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } }).state;

test('moon stays after the question when the user keeps typing right after it', () => {
	let { state, from, to } = pending('Water boils at ');
	state = type(state, to, ' ');
	state = type(state, to + 1, 'and then more text');
	assert.equal(moonPos(state, 1), to);
	assert.deepEqual(markRange(state, 1), { from, to });
	assert.equal(state.sliceDoc(from, to), Q);
});

test('moon stays put with a tab or newline typed right after the question', () => {
	for (const ws of ['\t', '\n', '  ']) {
		let { state, to } = pending('x ');
		state = type(state, to, ws + 'next');
		assert.equal(moonPos(state, 1), to, JSON.stringify(ws));
	}
});

test('typing before the question moves mark and moon together', () => {
	let { state, from, to } = pending('Intro. ');
	state = type(state, 0, 'New line.\n');
	assert.deepEqual(markRange(state, 1), { from: from + 10, to: to + 10 });
	assert.equal(moonPos(state, 1), to + 10);
});

test('typing inside the question is tracked by the mark (so edits can be detected)', () => {
	let { state, from, to } = pending('A ');
	state = type(state, from + 3, 'really ');
	assert.deepEqual(markRange(state, 1), { from, to: to + 7 });
	assert.notEqual(state.sliceDoc(from, to + 7), Q);
});

test('removePending clears both decorations', () => {
	let { state } = pending('A ');
	state = state.update({ effects: removePending.of(1) }).state;
	assert.equal(markRange(state, 1), null);
	assert.equal(moonPos(state, 1), null);
});
