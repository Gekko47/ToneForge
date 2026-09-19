# ToneForge — Changelog

## 0.1.0 — 2026-09-19 — Scaffold

- Repository baseline and production-ready scaffold.
- Unified JSON manifest for Word.
- Core domain model (`StyleProfile`, `Finding`, `ChangePlan`, `Change`).
- State persistence (`Office.roamingSettings` + localStorage fallback).
- Provider-agnostic LLM layer (`LlmProvider`, OpenAI adapter, Mock adapter, registry).
- Word boundary modules (`capabilityProbe`, `documentReader`, `revisionAdapter`).
- Taskpane UI (React + Fluent UI v9) and command entry point.
- Tooling: TypeScript, Webpack 5, Vitest, ESLint, Prettier, Husky, commitlint.
- CI: GitHub Actions install → typecheck → lint → format → test → build → manifest validate.
- Docs: architecture, onboarding, privacy, accessibility, project-state, decision-log.
