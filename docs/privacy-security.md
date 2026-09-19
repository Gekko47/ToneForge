# ToneForge — Privacy & Security

## Data handling

- **API keys**: Entered only via the Settings UI. Stored in `Office.roamingSettings`. Never committed to source.
- **Document text**: Read locally by the add-in for analysis. Sent to an LLM provider only when the user explicitly opts in for semantic rewriting.
- **Telemetry**: Disabled by default (`TELEMETRY_DISABLED=1`). No analytics endpoint configured.

## Prompt safety

- Prompts are built by `src/ai/prompts/`. They include only what is necessary for the requested operation.
- No raw document text is included in profiling prompts unless the user has explicitly enabled semantic analysis.

## Logging

- `src/shared/utils/logger.ts` redacts any context field whose name matches `/key|token|secret|password|auth/i`.
- Logs are console-only; no network egress.

## Storage

- `Office.roamingSettings` is encrypted at rest by the Office client.
- localStorage fallback is unencrypted; used only when the Office runtime is unavailable (e.g. unit tests).

## Compliance notes

- This is an MVP. Before production use, complete Stage 25 (Security/privacy hardening) and Stage 27 (Manual Word verification).
- If handling regulated data, add a data processing agreement review and consider on-premises or private endpoint LLM options.
