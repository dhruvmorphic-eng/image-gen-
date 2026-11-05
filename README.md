# Image Studio

A simple, playful image workspace: one fixed **GPT Image 2** model, references, square/portrait/landscape presets, medium/high quality, and one to four images per request. Each canvas keeps its own prompts, reference images, outputs, and edit versions. Switch between an image grid and the conversation behind it.

There is no login page. A long-lived HttpOnly capability cookie identifies this browser's private workspace. Every canvas, generation, upload, and download still checks ownership. Canvases survive refresh and deployments when backed by the configured persistent database. A different browser has separate history; clearing the cookie loses access to that browser's history. This version does not promise account-based cross-device recovery. Keep the Vercel project's existing deployment protection for internal access if desired.

## Local setup

Requires Node.js 24+.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open [localhost:3000](http://localhost:3000). No accounts need to be created. Without an OpenAI key you can create canvases, attach references, and explore the UI, but generation honestly shows setup required.

Set `OPENAI_API_KEY` in `.env` to generate images and run the worker in a second terminal:

```sh
npm run worker
```

Local development uses `data/studio.sqlite` unless `DATABASE_URL` is configured. Never commit `.env` or the database. `APP_ORIGIN` must match the address in your browser. Restart the processes after changing environment variables.

## Vercel deployment

1. Import this repository as a Next.js project using Node.js 24 and enable access to **System Environment Variables** in project settings. The Workflow SDK requires `VERCEL_DEPLOYMENT_ID` at build time and runtime.
2. Connect a PostgreSQL database (for example, Neon from Vercel Marketplace). Set its pooled connection string as `DATABASE_URL`. Use a provider URL with the required TLS settings. Use separate databases for preview and production.
3. Add `OPENAI_API_KEY` as a server-only, encrypted environment variable. Set `APP_ORIGIN` to the production URL when using a custom domain. Vercel deployment URLs are also recognized automatically for origin checks.
4. Deploy. The database schema is initialized under a PostgreSQL advisory lock. **No standalone worker is needed on Vercel**: Vercel Workflow durably orchestrates image requests.

The app refuses to use local disk as a database on Vercel. Missing hosted storage yields a clear setup-required view. Do not reuse another application's database without reviewing the table names in `lib/db.ts`.

Images are private database bytes (PostgreSQL BYTEA in production, SQLite BLOB locally), so an original and its metadata commit together. No public object URLs or local temporary files are used. This keeps the MVP small and transactional; at larger scale, move asset bytes into private object storage. Back up the database and test recovery using your provider's backup tools.

Uploads accept still PNG, JPEG, and WebP files up to **4 MB** and 16 megapixels. The conservative upload cap fits Vercel's function request limit. Downloads stream the exact original bytes without a watermark or resizing; large originals use a streamed response rather than a buffered Vercel response. Each reference is uploaded separately and decoded on the server before storage.

## Background jobs and duplicate-charge protection

- An accepted request is committed with a unique submission key. Concurrent repeats return the same saved job. Reusing a key with different inputs is rejected.
- Image count is passed as `n` in one explicit Images API request. Every returned original is saved separately. Selecting any output as an edit reference creates a new version; previous versions remain intact.
- PostgreSQL advisory locks (or a local SQLite transaction) enforce global concurrency and image quotas across requests and workers. Limits count **images**, not just API calls. `GLOBAL_DAILY_LIMIT` also bounds spending if visitors create new browser cookies.
- On Vercel, a persisted dispatch lease starts a durable workflow with only a job ID. If dispatch is interrupted, reopening/polling the canvas resumes queued dispatch. Duplicate workflow starts cannot claim an already-running job.
- The claim and paid API call occur in one **non-retrying workflow step**. SDK retries are also disabled. The OpenAI call times out after four minutes; interrupted running jobs become uncertain failures after six minutes. Neither SDK retries nor workflow redelivery can submit the paid request again once its database status has changed to generating.
- Crash recovery favors avoiding duplicate charges: an interrupted request may have been charged and its output may be unrecoverable. The app says so and requires a new user action to regenerate. There is no fake percentage progress.
- Regenerate explains that it creates a new paid request for the original image count. Quota and submission ledgers survive canvas deletion.
- Prompts and references remain available after errors. Submitted history is server-side; unfinished drafts/retry keys are scoped to this browser in local storage.

## Configuration and sources

`lib/config.ts` owns the one-model allowlist, supported quality/size choices, and quotas. The browser cannot choose arbitrary models or dimensions. The UI fixes the model to `gpt-image-2`; it does not silently switch to a different model when access fails. No API credit balance or hardcoded prices are displayed.

The server uses the official OpenAI SDK's Images API: `images.generate` without references, and `images.edit` with explicitly ordered input files and instructions. For edits, the selected base image is reference 1.

Model settings were checked against the [official generation reference](https://developers.openai.com/api/reference/resources/images/methods/generate), [edit reference](https://developers.openai.com/api/reference/resources/images/methods/edit), and [image-generation guide](https://developers.openai.com/api/docs/guides/image-generation). Background execution follows the installed Workflow SDK docs and [Vercel Workflow](https://vercel.com/docs/workflows). Recheck these before changing provider-specific settings.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui # requires installed Google Chrome
```

Tests use temporary databases and injected API responses, never paid generations. The browser suite uses its own disposable database, not the working app's canvases. See `VERIFICATION.md` for the results and live-deployment limits.
