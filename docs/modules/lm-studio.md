# LM Studio

**Status:** idea

## Goal

LM Studio as a pi provider: models are read live from the server, so `/model` shows whatever LM Studio has, and the
same provider works against LM Studio on this machine or on another one.

## What pi offers

- **`models.json`** (pi's docs recommend this for LM Studio): a static `openai-completions` entry at
  `http://localhost:1234/v1`. You list every model by hand, so it doesn't meet the goal.
- **A provider with `refreshModels`**: `pi.registerProvider()` with a provider that fetches its model list. Pi's
  built-in llama.cpp provider (`dist/extensions/llama/`) does exactly this for another local server, and is the
  template to follow.

## LM Studio's API

Checked against LM Studio's docs (native REST API v1 needs LM Studio 0.4.0 or later):

- **Default address:** `http://localhost:1234`.
- **Chat:** OpenAI-compatible `/v1/chat/completions`, plus `/v1/responses` and an Anthropic-compatible `/v1/messages`.
- **Model list:** `GET /api/v1/models` lists downloaded models, loaded or not. Each entry has:
  - `type`: `llm`, `embedding` or `decision`.
  - `key` and `display_name`.
  - `loaded_instances[].config.context_length`.
  - `max_context_length`.
  - `capabilities`: `vision`, `trained_for_tool_use`, and `reasoning.allowed_options`.

  `/v1/models` lists IDs only.
- **Load and unload:** `POST /api/v1/models/load` and `/api/v1/models/unload`.
- **Auth:** off by default. When it's turned on (Developer → Server Settings), every request needs
  `Authorization: Bearer <token>`, and tokens are made under "Manage Tokens".

### Local and remote

| Connection | URL pi uses | Setup |
|---|---|---|
| Local | `http://127.0.0.1:1234` | Start the server in LM Studio, or run `lms server start`. |
| Remote over the network | `http://<host>:1234` | Turn on "Serve on Local Network" on the remote machine (it binds `0.0.0.0`), and turn on auth there. LM Studio warns against any non-localhost bind without auth. |
| Remote through LM Link | `http://127.0.0.1:1234` | LM Link joins LM Studio installs over Tailscale. The remote machine's models show up in the local server's list, and the local server routes the request. To pi it's a local connection. |

So the provider really needs only a server URL and an optional token. LM Link already makes a remote machine look
local.

## Behavior

- `/login lmstudio` asks for the server URL (default `http://127.0.0.1:1234`) and an optional API token, checks the
  server answers, and stores both. Env vars `LMSTUDIO_BASE_URL` and `LMSTUDIO_API_KEY` work instead.
- `/model` lists LM Studio's LLMs. Embedding and decision models are left out.
- The list refreshes at startup and when `/model` is opened, so models downloaded in LM Studio appear without a
  restart.
- A second server (say, a desktop on the network as well as the laptop) is a second provider with its own `/login`.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Registration | `pi.registerProvider(provider)` with a native `Provider` from pi-ai, **in the extension factory** | Pi applies providers registered while extensions load before it picks the startup model and restores a resumed session's model (`agent-session-services.js` applies `pendingNativeProviderRegistrations`, then `sdk.js` restores). MyPi's modules start in `session_start`, after that, so a provider registered in `init()` misses `--model lmstudio/…` and fails to restore a session that used it ("Could not restore model"). See open questions. |
| Auth and URL | `auth.apiKey` with `login`, `check` and `resolve` | Copy llama.cpp's: `login` prompts for the URL and a secret, tests it, and returns `{ type: "api_key", key, env: { LMSTUDIO_BASE_URL } }`. `resolve` returns `{ apiKey, baseUrl: <url>/v1 }`, and `"lm-studio"` as the key when auth is off. |
| Model list | `refreshModels(context)` → `context.publish({ persist, update })` | First restore `context.stored`, so startup works before the network answers. Stop if `!context.allowNetwork`. Then `GET /api/v1/models` with `context.signal`, map each LLM to a pi model, and publish with `persist`, so the next startup has the list offline. `getModels()` returns the current list synchronously. |
| Model mapping | `ProviderChatModelConfig` | `id` is `key`, and `name` is `display_name`. `input` gets `"image"` when `capabilities.vision` is set. `reasoning` is true when `capabilities.reasoning` allows `on`. `contextWindow` is the loaded instance's `context_length`, else `max_context_length`. `cost` is all zeros. |
| Streaming | `stream` / `streamSimple` from `@earendil-works/pi-ai/compat` with `api: "openai-completions"` | Reuse pi's implementation, as llama.cpp does. Don't write a stream. |
| Compat | `compat` on each model | Start from llama.cpp's (`supportsStore: false`, `supportsDeveloperRole: false`, `maxTokensField: "max_tokens"`, …) and confirm each flag against a real LM Studio server. Pi's docs say not to enable flags just because a server claims compatibility. |
| Context overflow | Already handled | pi-ai recognises LM Studio's "greater than the context length" error (`utils/overflow.js`), so compaction and retry work. |

## Things to verify on a real server

- How LM Studio takes the reasoning on/off switch over `/v1/chat/completions`, and how it returns reasoning text. That
  decides `thinkingLevelMap` and `compat.thinkingFormat`.
- Picking an unloaded model makes LM Studio load it just in time, with its default context length, which can be much
  smaller than `max_context_length`. Pi would then think the window is bigger than it is. Options: list only loaded
  models, or load with an explicit `context_length` through `/api/v1/models/load`.
- Whether LM Link's remote models carry any field in `/api/v1/models` that tells them apart.
- Whether token auth also guards the OpenAI-compatible `/v1` routes. The docs only say "REST API, Python SDK, or
  TypeScript SDK".

## Slices

1. Model mapping: `/api/v1/models` JSON → pi models, as a pure function with tests from the docs' example response.
2. The provider: auth with `/login`, `refreshModels` with persist, streaming through pi-ai, local URL only.
3. Live test against LM Studio: chat, tool calls, images, abort, overflow.
4. Reasoning on/off once the wire format is known.
5. A remote server, by URL and token.
6. Optional: an `/lmstudio` command to load and unload models, like `/llama`.

## Open questions

- **Where does a provider live in MyPi?** It has to register in the extension factory, but modules start in
  `session_start` and the saved module selection isn't known until then. Options:
  1. A new factory-time hook in MyPi (for example a `providers()` list next to the modules), registered on every load
     and not switchable in `/modules`.
  2. A module that's `ALWAYS` loaded but registers its provider from `index.ts`.
  3. Accept the limit and register in `init()`: works for picking the model with `/model`, but not for `--model` or
     restoring a resumed session.
- List unloaded models (just-in-time load, context guess) or only loaded ones?
- Show LLMs that aren't `trained_for_tool_use`? They'll struggle with pi's tools.
- Provider ID: `lmstudio` or `lm-studio`? A second server would be `lmstudio-<name>`.

## References

- pi: `dist/extensions/llama/provider.js` and `index.js` (the template), `docs/custom-provider.md`, `docs/models.md`,
  `docs/llama-cpp.md`, `Provider` and `RefreshModelsContext` in `pi-ai/dist/models.d.ts`, `ProviderConfig` in
  `dist/core/extensions/types.d.ts`
- LM Studio: [list models](https://lmstudio.ai/docs/developer/rest/list),
  [REST API](https://lmstudio.ai/docs/developer/rest),
  [OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat),
  [authentication](https://lmstudio.ai/docs/developer/core/authentication),
  [serve on network](https://lmstudio.ai/docs/developer/core/server/serve-on-network),
  [LM Link](https://lmstudio.ai/docs/developer/core/lmlink)
