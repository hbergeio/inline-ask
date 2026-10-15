// Surrounding-words extraction. Pure, unit-tested.

export interface QuestionContext {
	before: string;
	after: string;
}

/** Strip a leading YAML frontmatter block so note metadata is never sent. */
export function stripFrontmatter(text: string): { body: string; offset: number } {
	const m = text.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
	if (!m) return { body: text, offset: 0 };
	return { body: text.slice(m[0].length), offset: m[0].length };
}

/**
 * Up to `words` words before `start` and after `end` (offsets into `doc`).
 * Frontmatter is never included. `words` = 0 disables context.
 */
export function extractContext(doc: string, start: number, end: number, words: number): QuestionContext {
	if (words <= 0) return { before: '', after: '' };
	const { offset } = stripFrontmatter(doc);
	const beforeText = doc.slice(Math.min(offset, start), start);
	const afterText = doc.slice(Math.max(end, offset));
	return {
		before: lastWords(beforeText, words),
		after: firstWords(afterText, words),
	};
}

function lastWords(text: string, n: number): string {
	const starts = [...text.matchAll(/\S+/g)].map((m) => m.index);
	if (starts.length === 0) return '';
	const cut = starts[Math.max(0, starts.length - n)]!;
	return text.slice(cut).trim();
}

function firstWords(text: string, n: number): string {
	const re = /\s*\S+/g;
	let end = 0;
	for (let i = 0; i < n; i++) {
		const m = re.exec(text);
		if (!m) break;
		end = m.index + m[0].length;
	}
	return text.slice(0, end).trim();
}
