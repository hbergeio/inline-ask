import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTrigger, isLineInBlock } from '../src/trigger.ts';

/** Trigger with the cursor at the end of `line` (as if the last `?` was just typed). */
const at = (line: string) => findTrigger(line, line.length);

test('basic levels', () => {
	assert.deepEqual(at('?whats 2+2?'), { level: 'easy', start: 0, end: 11, question: 'whats 2+2' });
	assert.equal(at('So ??capital of France??')?.level, 'medium');
	assert.equal(at('So ??capital of France??')?.start, 3);
	assert.equal(at('???explain monads???')?.level, 'hard');
	assert.equal(at('???explain monads???')?.question, 'explain monads');
});

test('opening boundary: start, space or opening punctuation', () => {
	assert.equal(at('(?what?')?.question, 'what');
	assert.equal(at('"?what?')?.question, 'what');
	assert.equal(at('a ?what?')?.question, 'what');
	assert.equal(at('x?what?'), null);
	assert.equal(at('2?what?'), null);
});

test('normal prose does not trigger', () => {
	assert.equal(at('Really? Yes?'), null);
	assert.equal(at('Is it? Yes it is?'), null);
	assert.equal(at('What?'), null);
	assert.equal(at('? Yes?'), null);
	assert.equal(at('hmm ?'), null);
	assert.equal(at('Why?? Because??'), null);
	assert.equal(at('Really?!?'), null);
});

test('opening must be followed by a non-space, non-? character', () => {
	assert.equal(at('? what?'), null);
	assert.equal(at('?? what??'), null);
});

test('closing must follow a non-space character', () => {
	assert.equal(at('?what ?'), null);
	assert.equal(at('??what ??'), null);
});

test('mismatched runs never trigger', () => {
	assert.equal(at('??what?'), null);
	assert.equal(at('?what??'), null);
	assert.equal(at('???what??'), null);
	assert.equal(at('??what???'), null);
});

test('runs of 4+ never trigger', () => {
	assert.equal(at('????what????'), null);
	assert.equal(at('?what????'), null);
});

test('closing run must be maximal: no trigger in the middle of a run', () => {
	// cursor after the first closing ? of "??", with another ? after the cursor
	assert.equal(findTrigger('??what??', 7), null);
});

test('nested runs: inner and outer', () => {
	assert.equal(at('??a ?b?')?.question, 'b');
	assert.equal(at('??a ?b? c??')?.question, 'a ?b? c');
	assert.equal(at('?is it x? or y?')?.question, 'is it x? or y');
});

test('cursor not at end of line', () => {
	const line = 'say ?hi? and more';
	assert.equal(findTrigger(line, 8)?.question, 'hi');
	assert.equal(findTrigger(line, 9), null);
});

test('escaped \\? is a literal question mark', () => {
	assert.equal(at('\\?what\\?'), null);
	assert.equal(at('\\?what?'), null);
	assert.equal(at('?what\\?'), null);
	assert.equal(at('?is a\\?b ok?')?.question, 'is a?b ok');
	// an escaped backslash does not escape the ?
	assert.equal(at('\\\\ ?what?')?.question, 'what');
});

test('question length 1-500', () => {
	assert.equal(at('?a?')?.question, 'a');
	assert.equal(at(`?${'x'.repeat(500)}?`)?.question.length, 500);
	assert.equal(at(`?${'x'.repeat(501)}?`), null);
});

test('URLs and query strings', () => {
	assert.equal(at('see https://example.com/page?a=1&b=?'), null);
	assert.equal(at('see https://example.com/?a=1?'), null);
	assert.equal(at('see https://x.io/ ?q?')?.question, 'q');
	assert.equal(at('www.example.com/?x=1?'), null);
	assert.equal(at('<https://a.b/?c=d?>'), null);
});

test('inline code', () => {
	assert.equal(at('use `?a?'), null); // unclosed code span
	assert.equal(at('use `x ?a?'), null);
	assert.equal(at('use `x` ?a?')?.question, 'a');
	assert.equal(at('``a ` ?b?'), null);
});

test('inline math', () => {
	// an unmatched $ (currency) is not math
	assert.equal(at('$5 and ?how much?')?.question, 'how much');
	assert.equal(at('costs $5 or $ ?more?')?.question, 'more');
	// inside matched $...$ or $$...$$
	assert.equal(findTrigger('$a ?b?$', 6), null);
	assert.equal(findTrigger('$$a ?b?$$', 7), null);
	assert.equal(at('$x$ then ?q?')?.question, 'q');
	// escaped dollar does not open math
	assert.equal(findTrigger('\\$a ?b?$', 7)?.question, 'b');
});

test('while typing: closing delimiters not typed yet', () => {
	assert.equal(at('[label](?x?'), null);
	assert.equal(at('[[?note?'), null);
	assert.equal(at('[[note|?alias?'), null);
	assert.equal(at('$a ?b?'), null);
	assert.equal(at('$\\frac ?b?'), null);
	assert.equal(at('$5 ?b?')?.question, 'b');
	assert.equal(at('[[note]] ?q?')?.question, 'q');
	assert.equal(at('[a](b) ?q?')?.question, 'q');
});

test('link targets', () => {
	assert.equal(findTrigger('[text](?a?)', 10), null);
	assert.equal(findTrigger('[[?note?]]', 8), null);
	assert.equal(findTrigger('[[note|?alias?]]', 14), null);
	assert.equal(at('[?label?')?.question, 'label');
});

test('comments', () => {
	assert.equal(at('%% ?todo?'), null);
});

// ---------------------------------------------------------------------------

const doc = (text: string) => {
	const lines = text.split('\n');
	return (n: number) => lines[n] ?? '';
};

test('frontmatter', () => {
	const d = doc('---\ntitle: ?x?\n---\nbody ?q?');
	assert.equal(isLineInBlock(d, 0), true);
	assert.equal(isLineInBlock(d, 1), true);
	assert.equal(isLineInBlock(d, 2), true);
	assert.equal(isLineInBlock(d, 3), false);
	assert.equal(isLineInBlock(doc('---\nunclosed ?x?'), 1), true);
	// --- not on the first line is a horizontal rule, not frontmatter
	assert.equal(isLineInBlock(doc('a\n---\nb'), 2), false);
});

test('fenced code blocks', () => {
	const d = doc('text\n```js\nconst a = x ?y?\n```\nafter');
	assert.equal(isLineInBlock(d, 0), false);
	assert.equal(isLineInBlock(d, 1), true);
	assert.equal(isLineInBlock(d, 2), true);
	assert.equal(isLineInBlock(d, 3), true);
	assert.equal(isLineInBlock(d, 4), false);
	assert.equal(isLineInBlock(doc('~~~~\n```\nx\n~~~~\ny'), 2), true);
	assert.equal(isLineInBlock(doc('~~~~\n```\nx\n~~~~\ny'), 4), false);
	assert.equal(isLineInBlock(doc('> ```\n> code\n> ```\nout'), 1), true);
	assert.equal(isLineInBlock(doc('```\nunclosed'), 1), true);
});

test('math blocks', () => {
	const d = doc('$$\nx = ?y?\n$$\nafter');
	assert.equal(isLineInBlock(d, 1), true);
	assert.equal(isLineInBlock(d, 3), false);
	assert.equal(isLineInBlock(doc('$$x$$\nafter'), 1), false);
	assert.equal(isLineInBlock(doc('\\$$ not math\nafter'), 1), false);
});
