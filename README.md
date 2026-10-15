# Inline Ask

Ask an AI a question right where you are writing in Obsidian. Wrap the question in question marks; the
number of marks sets how hard the model works:

| Syntax           | Level  | What happens                                                                  |
|------------------|--------|-------------------------------------------------------------------------------|
| `?question?`     | easy   | A quick model shows a dropdown of short alternatives under the question.      |
| `??question??`   | medium | Same dropdown from a stronger model; may take a few seconds.                  |
| `???question???` | hard   | Answered in the background; the question is replaced in place when done.     |

Example: type `The answer is ?whats 2+2?` and a dropdown shows `4` / `2 + 2 is 4` / `it's 4`. Pick one with
the arrow keys and Enter, and the whole `?whats 2+2?` is replaced. Esc dismisses it and leaves the text as it
is; so does simply typing on.

With `???`, the question is dimmed with a ⏳ while you keep writing, in this note or another one. When the
answer arrives the plugin finds the exact `???question???` text again (it may have moved) and replaces it. If
you edited or deleted the question in the meantime, the answer is discarded and a short notice tells you so.
If the note is not open any more, the file is edited atomically with `vault.process`. Only the note the
question is in is ever changed.

## When it triggers

A request is sent only right after you **type** the closing marker, and only once per trigger. Moving the
cursor, pasting text or reopening a note never sends anything. To avoid false triggers in normal writing:

- the opening run must be at the start of a line or after a space or opening punctuation (`(` `[` `{` `"`
  `'` `“` `‘` `«` `*` `_` `~`), and be followed directly by a character that is not a space or `?`;
- the closing run must directly follow a non-space character, and its length must equal the opening run's
  (1, 2 or 3; runs of 4 or more never trigger);
- the question is 1-500 characters on one line;
- nothing triggers inside fenced code blocks, inline code, frontmatter, `$$` math blocks, inline `$math$`,
  link targets (`[text](…)`, `[[…]]`), URLs (`https://…?a=1`, `www.…`) or `%% comments %%`;
- `\?` is a literal question mark and is never part of a trigger.

So `Really? Yes?` and `example.com/?a=1` are left alone.

## Privacy: what is sent, and where

- Requests go **directly from your device to OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`)
  using Obsidian's `requestUrl`. There is no other server.
- Each request contains only: the question, up to *N* words of the same note before and after it (setting
  "Context words", default 30 each side, `0` = question only), a short fixed system prompt, and the model
  settings. Frontmatter is never included. Nothing else from the vault is sent.
- The model list for the settings picker is fetched from `https://openrouter.ai/api/v1/models` (public, no key).
- "Test connection" calls `https://openrouter.ai/api/v1/key` and sends a one-word test prompt.
- OpenRouter and the model provider you choose handle the request under their own policies.

## API key: per device, never synced

Each device stores its own OpenRouter key in Obsidian's **SecretStorage** (Obsidian 1.11.4+), which lives in
the app's local storage on that device, outside the vault. It is never written to a note, to `data.json`
or to the log. The settings tab only shows whether a key is set. (If SecretStorage is ever unavailable, the
plugin falls back to its own `data.json` on that device.)

With Self-hosted LiveSync: the key is not in the vault, so it cannot sync. The plugin's settings
(`.obsidian/plugins/inline-ask/data.json`, models and options only) sync only if you turn on LiveSync's hidden
file / customization sync.

## Settings

- **OpenRouter**: API key (save / replace / clear), Test connection.
- **Per level** (easy / medium / hard): enabled, model (searchable picker over OpenRouter's live model list,
  showing price and whether the model supports structured output and reasoning), reasoning effort (sent as
  OpenRouter `reasoning: { effort }`; `None` sends no reasoning settings).
- **Behaviour**: number of alternatives (2-5), context words, timeout for `???` answers (default 5 minutes).

Defaults (picked from OpenRouter's model list in October 2026; change them any time):

| Level  | Model                         | Reasoning effort |
|--------|-------------------------------|------------------|
| easy   | `anthropic/claude-haiku-5.5`  | none             |
| medium | `anthropic/claude-sonnet-5.5` | low              |
| hard   | `anthropic/claude-opus-5.5`   | high             |

Dropdown answers are requested as JSON (`{"alternatives": [...]}`): with a JSON schema when the model supports
OpenRouter structured outputs, otherwise with JSON mode or plain text, parsed leniently. Errors (no key, bad
key, no credits, network) show as one row in the dropdown, or as a notice for `???`.

## Install

Requires Obsidian 1.11.4 or newer. Works on desktop and mobile (no Node or Electron APIs).

Manual install: build (below), then copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/inline-ask/`, reload Obsidian, and enable **Inline Ask** under
Settings → Community plugins. Then add your OpenRouter key under Settings → Inline Ask.

## Development

```sh
npm install
npm run dev     # watch build to main.js
npm run build   # type-check + production build
npm test        # unit tests (trigger parser, context, reply parsing)
npm run lint
```

Source layout (`src/`):

| File            | Purpose                                                                  |
|-----------------|--------------------------------------------------------------------------|
| `trigger.ts`    | Pure trigger parser and protected-region detection (unit-tested).        |
| `typed.ts`      | CodeMirror field: "a `?` was just typed here" (one request per trigger). |
| `context.ts`    | Words before/after the question (unit-tested).                           |
| `prompts.ts`    | System prompts per level.                                                |
| `openrouter.ts` | OpenRouter client (`requestUrl`), model list, key check.                 |
| `parse.ts`      | Parsing model replies, locating text (unit-tested).                      |
| `ask.ts`        | Trigger detection in the editor, building requests.                      |
| `suggest.ts`    | `EditorSuggest` dropdown for `?` and `??`.                               |
| `background.ts` | `???` jobs: pending decoration, relocation, replacement.                 |
| `secrets.ts`    | Per-device key storage.                                                  |
| `settings.ts`   | Settings tab and model picker.                                           |

Develop against a separate test vault, not a synced one.

### Notes

- The dropdown's "Thinking…" row is replaced with the answers through `EditorSuggest`'s internal
  `showSuggestions`, since the public API has no refresh. If a future Obsidian version removes it, the
  dropdown would stay on "Thinking…"; check this first after an Obsidian update.
- `requestUrl` cannot be aborted, so timeouts stop waiting but do not cancel the request at OpenRouter.

## License

0-BSD
