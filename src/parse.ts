// Pure helpers for reading model replies and locating text. No Obsidian imports (unit-tested).

function tryJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Parse {"alternatives": [...]} from a model reply, tolerating code fences and surrounding text. */
export function parseAlternatives(text: string, max: number): string[] {
	const candidates = [text, text.replace(/^```(?:json)?\s*|\s*```$/g, ''), text.match(/\{[\s\S]*\}/)?.[0] ?? ''];
	for (const c of candidates) {
		const parsed = tryJson(c.trim()) as { alternatives?: unknown } | unknown[] | undefined;
		const list = Array.isArray(parsed) ? parsed : parsed?.alternatives;
		if (Array.isArray(list)) {
			const clean = list.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
			if (clean.length) return [...new Set(clean)].slice(0, max);
		}
	}
	// Last resort: one alternative per non-empty line, stripped of list markers.
	const lines = text
		.split('\n')
		.map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
		.filter(Boolean);
	if (lines.length) return [...new Set(lines)].slice(0, max);
	throw new Error('Could not read the model answer');
}

/** Offset of the occurrence of `needle` in `text` nearest to `hint`, or -1. */
export function findNearest(text: string, needle: string, hint: number): number {
	let best = -1;
	for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
		if (best === -1 || Math.abs(i - hint) < Math.abs(best - hint)) best = i;
	}
	return best;
}
