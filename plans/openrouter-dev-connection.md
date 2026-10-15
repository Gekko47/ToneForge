# OpenRouter Development Connection — Implementation Plan

## Problem

The dev gateway ([`dev-gateway.mjs`](scripts/dev-gateway.mjs)) is fully wired into the webpack dev server and handles all OpenRouter routes. However, the browser doesn't know where to find the gateway because `LLM_BROKER_URL` is not included in the `publicDevEnv` object that gets compiled into the browser bundle via webpack's `DefinePlugin`.

## Root Cause

In [`webpack.dev.js:52-62`](webpack.dev.js:52), the `publicDevEnv` object lists every environment variable the browser bundle can access. `LLM_BROKER_URL` is missing from this list, so `env.LLM_BROKER_URL` is always `undefined` in the browser, and [`SettingsDashboard.tsx:34`](src/taskpane/components/SettingsDashboard.tsx:34) gets an empty string for `gatewayOrigin`.

## Fix

**One-line addition** to [`webpack.dev.js`](webpack.dev.js:52) — add `LLM_BROKER_URL` to `publicDevEnv`:

```js
const publicDevEnv = {
  NODE_ENV: "development",
  PORT: process.env.PORT ?? "3000",
  HTTPS_PORT: process.env.HTTPS_PORT ?? "3001",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS ?? "30000",
  OPENAI_MAX_RETRIES: process.env.OPENAI_MAX_RETRIES ?? "2",
  TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED ?? "1",
  ANALYTICS_ENDPOINT: process.env.ANALYTICS_ENDPOINT ?? "",
  // Same-origin path to the dev gateway middleware mounted on the webpack dev
  // server. The gateway client appends /v1/connections/... to this origin.
  LLM_BROKER_URL: "/__toneforge/gateway",
};
```

The value is the gateway's own path prefix, not a bare `"/"`. The client appends
`/v1/connections/...`, producing `https://localhost:3000/__toneforge/gateway/v1/...`,
which matches the middleware mounted at [`webpack.dev.js:140`](webpack.dev.js:140)
(`GATEWAY_PATH_PREFIX` in [`dev-gateway.mjs:32`](scripts/dev-gateway.mjs:32)).

A bare `"/"` also "works" as a same-origin path, but it produces
`/v1/connections/...` with no prefix, which the middleware does not match — the
request falls through to static serving and 404s. The prefix is required.

## Why This Works

1. [`env.ts:43`](src/core/config/env.ts:43) already accepts `LLM_BROKER_URL` in its Zod schema
2. [`gatewayClient.ts:128`](src/ai/gateway/gatewayClient.ts:128) already validates it — a same-origin path (`/`) is accepted
3. [`SettingsDashboard.tsx:34`](src/taskpane/components/SettingsDashboard.tsx:34) already reads `env.LLM_BROKER_URL` and passes it to `OpenRouterConnectionSettings`
4. [`OpenRouterConnectionSettings.tsx:84`](src/taskpane/components/OpenRouterConnectionSettings.tsx:84) already creates a gateway client with that origin
5. The dev gateway middleware is already mounted on the dev server

## Connection Steps (After Fix)

1. Run `npm run dev`
2. Open the task pane in Word (or browser)
3. Go to **Settings → LLM connections**
4. Enter your OpenRouter API key in the password field
5. Click **Connect OpenRouter**
6. The key is sent once to the local gateway, stored in Node memory, and cleared from the browser
7. The gateway fetches the model catalog and returns an opaque connection reference
8. Select a model from the dropdown

## Security Properties

- The API key never enters the browser bundle, persisted state, or logs
- It lives only in the Node process memory
- It is dropped when the dev server stops
- Only an opaque connection reference is persisted in the browser

## Debugging Notes

### `DefinePlugin` values are baked at compile time — restart the dev server

`webpack.dev.js` compiles `publicDevEnv` into the bundle with
`new webpack.DefinePlugin({ "process.env": JSON.stringify(publicDevEnv) })`.
Changing `publicDevEnv` does **not** take effect through hot module replacement:
the running dev server keeps serving the previously compiled value until it is
restarted. A stale bundle is the single most likely cause of a gateway 404.

To confirm what the running server is actually serving:

```powershell
curl.exe -k -s https://localhost:3000/taskpane.js -o "$env:TEMP\tf.js"
Select-String -Path "$env:TEMP\tf.js" -Pattern 'LLM_BROKER_URL":"[^"]*"'
```

If that prints `LLM_BROKER_URL":"/"` the bundle is stale — stop the dev server
and run `npm run dev` again.

### The request log is the ground truth

`webpack.dev.js` appends every request to `requests.log`. A gateway request that
reached the middleware appears as `POST /__toneforge/gateway/v1/connections/api-key`.
A request logged as `POST /v1/connections/api-key` (no prefix) never reached the
middleware and was served as a static 404.

### Other fixes in this change

- [`gatewayClient.ts`](src/ai/gateway/gatewayClient.ts) — `normalizeGatewayOrigin`
  preserves a same-origin path instead of stripping its trailing slash; URL
  construction avoids a double slash; `fetch` is bound to `globalThis` to avoid
  "Illegal invocation"; network errors include the URL and underlying message.
- [`gatewayAdapter.ts`](src/ai/providers/gatewayAdapter.ts) — same `fetch` binding.
- [`dev-gateway.mjs`](scripts/dev-gateway.mjs) — CORS headers and a loopback
  origin bypass so Word desktop's cross-origin iframe can reach the gateway.
  The bypass requires **both** the `Host` and `Origin` to be loopback.

### "Both models connected, but the dashboard says not connected"

A second, independent defect. The gateway log proved both connections were live
(`GET /v1/connections/:id/test` returned 200 for both), yet Home's setup card,
the LLM-settings pane header, and Troubleshooting's open-items count all reported
the AI provider as missing — while the role cards on the same page correctly
showed "Connected".

**Root cause.** Two surfaces read connection state through two different paths:

- The role cards read [`buildRoleConnectionViews`](src/taskpane/settings/llmDashboardModel.ts:33),
  which resolves the binding's `connectionId` against `providerConnections` and
  checks `status === "connected"`. Correct.
- The setup checklist read [`setupStatusFromState`](src/taskpane/setupStatus.ts:83),
  which called `isRemoteProviderConfigured(state.settings, ...)`. That resolves
  through `connectionFromSettings`, which returns `undefined` whenever
  `settings.llmProvider === "mock"`.

The dashboard's connect path ([`SettingsDashboard.handleConnect`](src/taskpane/components/SettingsDashboard.tsx:121))
writes a role binding and a `providerConnections` entry and **never touches
`settings.llmProvider`**, so that legacy field stays `"mock"` forever. Every
surface fed by the setup checklist therefore contradicted the role cards.

**Fix.** [`setupStatusFromState`](src/taskpane/setupStatus.ts:83) now calls
[`isGeneralRoleConfigured`](src/taskpane/settings/providerComposition.ts:354),
which is role-aware when a general binding exists and falls back to the legacy
field only when none does — so a pre-v15 store keeps working. Pinned by four
tests in [`setupStatus.test.ts`](tests/unit/taskpane/setupStatus.test.ts:62).

**Known dev-only gap.** The dev gateway holds connections in an in-memory `Map`
([`dev-gateway.mjs:124`](scripts/dev-gateway.mjs:124)), so a dev-server restart
clears it while the persisted `ProviderConnection` survives in roaming settings.
After a restart the dashboard shows "Connected" (the persisted record says
`status: "connected"`) but every request 404s. The 404 now surfaces as
`unknownConnection` with reconnect guidance rather than a retry that cannot
succeed — but the dashboard cannot detect this on its own, because the persisted
record is indistinguishable from a live one until a request fails.
