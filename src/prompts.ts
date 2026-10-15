import type { QuestionContext } from './context';
import type { Level } from './trigger';

const ALTERNATIVES_PROMPT = (count: number, level: Level) => `You answer a question the user typed inline in their note.
The answer will replace the question in the sentence, so each answer must read naturally in its place.
Return JSON only: {"alternatives": [${count} strings]}.
Rules:
- Exactly ${count} different alternatives, shortest first: the bare answer, then short phrasings (e.g. "4", "2 + 2 is 4", "it's 4").
- Each fits the surrounding text grammatically, in the language of the note.
- Plain text, ${level === 'easy' ? 'at most about 12 words' : 'at most about 30 words'}, no quotes around it, no preamble, no Markdown unless the context needs it.`;

const REPLACE_PROMPT = `You answer a question the user typed inline in their note. Your answer replaces the question in place.
Rules:
- Output only the replacement text: no preamble, no restating the question, no sign-off.
- Fit the surrounding text: same language, tone and grammar. Inside a sentence, answer as a phrase; on its own line, you may write paragraphs or lists.
- Markdown is allowed. Be accurate and as long as the question needs, no longer.`;

export function systemPrompt(level: Level, alternatives: number): string {
	return level === 'hard' ? REPLACE_PROMPT : ALTERNATIVES_PROMPT(alternatives, level);
}

export function userPrompt(question: string, ctx: QuestionContext): string {
	if (!ctx.before && !ctx.after) return `Question: ${question}`;
	return [
		'Note text around the question (the question sits at ⟦ANSWER⟧):',
		'"""',
		`${ctx.before} ⟦ANSWER⟧ ${ctx.after}`.trim(),
		'"""',
		`Question: ${question}`,
	].join('\n');
}
