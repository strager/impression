# Card Ranking Algorithm: Design Specification

## Goal

Identify a user's top-5 set from N cards (N ≤ 27), where N is determined by the previous Identify phase. Top-5 is treated as an unordered set. Comparisons are pairwise. Minimize the number of comparisons the user is asked to answer.

## Core data structure

A directed graph where nodes are cards and edges represent stated preferences. An edge A → B means "the user picked A over B in a direct comparison." Each pair of cards has at most one edge between them; pairs are never re-compared. The graph builds monotonically across the session — edges are only added, never removed or reversed.

Two derived structures, recomputed after every new edge:

**Weighted transitive closure.** A function W(X, Y) ∈ [0, 1] that says how strongly the data implies X > Y. Direct edges have weight 1.0. Transitive implications have weight < 1.0 that decays with path length and accumulates across multiple paths.

For a single simple path X → · · · → Y of length k (k edges), the path's weight is

w(k) = β^(k − 1)

with β = 0.3 by default. Direct edges (k = 1) get weight 1; a 2-edge implication gets 0.3; a 3-edge implication gets 0.09; and so on.

When several distinct simple paths from X to Y exist (e.g. X → C → Y and X → D → E → Y), each contributes its own weight pᵢ = β^(kᵢ − 1) and the combined weight is the probabilistic OR of the per-path weights — the chance that _at least one_ path's implication is correct:

W(X, Y) = 1 − ∏ᵢ (1 − pᵢ)

This makes the closure a _quantitative_ statement about evidence rather than a binary "implied / not implied" set. At session start the closure is empty (every off-diagonal weight is 0); as edges accumulate, every path through a freshly completed chain contributes a fresh pᵢ to the relevant W(X, Y).

In practice paths longer than ~8 edges have pᵢ < 1e‑3 and their contribution to the OR is negligible; the implementation truncates DFS at a depth bound and drops them.

**Strongly connected components (SCCs).** Computed via Tarjan's algorithm or equivalent on the _direct-edge_ graph (not the closure). Singleton SCCs are normal; SCCs of size ≥ 2 are cycles, indicating the user's stated preferences are intransitive in that region. The condensation (DAG of SCCs) gives the partial order the data actually supports.

## Selection algorithm

After each comparison, decide which pair to ask next by:

**Step 1: Filter to eligible pairs.** A pair (A, B) is eligible if:

- Neither A → B nor B → A exists as a direct edge.
- The closure weights in both directions are below a threshold τ (default 0.7) — i.e., max(W(A, B), W(B, A)) < τ. A weak transitive implication is still on the table because a direct comparison would substantially upgrade the evidence; only a strongly implied pair is skipped.

If no eligible pairs remain, the session terminates (see Termination). The algorithm deliberately does _not_ prune pairs whose endpoints look "decided" by the current partition analysis — that optimization conflates "the cost function says this is settled" with "we have actual evidence" and tends to cut sessions short before noise can surface as cycles or contradictory direct edges.

**Step 2: Score each eligible pair.** The score combines three additive terms:

score = w_b · boundary + w_c · decay(edges) · closure − w_s · sampling

1. **Boundary relevance.** Compute the current best top-5 set under min-disagreement-partition (see below). Then enumerate near-optimal alternatives — top-5 sets whose disagreement count is within a small tolerance of the optimum. A pair scores `boundary` equal to the count of near-optimal sets that split it (some include A and exclude B, or vice versa). Pairs that don't split any near-optimal set score 0 on this term — they can still win on closure expansion when the partition is essentially decided but more graph structure is needed (e.g., to resolve a boundary-straddling cycle).

2. **Closure expansion.** Estimate how much new evidence the closure would gain if the comparison resolves either way. A pair where both cards have many existing connections to disjoint subgraphs has high closure expansion (asking it chains together two regions of the graph). For direction A → B, the gain is approximated by enumerating pairs (a, b) where a ∈ {A} ∪ strong-ancestors(A) and b ∈ {B} ∪ strong-descendants(B) — "strong" meaning closure weight ≥ τ. For each such (a, b), assume a single-hop on each side (combined path length 1 + 1{a≠A} + 1{b≠B}) and credit the difference between the prob-OR-combined new weight and the existing W(a, b). The two directions A→B and B→A are summed. This is a heuristic approximation, not exact path enumeration; precision isn't critical because this term mainly serves to seed asks in regions of the graph the partition hasn't yet touched. The `decay(edges)` factor — e.g., `exp(−edges / (k·N))` — reduces this term's influence as the closure saturates.

3. **Sampling balance.** Mildly penalize pairs involving cards that have already been compared many times, to avoid the failure mode of re-asking about cards the user has clear opinions on. This is a soft penalty, not a hard cap — it only matters as a tiebreaker between otherwise equivalent pairs.

The exact weights (w_b, w_c, w_s) are a tuning knob to be set after observing real sessions in the visualization. A reasonable starting point: w_b = w_c = 1, w_s = 0.1 — boundary relevance and closure expansion contribute on roughly equal footing early, with closure expansion fading as edges accumulate, and sampling balance acting purely as a tiebreaker.

**Step 3: Pick the highest-scoring pair.** If multiple pairs tie, break ties by sampling balance, then arbitrarily.

## Min-disagreement-partition computation

This is the algorithm's notion of "best top-5 set given current data." For each candidate set S of size 5, sum the _closure weights_ W(B, A) over all pairs where A ∈ S and B ∉ S — i.e., the total "evidence weight" of contradictions to the partition:

cost(S) = Σ\_{A ∈ S, B ∉ S} W(B, A)

A direct contradiction (some non-top card was directly judged to beat a top card) contributes a full 1 to the cost. A long transitive contradiction contributes its β^(k−1) weight — so a partition that violates only long chains is penalized less than one that violates direct comparisons.

Two consequences fall out:

- Borderline partitions stay tied longer. More candidate top-5 sets remain near-optimal, which keeps boundary-relevance scoring finding pairs to ask about.
- Convergence shifts away from "the closure has no holes" and toward "the partition is stable" — see Termination.

The set with the minimum total cost is the current best top-5. With N ≤ 27, brute-force enumeration over C(N, 5) candidate sets is fast enough — at N=27, that's ~80,000 sets to evaluate per recomputation. With weighted contradictions, costs are real numbers rather than integers.

Track all sets within tolerance ε of the minimum (e.g., ε = 1, equivalent to "one full direct contradiction's worth"). These are the "near-optimal sets" the selection rule uses.

## Termination conditions

A `minTasks` floor (default: equal to `maxTasks`) gates the _early-exit_ paths — boundary stability and the unique-optimum form of irreducible-cycle detection. Below the floor, those checks are suppressed and the algorithm keeps probing pairs even when the analysis thinks it's done. The intent is to force enough comparisons that noise has a chance to surface as cycles or contradictory direct edges; with `minTasks = maxTasks` the algorithm always exhausts its budget. Tunable downward when efficiency matters more than noise robustness. The hard cap, "no eligible pairs", and the fallback irreducible-cycle path (which only fires when there are _no_ eligible pairs left at all) are _not_ gated by `minTasks` — those represent genuine impossibility of further work.

Per-card **exposure floors** gate the same early-exit paths as a separate, complementary check: every card must have appeared in at least `minExposuresPerCard` comparisons (default 2), and every card in the current optimal top-K must have appeared in at least `minExposuresTopK` comparisons (default 3). A unique optimum derived from only one sighting of a boundary card is suspect — a single fluky comparison can decide its placement — so we require at least one corroborating direct comparison for every card, and an extra one for cards we're about to declare top-K. Like `minTasks`, these floors only suppress the early-exit paths; the hard cap, "no eligible pairs", and the fallback irreducible-cycle path still fire when they apply.

The session ends when **any** of these is true:

1. **Boundary stability.** Only one top-5 set exists at the minimum disagreement cost, _and_ the cost gap from that optimum to the next-best set is at least ε (with default ε = 1, this means at least one full direct contradiction's worth of margin), _and_ there are no cycles touching the boundary region (defined as: no SCC of size ≥ 2 that contains both cards in the current top-5 and cards not in the current top-5). The margin gate is the key guard against premature exit: it ensures the optimum is separated from alternatives by something equivalent to a real direct comparison, not just a chain of decayed transitive contributions that happen to sum to a small fractional advantage. A single direct boundary edge (4→5 in a chain) is enough — its weight 1.0 ≥ ε. Pure transitive disambiguation (e.g., margin 0.3 from a length-2 path) is not. With weighted closure plus the margin gate, this is the dominant termination path.

2. **No eligible pairs remain.** Every remaining pair has been directly asked, or has closure weight ≥ τ in some direction. With weighted closure this is a much weaker (rarer) signal than under a binary closure, since weak implications stay eligible for as long as a direct comparison would meaningfully upgrade them. Unlike the boundary-stable / irreducible-cycle paths, this one is _not_ gated by `minTasks` — if there's nothing left to ask, we stop.

3. **Hard cap on comparisons.** A fixed budget — tunable. Default is `5N − 5` for N ≥ 10 (45 at N=10, 70 at N=15, 130 at N=27), with a piecewise floor at smaller N where `5N − 5` overshoots: 15 at N ≤ 6, 25 at N=7–8, 35 at N=9. The margin-gated boundary criterion needs more headroom than naive uniqueness to actually clear the gap on noisy data, so the cap sits comfortably above the expected convergence point rather than acting as a tight bound. If the cap is reached without earlier termination, accept the current best top-5 and surface to the user that some ambiguity remains.

4. **Irreducible cycle at the boundary.** If an SCC of size ≥ 2 straddles the boundary (contains both top-5 and non-top-5 cards under the current best partition) and additional comparisons within it would not break it (i.e., all internal pairs are already directly compared), the data is genuinely intransitive and no further pairwise comparisons can resolve it. Terminate and either pick a partition arbitrarily from the optima or surface the ambiguity to the user. This condition is checked twice: once inside the unique-optimum path (gated by `minTasks`), and once as a fallback when no eligible pair remains and an SCC still straddles the boundary (not gated, since "nothing left to ask" is a genuine stop).

## Cold start

Before any informative selection can happen, the graph needs initial edges. For the first few comparisons (suggested: ⌈N/4⌉, so ~7 for N=27), pick pairs that maximize _coverage_ — every card should appear in at least one early comparison before any card appears in a second. After this warmup, switch to the boundary-relevance-driven selection above.

## What to instrument for tuning

The algorithm has several tuning knobs that should be set empirically rather than guessed:

- The weighting between boundary relevance, closure expansion, and sampling balance in selection.
- The tolerance ε for what counts as "near-optimal" in the partition view.
- The hard cap on comparisons.
- The `minTasks` floor — how aggressively to suppress early exit in exchange for more noise robustness.
- The per-card exposure floors (`minExposuresPerCard`, `minExposuresTopK`) — minimum direct sightings required of any card / top-K card before convergence is allowed.
- The decay base β for path weights (default 0.3).
- The closure-weight eligibility threshold τ (default 0.7).

These should be tuned by running real sessions with the visualization and observing where the algorithm asks dumb questions or stops too early/late. The implementation should log enough state per session (graph at each step, candidate scores, chosen pair, whether the user's answer was the predicted one) to support this tuning.

## What's deliberately not in this design

- **No probabilistic model (BTL/Plackett-Luce).** The graph + closure + partition approach captures what we need without modeling assumptions about latent skill.
- **No edge weights from confidence.** Each edge represents one comparison and counts equally. If you find later that some users' early answers are noisier than their later ones, weights can be added — but start without them.
- **No re-comparison of pairs.** Each pair is asked at most once. This keeps the graph simple and avoids the question of how to reconcile contradictory answers from the same user.
- **No "settled card" pruning.** An earlier draft had a Settled/Unsettled card-state derivation that filtered out pairs whose endpoints were both consistently in (or out of) every near-optimal set. In practice this conflated _the cost function thinks this pair is decided_ with _we have direct evidence on this pair_, and let sessions exit before noise could surface as cycles. Eligibility is now purely structural: not directly asked, and closure weight below τ.
- **No ordering within the top-5.** The output is a set. If ordering is later wanted, it's a separate phase, not a modification of this algorithm.

## Output

When the session terminates, the algorithm returns:

1. The top-5 set (the optimal partition under min-disagreement).
2. The full comparison graph, for diagnostic and visualization use.
