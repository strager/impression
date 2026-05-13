# How identification works

Impression presents you with 26 sources of meaning, each representing a
potential source of meaning in your life. Through a multi-step identification
process, you prioritize a small handful that matter most to you.

## Step 1: Initial identification

You are shown each of the 26 sources of meaning one at a time, in a
randomized (shuffled) order. Each one displays a description — for example,
_"I intervene when I see injustice being done"_ or _"Freedom is the most
important thing for me"_. At this stage, you do not see the name of the
source of meaning; you only see the description itself.

For each one, you choose one of three responses:

- **Agree** — this description feels right to you
- **Disagree** — this description does not feel right to you
- **Unsure** — you are not sure

You can swipe (on touch devices) or click the buttons. An undo button lets
you go back and change your mind on any previous response. A progress bar
tracks how far along you are.

After all 26 have been identified, you move on. If you agreed with 5 or fewer,
those become your chosen sources of meaning and you skip straight to your
results. If you agreed with more than 5, you continue to the prioritizing
step.

> **Note:** If you agreed with fewer than 3, your "unsure" responses are
> included alongside your "agree" responses for the prioritizing step, so
> you have enough to work with.

## Step 2: Prioritizing

In this step, you narrow down the sources of meaning that passed the
initial identification to your top 3–5 through a series of pairwise
comparisons.

You are shown two sources of meaning at a time. Tap the one that
matters more to you to highlight it, then tap it again to confirm. A
**Back** button lets you undo the previous comparison — when you go
back, the pair you originally answered is shown again with your previous
pick pre-highlighted, so you can re-confirm or change your mind.

An important change happens here: each source of meaning now reveals its
**name** alongside the original description. For example,
you might see the label _"Social commitment"_ above the description _"I
intervene when I see injustice being done"_. This additional context
helps you make more deliberate choices.

Comparisons continue until the algorithm is confident in your top
selections — typically 5, but sometimes 3 or 4 if the remaining
positions are too close to call. Those become your final selection, and
you are taken to your results. A progress indicator shows roughly how
many comparisons are left. See [`ranking.md`](ranking.md) for the
full algorithm specification.

### Debug view

Append `?debug` to the prioritize page URL (for example
`/your-profile/prioritize?debug`) to reveal a debug panel below the
ranking UI. The panel shows the algorithm's current state — round, stop
reason, effective k, estimated remaining comparisons, the number of
near-optimal top-5 sets still in contention, and a per-card table of
exposures, wins, losses, and top-K membership — followed by the full
history of your comparisons as ordered pairs (e.g. `1. Honesty >
Freedom`) and a directed graph of the cards. A solid arrow A→B means
"you picked A over B directly"; a dashed line A⋯B (with a weight label)
means the algorithm implies A > B by transitive closure. Cards sharing
a tinted background belong to the same strongly connected component
(your preferences imply a cycle like A > B > … > A in that region).

## Step 3: Editing your selection

From the Examine page, you can click **Edit selection** to revisit your
choices at any time. The edit page shows all 26 sources of meaning in a
checklist. Selected ones are highlighted with a green border and a checked
checkbox; unselected ones are dimmed.

You can:

- **Check** any source of meaning to add it to your selection.
- **Uncheck** any source of meaning to remove it. If you have already
  examined one (answered reflection questions about it), you will be asked
  to confirm before removing it, since your examination answers would no
  longer appear on the results page.

Click **Done** to save your changes and return to the Examine page with
your updated selection.

## Convergence analysis

Visit `/ranking-convergence` to interactively see how many rounds
the ranking algorithm needs to reach confidence under various oracle
scenarios and parameter settings.
