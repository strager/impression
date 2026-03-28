# Examine flow — user story

## Entering the examine page

After choosing their sources of meaning on the Find Meaning page, the user lands
on the Examine overview. Each source of meaning has an **Examine** button.
Clicking it takes the user to `/examine/:meaningId`, where they begin a guided
reflection on that source of meaning.

## Answering the first question

The examine page shows the source of meaning's description at the top, followed by a single
question drawn from one of five examination topics: Interpretation, Significance,
Importance, Threat, and Change. The question is randomly assigned when the user
first visits the Examine page.

A textarea is displayed below the question. The user types their reflection and
clicks **Next** (or presses Shift+Enter) to submit their answer.

## LLM inference after each answer

Once the user submits an answer, the app sends all answers given so far to the
backend. The LLM reads the source of meaning context and every answered question, then checks
whether the user's responses already address any of the remaining unanswered
questions. If so, it drafts short answers in the user's own style.

## Pre-filled questions appearing next

If the LLM determined that a remaining question was already addressed, that
question is shown next with the LLM's suggested answer pre-filled in the
textarea. The textarea is read-only with auto-fill styling (italic gray text and
an "auto-filled" chip). The user must explicitly choose **Edit** or **Clear**
before proceeding — the normal **Next** button is hidden while the auto-fill is
pending. If no question was pre-filled, the next question is chosen at random
from the remaining pool.

## Editing or clearing pre-fills

When a pre-filled answer appears, two buttons are shown side by side:

- **Edit** — accepts the pre-filled text, makes the textarea editable with the
  cursor at the end, and shows the normal **Next** button.
- **Clear** — empties the textarea, makes it editable and focused, and shows the
  normal **Next** button.

The `autoFilledPending` flag on the entry tracks whether the user has interacted
with the pre-fill. It persists to localStorage so the auto-fill UI survives page
refreshes.

If the user presses **Clear** and then refreshes the page before typing a new
answer, `loadExamineData` discards the blank active entry (since at least one
non-blank answer exists for the source of meaning). On the next `initialize()`, the app
regenerates the active question through the normal infer flow.

## Answering all five questions

The user works through questions one at a time. Previously answered questions are
displayed as editable textareas above the active question. The user can click
into any prior answer to revise it; changes are saved automatically when the
textarea loses focus. After the fifth and final answer is submitted, the
free-form notes field appears.

## Selecting meaning descriptions

After answering all five questions, a checklist of meaning descriptions related to
the current source of meaning appears. These descriptions come from the Sources of
Meaning and Meaning in Life Questionnaire. The user checks any descriptions that
feel right to them and clicks **Next** to continue.

Selections are saved to localStorage (as description IDs) and included in the
downloadable profile. Description text is resolved from the shared
`MEANING_DESCRIPTIONS` data at display time.

## Answer reflection (guardrail and thought bubble)

After the user submits an answer, the app fires two requests in parallel: the
existing infer-answers call and a **reflect-on-answer** call. The reflection
endpoint returns one of three outcomes:

- **guardrail** — the answer is dismissive, vague, or dodges the question.
- **thought bubble** — the answer is substantive, and the LLM has a Socratic
  follow-up question that might deepen the user's thinking.
- **none** — the answer is substantive and no follow-up is warranted.

### When "none" is returned

The app advances to the next question immediately (or shows a pre-filled
question from the infer-answers call). No follow-up is displayed.

### When a guardrail is returned

A follow-up question is displayed inline, styled in amber to distinguish it
from regular questions. The guardrail never blocks progress.

If the user edits their answer and presses **Next**, the guardrail disappears
and the app fires the reflect-on-answer call a second time. This second call
can return a thought bubble or none, but never a second guardrail for the same
question.

If the user presses **Next** without editing their answer, the guardrail
disappears and the app advances to the next question. No second
reflect-on-answer call is made.

### When a thought bubble is returned

A follow-up question is displayed as a thought bubble — visually distinct from
both the amber guardrail and the regular green questions. The thought bubble is
a Socratic prompt: it references something the user wrote and invites them to
think further (e.g. "You mentioned routine — what happens on days when that
breaks?").

The thought bubble is static once shown. The user can edit their answer in
response, or ignore it. Pressing **Next** dismisses the thought bubble and
advances to the next question. No further reflect-on-answer call is made after
a thought bubble.

### Maximum presses of Next per question

The most **Next** presses for a single question is three: once to submit the
answer (triggering a guardrail), once to resubmit after editing (triggering a
thought bubble), and once to advance. In the common case the user presses
**Next** once or twice.

### Failure handling

If the reflect-on-answer request fails (network error, API error, unparseable
response), the app fails open: it treats the answer as sufficient and advances
normally. This ensures the reflection step is purely additive and never
degrades the core examine experience.

## Manual reflection on answered questions

A subtle "Reflect" link appears below every answered question's textarea. Clicking
it calls the reflect-on-answer endpoint on demand, letting the user request a
fresh reflection at any time — not just during the automatic submit flow.

The result is displayed inline using the same styling as the automatic flow:

- **guardrail** — amber follow-up, same as the automatic guardrail.
- **thought bubble** — green Socratic prompt with a thought-bubble icon, same as the automatic
  thought bubble.
- **none** — a positive "Your answer looks good!" message in green italic.

The Reflect link is hidden when a result is showing. The reflection result remains
visible even if the user edits the answer text — it is not cleared on input.

Manual reflection state is transient (not persisted to localStorage). If the
reflect-on-answer request fails, the app fails open by showing "Your answer looks
good!" (type "none").

The Reflect link is not shown on the active question while the automatic
submit-flow reflection is visible, to avoid duplication.

## Additional notes (free-form)

Once all five questions have been answered, a free-form textarea labelled
"Additional notes about this source of meaning" is displayed. This is not a
structured question — there is no answer reflection. The user can type any extra
thoughts they want to capture about the source of meaning. The note is saved to localStorage
and included in the downloadable profile above the five Q&A blocks.

The user can leave the field empty and click **Finish examining** to return to
the sources-of-meaning overview.

## Using "Stop Examining" for early exit

At any point during the examination, a **Stop Examining** button is visible below
the active question. Clicking it saves whatever text is currently in the textarea
(if any) and returns to the examine list. The user does not need to answer all
five questions — they can stop whenever they feel they have reflected enough.

## Examination complete

After answering all five questions for a source of meaning, clicking
**Finish examining** takes the user to an interstitial page at
`/:profileId/examine/:meaningId/complete`. This page makes completion feel more
satisfying by showing the user's reflections distilled back to them.

The page displays:

- The source of meaning's description as a heading.
- A warm rotating phrase (e.g. "Your reflections, distilled"), selected
  deterministically from the profile and source of meaning IDs.
- Progress squares showing how many sources have been fully examined.
- AI-generated summary of the user's answers.

The call-to-action varies based on progress:

- If more sources remain: a **Keep examining** button returns to the examine list.
- If all sources are complete: **Print your profile** is the primary action, with
  **Back to examine list** as a secondary option.

The page is purely presentational — no user input is collected. If accessed
directly without data (e.g. via URL), it redirects to the examine list.

On the first visit for a given source of meaning, elements cascade in with timed fade-in
animations. On revisit, all animations (including the fade-out transition from
the examine page) are skipped and content appears immediately.
