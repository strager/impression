# Impression

This is an application for facilitating the Sources of Meaning Card Method,
helping people discover what is meaningful in their life.

Based on: Presentation of the Sources of Meaning Card Method: The SoMeCaM, by
Peter la Cour and Tatjana Schnell, 2016

## Technical details

- Web-based app
- TypeScript
- Vite
- Vitest
- npm
- Frontend:
  - Vue.js 3
  - Vue Router
- Backend:
  - Node.js v24
  - openapi-backend <https://www.npmjs.com/package/openapi-backend> with request
    and response validation

## Setup

```bash
npm ci
cp .env.example .env
```

Edit `.env` and set `XAI_API_KEY` to your key from <https://console.x.ai/>.
This enables AI-generated summaries on the /chosen page. The app runs without it,
but summaries will be unavailable.

## Runbook

```bash
npm run typecheck
npm test
npm run dev
```

Then open: <http://localhost:3011/>

## Developer pages

- <http://localhost:3011/llm-test> — Debug page for manually testing the
  LLM-backed API endpoints.
- <http://localhost:3011/style-guide> — Showcase of visual styles used in the
  application.
- <http://localhost:3011/ranking-convergence> — Debug page for testing the
  accuracy of the ranking algorithm.
