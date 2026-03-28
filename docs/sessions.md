# Multi-profile support

The app supports multiple profiles so users can track separate sets of meaning sources for different people or contexts.

## Profile basics

- Each profile stores its own source of meaning choices, answers, summaries, and freeform notes.
- Profiles are identified by a UUID and stored entirely in the browser's localStorage.
- When a profile is created, it is auto-named with the current date (e.g. "February 13, 2026"). Users can rename profiles at any time.
- The profile UUID is embedded in the URL (e.g. `/:profileId/examine`). Each browser tab operates on the profile identified by its URL, so multiple profiles can be open simultaneously in separate tabs without interference.

## Profile actions

**From the home page, users can:**

- **Open** a profile by clicking its name — navigates to the profile's URL based on its current phase.
- **Rename** a profile by clicking the Rename button, editing inline, and pressing Enter.
- **Delete** a profile (with confirmation). If the last profile is deleted, a new empty one is created automatically.
- **New Profile** creates a fresh profile and navigates to its find-meaning page.

## Start over

The "Start over" button (available on most pages) creates a new profile and navigates to its find-meaning page. The previous profile is preserved in the profile list.

## Export / import

- **Export** saves all profiles to a single JSON file (`impression-sessions.json`) in `somecam-v2` format.
- **Import** reads a profiles file and merges it into the existing profile list. Profiles are matched by UUID — existing profiles with the same UUID are overwritten, new ones are added.
- **v1 backwards compatibility**: `somecam-v1` files are no longer supported.

## Data isolation

Each profile's data is stored under its own prefixed localStorage keys (`somecam-{uuid}-{suffix}`). All profile-scoped store functions take an explicit `profileId` parameter (derived from the URL), so each tab reads and writes only the data for the profile in its URL. Global data (LLM test state, storage persistence flag) is shared across profiles.
