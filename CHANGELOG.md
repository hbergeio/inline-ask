# Changelog

## Unreleased

### Fixed

- `???` questions: the ⏳ pending marker followed the cursor when you kept typing (space, Tab or text) right after
  the closing `???`. It now stays attached to the question it belongs to while the answer is being fetched.

## 1.0.1

- Settings tab rebuilt on Obsidian's declarative settings API: every setting shows up in Obsidian's settings search.
- Number fields are validated; clearing a field no longer silently sets it to 0 (which turned context off).
- Clearer notice and settings wording.
- Requires Obsidian 1.13.0 or newer (was 1.11.4).

## 1.0.0

- First release: `?question?` and `??question??` dropdowns, `???question???` background answers, OpenRouter with a
  per-device key in SecretStorage.
