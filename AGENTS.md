This repository contains the Impression application:

- `backend/`: Node.js backend (Express + openapi-backend)
- `frontend/`: Vue 3 frontend (Vite + Vue Router)
- `openapi.yaml`: OpenAPI-first API contract

## Architecture Overview

- Backend entrypoint: `backend/main.ts`
- Express app factory: `backend/app.ts`
- OpenAPI wiring and handlers: `backend/api.ts`
- API spec: `openapi.yaml`
- Frontend app root: `frontend/main.ts`

The browser talks to the backend on one origin (`http://localhost:3011`).  
Vite runs in middleware mode and is attached by `backend/main.ts`.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Tests: `npm test`
- Type checks: `npm run typecheck`
- Lint: `npm run lint`
- Lint (auto-fix): `npm run fix`
- Format: `npm run format`

## Backend Rules

- Keep API routes mounted at `/api` in Express.
- Keep OpenAPI paths in `openapi.yaml` without the `/api` prefix (for example `/health`).
- Return validation failures as `application/problem+json` (RFC 9457-style fields).
- Preserve request and response validation through `openapi-backend`.

## Frontend Rules

- Frontend requests should target backend API paths such as `/api/health`.
- Keep Vue Router history mode unless there is an explicit reason to change it.

## TypeScript Rules

- Backend uses native Node TypeScript execution (`node` directly).
- Keep backend code compatible with `erasableSyntaxOnly: true` (no `enum`, no parameter properties).
- Use explicit `.ts` extensions for all local imports (both frontend and backend).

## Testing Guidance

- `backend/api.test.ts` is an integration-style test that starts the app on a random local port.

## Workflow

- After making changes, run `npm run lint`, `npm run typecheck`, and `npm test`. Fix all errors — including pre-existing ones — before finishing.

## Shared Data

- Both frontend and backend import from `shared/`.
- `shared/meaning-cards.ts` and `shared/explore-questions.ts` are the source of truth for cards and questions.

## Notes for Future Changes

- If API response schemas change, update both `openapi.yaml` and tests together.
- When making to changes to analytics, always review `docs/privacy.md` first.
