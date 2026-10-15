import { requestUrl, type RequestUrlResponse } from 'obsidian';

const API = 'https://openrouter.ai/api/v1';

export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export interface ModelInfo {
	id: string;
	name: string;
	promptPrice: number; // USD per million tokens
	completionPrice: number;
	/** Supports JSON-schema structured outputs. */
	structured: boolean;
	/** Supports response_format JSON mode (but maybe not a schema). */
	jsonMode: boolean;
	reasoning: boolean;
}

export interface CompletionRequest {
	apiKey: string;
	model: string;
	effort: Effort;
	system: string;
	user: string;
	/** Ask for {"alternatives": string[]}. */
	json: boolean;
	timeoutMs: number;
}

export class OpenRouterError extends Error {}

let modelCache: Promise<ModelInfo[]> | null = null;

/** Public model list (no key needed). Cached for the session; failures are not cached. */
export function listModels(refresh = false): Promise<ModelInfo[]> {
	if (!modelCache || refresh) {
		modelCache = fetchModels().catch((e: unknown) => {
			modelCache = null;
			throw e;
		});
	}
	return modelCache;
}

interface RawModel {
	id: string;
	name?: string;
	pricing?: { prompt?: string; completion?: string };
	supported_parameters?: string[];
}

async function fetchModels(): Promise<ModelInfo[]> {
	let res;
	try {
		res = await withTimeout(requestUrl({ url: `${API}/models`, throw: false }), 30_000);
	} catch {
		throw new OpenRouterError('Could not load models: network error');
	}
	if (res.status !== 200) throw new OpenRouterError(`Could not load models (HTTP ${res.status})`);
	const data = (res.json as { data: RawModel[] }).data;
	return data.map((m) => {
		const params = m.supported_parameters ?? [];
		return {
			id: m.id,
			name: m.name ?? m.id,
			promptPrice: Number(m.pricing?.prompt ?? 0) * 1e6,
			completionPrice: Number(m.pricing?.completion ?? 0) * 1e6,
			structured: params.includes('structured_outputs'),
			jsonMode: params.includes('response_format'),
			reasoning: params.includes('reasoning'),
		};
	});
}

async function modelInfo(id: string): Promise<ModelInfo | undefined> {
	try {
		return (await listModels()).find((m) => m.id === id);
	} catch {
		return undefined; // unknown capabilities: fall back to plain text + JSON parsing
	}
}

const ALTERNATIVES_SCHEMA = {
	type: 'json_schema',
	json_schema: {
		name: 'alternatives',
		strict: true,
		schema: {
			type: 'object',
			properties: { alternatives: { type: 'array', items: { type: 'string' } } },
			required: ['alternatives'],
			additionalProperties: false,
		},
	},
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new OpenRouterError(`Timed out after ${Math.round(ms / 1000)} s`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function headers(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'X-Title': 'Inline Ask (Obsidian)',
	};
}

function errorMessage(status: number, body: unknown): string {
	const msg = (body as { error?: { message?: string } } | undefined)?.error?.message;
	if (status === 401) return 'OpenRouter rejected the API key (401)';
	if (status === 402) return 'OpenRouter: insufficient credits (402)';
	if (status === 429) return 'OpenRouter rate limit (429), try again shortly';
	return `OpenRouter error ${status}${msg ? `: ${msg}` : ''}`;
}

function parseBody(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

async function post(apiKey: string, body: unknown, timeoutMs: number): Promise<RequestUrlResponse> {
	const call = requestUrl({
		url: `${API}/chat/completions`,
		method: 'POST',
		headers: headers(apiKey),
		body: JSON.stringify(body),
		throw: false,
	});
	try {
		return await withTimeout(call, timeoutMs);
	} catch (e) {
		if (e instanceof OpenRouterError) throw e;
		throw new OpenRouterError('Network error: could not reach OpenRouter');
	}
}

/** One chat completion. Returns the assistant text. */
export async function complete(req: CompletionRequest): Promise<string> {
	const info = await modelInfo(req.model);
	const body: Record<string, unknown> = {
		model: req.model,
		messages: [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.user },
		],
	};
	if (req.effort !== 'none' && info?.reasoning !== false) {
		body.reasoning = { effort: req.effort, exclude: true };
	}
	if (req.json && info?.structured) {
		body.response_format = ALTERNATIVES_SCHEMA;
		body.provider = { require_parameters: true };
	} else if (req.json && info?.jsonMode) {
		body.response_format = { type: 'json_object' };
	}

	const deadline = Date.now() + req.timeoutMs;
	let res = await post(req.apiKey, body, req.timeoutMs);
	// No provider can serve the JSON format for this model right now: retry once without it (the reply is
	// parsed leniently anyway).
	if (res.status === 404 && body.response_format) {
		delete body.response_format;
		delete body.provider;
		res = await post(req.apiKey, body, Math.max(1000, deadline - Date.now()));
	}
	const json = parseBody(res.text);
	if (res.status !== 200) throw new OpenRouterError(errorMessage(res.status, json));
	const choice = (json as { choices?: { message?: { content?: string } }[]; error?: { message?: string } })
		?.choices?.[0];
	const content = choice?.message?.content;
	if (typeof content !== 'string' || !content.trim()) {
		const err = (json as { error?: { message?: string } })?.error?.message;
		throw new OpenRouterError(err ? `OpenRouter: ${err}` : 'The model returned an empty answer');
	}
	return content;
}

/** Check the key without spending tokens. (The returned label is not shown: it can contain part of the key.) */
export async function checkKey(apiKey: string): Promise<void> {
	let res;
	try {
		res = await withTimeout(requestUrl({ url: `${API}/key`, headers: headers(apiKey), throw: false }), 15000);
	} catch (e) {
		if (e instanceof OpenRouterError) throw e;
		throw new OpenRouterError('Network error: could not reach OpenRouter');
	}
	if (res.status !== 200) throw new OpenRouterError(errorMessage(res.status, parseBody(res.text)));
}
