import type { EditorView } from '@codemirror/view';
import type { Editor, EditorPosition } from 'obsidian';
import { extractContext } from './context';
import { complete, OpenRouterError } from './openrouter';
import { parseAlternatives } from './parse';
import { systemPrompt, userPrompt } from './prompts';
import type { InlineAskSettings } from './settings';
import { findTrigger, isLineInBlock, type Level, type Trigger } from './trigger';
import { typedField } from './typed';

export const DROPDOWN_TIMEOUT_MS = 60_000;

export interface Detected {
	trigger: Trigger;
	typedId: number;
	/** Document offsets of the whole `?question?` span. */
	from: number;
	to: number;
}

export function editorView(editor: Editor): EditorView | undefined {
	return (editor as unknown as { cm?: EditorView }).cm;
}

/** Is there a trigger whose closing marker was just typed at the cursor? */
export function detect(editor: Editor, cursor: EditorPosition): Detected | null {
	const typed = editorView(editor)?.state.field(typedField, false);
	if (!typed || typed.pos !== editor.posToOffset(cursor)) return null;
	const trigger = findTrigger(editor.getLine(cursor.line), cursor.ch);
	if (!trigger) return null;
	if (isLineInBlock((n) => editor.getLine(n), cursor.line)) return null;
	const lineStart = editor.posToOffset({ line: cursor.line, ch: 0 });
	return { trigger, typedId: typed.id, from: lineStart + trigger.start, to: lineStart + trigger.end };
}

export interface AskInput {
	settings: InlineAskSettings;
	apiKey: string | null;
	level: Level;
	question: string;
	doc: string;
	from: number;
	to: number;
	timeoutMs: number;
}

async function ask(input: AskInput): Promise<string> {
	if (!input.apiKey) throw new OpenRouterError('No OpenRouter API key set (Settings → Inline Ask)');
	const level = input.settings.levels[input.level];
	const ctx = extractContext(input.doc, input.from, input.to, input.settings.contextWords);
	return complete({
		apiKey: input.apiKey,
		model: level.model,
		effort: level.effort,
		system: systemPrompt(input.level, input.settings.alternatives),
		user: userPrompt(input.question, ctx),
		json: input.level !== 'hard',
		timeoutMs: input.timeoutMs,
	});
}

export async function askAlternatives(input: AskInput): Promise<string[]> {
	return parseAlternatives(await ask(input), input.settings.alternatives);
}

export async function askReplacement(input: AskInput): Promise<string> {
	return (await ask(input)).trim();
}
