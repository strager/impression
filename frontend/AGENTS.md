## ViewModel Pattern

- Pages use a ViewModel pattern (see `docs/viewmodel.md`). When introducing or editing a feature, update the ViewModel (`.ts`) and its tests (`.test.ts`), not just the View (`.vue`).

## localStorage

- All localStorage access goes through `frontend/store.ts`. Do not use `localStorage` directly in components.
- Debounce text input saves (300ms). Save immediately on discrete actions (button clicks, dropdown changes).

## Design Tokens

- Primary green: `#2a6e4e` — used for buttons, accents, checkboxes, focus rings.
- Use green for positive/primary actions. Reserve red for destructive actions only.

## UI/UX

- For a comprehensive style guide (CSS rules, etc.) see `docs/style-guide.md`.
- On page navigation, scroll to the top of the page.
- When validation fails, focus the relevant input field.
- Don't rely on color alone to indicate state — pair with icons or other visual cues.
- Batch async UI updates: if loading multiple items, wait until all are ready before showing them (avoid items popping in one by one).
- When displaying lists of cards, use `MEANING_CARDS` order. When displaying question-related data, use `EXAMINE_QUESTIONS` order.
