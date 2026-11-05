# Verification — November 5, 2026

## Passed for the canvas revision

- Type checking and production build, including Vercel Workflow compilation.
- ESLint: application source passes; generated Workflow routes are excluded.
- 16 server tests: capability-cookie isolation, origin checks, cross-browser access rejection, upload validation, original bytes, simultaneous submission deduplication, single-model/settings/count validation, concurrency, multiple result persistence, editing a non-first output, uncertain timeout handling, image quotas, global spending cap, setup state, and revoked access.
- 4 production-browser tests in Chrome: no login/model dropdown, reference and canvas restoration, rename/delete, desktop/mobile layout, multiple images in both grid and conversation, original download, selected-image edit attachment, paid-regeneration confirmation, and cross-canvas persistence.
- Visually inspected desktop at 1440 × 960 and mobile at 390 × 844. No horizontal overflow; composer controls remain usable.

Browser screenshots are in ignored `test-results/desktop-workspace.png` and `test-results/mobile-workspace.png`. Test raster images and test history live only in the disposable test database.

## Live verification limits

No real OpenAI generation or edit request has been completed. No API key was supplied. The official SDK integration is exercised through an injected test client; there is no mock-generation path in the app.

Local database behavior is tested with SQLite. PostgreSQL's production adapter and Vercel's durable workflow are implemented and compile successfully, but live hosted database/generation behavior requires a configured `DATABASE_URL` and `OPENAI_API_KEY`. Missing production storage produces setup required and never falls back to ephemeral disk.

The README describes browser-local identity (no login, no cross-device recovery), production configuration, and failure/charge semantics. Deployment status and URLs are reported separately after publication.
