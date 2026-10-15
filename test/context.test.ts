import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractContext } from '../src/context.ts';

const span = (doc: string, q: string) => {
	const from = doc.indexOf(q);
	return [from, from + q.length] as const;
};

test('words before and after', () => {
	const doc = 'one two three four ?q? five six seven';
	const [a, b] = span(doc, '?q?');
	assert.deepEqual(extractContext(doc, a, b, 2), { before: 'three four', after: 'five six' });
	assert.deepEqual(extractContext(doc, a, b, 10), { before: 'one two three four', after: 'five six seven' });
});

test('0 words disables context', () => {
	const doc = 'a b ?q? c d';
	const [a, b] = span(doc, '?q?');
	assert.deepEqual(extractContext(doc, a, b, 0), { before: '', after: '' });
});

test('frontmatter is never sent', () => {
	const doc = '---\nsecret: yes\n---\nIntro ?q? end';
	const [a, b] = span(doc, '?q?');
	const ctx = extractContext(doc, a, b, 50);
	assert.equal(ctx.before, 'Intro');
	assert.equal(ctx.after, 'end');
});

test('spans lines', () => {
	const doc = 'line one\nline two ?q?\nnext line here';
	const [a, b] = span(doc, '?q?');
	assert.deepEqual(extractContext(doc, a, b, 3), { before: 'one\nline two', after: 'next line here' });
});
