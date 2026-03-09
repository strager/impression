# Multi-Session Support

The app supports multiple sessions so users can track separate explorations for different people or contexts.

## Session Basics

- Each session stores its own card choices, answers, summaries, and freeform notes.
- Sessions are identified by a UUID and stored entirely in the browser's localStorage.
- When a session is created, it is auto-named with the current date (e.g. "February 13, 2026"). Users can rename sessions at any time.
- The session UUID is embedded in the URL (e.g. `/:sessionId/explore`). Each browser tab operates on the session identified by its URL, so multiple sessions can be open simultaneously in separate tabs without interference.

## Session Actions

**From the home page, users can:**

- **Open** a session by clicking its name — navigates to the session's URL based on its current phase.
- **Rename** a session by clicking the Rename button, editing inline, and pressing Enter.
- **Delete** a session (with confirmation). If the last session is deleted, a new empty one is created automatically.
- **New Session** creates a fresh session and navigates to its find-meaning page.

## Start Over

The "Start over" button (available on most pages) creates a new session and navigates to its find-meaning page. The previous session is preserved in the session list.

## Export / Import

- **Export** saves all sessions to a single JSON file (`somecam-sessions.json`) in `somecam-v2` format.
- **Import** reads a sessions file and merges it into the existing session list. Sessions are matched by UUID — existing sessions with the same UUID are overwritten, new ones are added.
- **v1 backwards compatibility**: `somecam-v1` files are no longer supported.

## Data Isolation

Each session's data is stored under its own prefixed localStorage keys (`somecam-{uuid}-{suffix}`). All session-scoped store functions take an explicit `sessionId` parameter (derived from the URL), so each tab reads and writes only the data for the session in its URL. Global data (LLM test state, storage persistence flag) is shared across sessions.
