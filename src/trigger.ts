// Pure trigger parsing. No Obsidian imports so it can be unit-tested with plain Node.

export type Level = 'easy' | 'medium' | 'hard';

export const LEVEL_BY_COUNT: Record<number, Level> = { 1: 'easy', 2: 'medium', 3: 'hard' };

export const MAX_QUESTION_LENGTH = 500;

export interface Trigger {
	level: Level;
	/** Offset in the line of the first opening `?`. */
	start: number;
	/** Offset in the line just after the last closing `?`. */
	end: number;
	question: string;
}

/** Characters allowed directly before the opening run (besides start of line and whitespace). */
const OPENING_PUNCTUATION = '([{"\'“‘«*_~';

function isEscaped(text: string, i: number): boolean {
	let backslashes = 0;
	for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
	return backslashes % 2 === 1;
}

/** An unescaped `?` at index i. */
function isMarker(text: string, i: number): boolean {
	return text[i] === '?' && !isEscaped(text, i);
}

function isSpace(ch: string | undefined): boolean {
	return ch === undefined || /\s/.test(ch);
}

/**
 * Find a trigger whose closing run ends exactly at `cursor` in `line`.
 * Returns null for normal prose, mismatched runs, protected regions etc.
 */
export function findTrigger(line: string, cursor: number): Trigger | null {
	// Closing run: maximal run of unescaped `?` ending at the cursor.
	if (!isMarker(line, cursor - 1) || line[cursor] === '?') return null;
	let closeStart = cursor - 1;
	while (closeStart > 0 && isMarker(line, closeStart - 1)) closeStart--;
	const count = cursor - closeStart;
	const level = LEVEL_BY_COUNT[count];
	if (!level) return null;
	// Closing run must directly follow a non-space character.
	if (closeStart === 0 || isSpace(line[closeStart - 1])) return null;

	// Search backwards for a matching opening run of exactly `count` markers.
	let i = closeStart - 1;
	while (i >= 0) {
		if (!isMarker(line, i)) {
			i--;
			continue;
		}
		let runStart = i;
		while (runStart > 0 && isMarker(line, runStart - 1)) runStart--;
		const runLength = i - runStart + 1;
		const before = runStart === 0 ? undefined : line[runStart - 1];
		const after = line[i + 1];
		const validBoundary = before === undefined || isSpace(before) || OPENING_PUNCTUATION.includes(before);
		const validStart = after !== undefined && !isSpace(after) && after !== '?';
		if (runLength === count && validBoundary && validStart) {
			const question = line.slice(i + 1, closeStart);
			if (question.length < 1 || question.length > MAX_QUESTION_LENGTH) return null;
			const trigger: Trigger = { level, start: runStart, end: cursor, question: unescape(question) };
			if (overlapsProtected(line, trigger.start, trigger.end)) return null;
			return trigger;
		}
		i = runStart - 1;
		if (closeStart - i > MAX_QUESTION_LENGTH + count) return null;
	}
	return null;
}

function unescape(question: string): string {
	return question.replace(/\\\?/g, '?');
}

// ---------------------------------------------------------------------------
// Protected regions on a single line: inline code, inline math, links, URLs.

type Range = [number, number];

export function protectedRanges(line: string): Range[] {
	const ranges: Range[] = [];

	// Inline code: backtick runs closed by a run of the same length. Unclosed runs protect to end of line,
	// since the user is probably still typing the code span.
	for (let i = 0; i < line.length; ) {
		if (line[i] !== '`' || isEscaped(line, i)) {
			i++;
			continue;
		}
		let j = i;
		while (line[j] === '`') j++;
		const ticks = j - i;
		let close = -1;
		for (let k = j; k < line.length; ) {
			if (line[k] !== '`') {
				k++;
				continue;
			}
			let m = k;
			while (line[m] === '`') m++;
			if (m - k === ticks) {
				close = m;
				break;
			}
			k = m;
		}
		const end = close === -1 ? line.length : close;
		ranges.push([i, end]);
		i = end;
	}

	const inCode = (pos: number) => ranges.some(([a, b]) => pos >= a && pos < b);
	const add = (re: RegExp) => {
		for (const m of line.matchAll(re)) {
			const start = m.index;
			if (!inCode(start)) ranges.push([start, start + m[0].length]);
		}
	};

	// Inline math $...$ (not $$), opening followed by and closing preceded by non-space.
	// (Scanned by hand: regex lookbehind is unsupported on older iOS.)
	const single = (i: number) =>
		line[i] === '$' && !isEscaped(line, i) && line[i - 1] !== '$' && line[i + 1] !== '$';
	for (let i = 0; i < line.length; i++) {
		if (!single(i) || inCode(i) || isSpace(line[i + 1])) continue;
		let closed = false;
		for (let j = i + 1; j < line.length; j++) {
			if (single(j) && !isSpace(line[j - 1])) {
				ranges.push([i, j + 1]);
				i = j;
				closed = true;
				break;
			}
		}
		// While typing `$a ?b?$` the closing `$` doesn't exist yet. An unclosed `$` directly followed by a
		// letter or backslash is treated as math to end of line; `$5` (currency) is not.
		if (!closed && /[a-zA-Z\\{]/.test(line[i + 1] ?? '')) {
			ranges.push([i, line.length]);
			break;
		}
	}
	// Display math on one line: $$...$$
	add(/\$\$.*?\$\$/g);
	// Wikilinks and embeds: [[target|alias]]. Unclosed ones (still being typed) protect to end of line.
	add(/!?\[\[(?:[^\]]*\]\]|.*$)/g);
	// Markdown link / image destinations: ](target), also unclosed.
	add(/\]\((?:[^)]*\)|.*$)/g);
	// Autolinks <...>
	add(/<[a-z][a-z0-9+.-]*:[^>\s]*>/gi);
	// Bare URLs with a scheme, or www.
	add(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi);
	add(/\bwww\.\S+/gi);
	// Obsidian comments %%...%%
	add(/%%.*?(?:%%|$)/g);

	return ranges;
}

export function overlapsProtected(line: string, start: number, end: number): boolean {
	return protectedRanges(line).some(([a, b]) => start < b && end > a);
}

// ---------------------------------------------------------------------------
// Block-level state: is a given line inside frontmatter, a fenced code block or a math block?

/**
 * Returns true if `lineNo` is inside (or is a delimiter of) frontmatter, a code fence or a `$$` math block.
 * `getLine` reads line n of the document.
 */
export function isLineInBlock(getLine: (n: number) => string, lineNo: number): boolean {
	let fence: { char: string; length: number } | null = null;
	let math = false;

	for (let n = 0; n <= lineNo; n++) {
		const text = getLine(n);
		const isTarget = n === lineNo;

		if (n === 0 && /^---\s*$/.test(text)) {
			// Frontmatter: until the closing --- / ...
			let end = -1;
			for (let k = 1; k <= lineNo; k++) {
				if (/^(---|\.\.\.)\s*$/.test(getLine(k))) {
					end = k;
					break;
				}
			}
			if (end === -1) return true; // still inside (or unclosed)
			if (lineNo <= end) return true;
			n = end;
			continue;
		}

		// Strip blockquote markers and indentation for fence/math detection.
		const stripped = text.replace(/^\s*(?:>\s?)*\s*/, '');

		if (fence) {
			const m = stripped.match(/^(`{3,}|~{3,})\s*$/);
			if (m && m[1]![0] === fence.char && m[1]!.length >= fence.length) {
				fence = null;
				if (isTarget) return true;
				continue;
			}
			if (isTarget) return true;
			continue;
		}

		const open = stripped.match(/^(`{3,}|~{3,})/);
		if (open && !math) {
			fence = { char: open[1]![0]!, length: open[1]!.length };
			if (isTarget) return true;
			continue;
		}

		// $$ toggles math mode; a line with an even number of $$ (e.g. $$x$$) is self-contained.
		const dollars = [...text.matchAll(/\$\$/g)].filter((m) => !isEscaped(text, m.index)).length;
		if (dollars % 2 === 1) {
			if (isTarget) return true;
			math = !math;
			continue;
		}
		if (isTarget) return math;
	}
	return false;
}
