# Card Ranking Algorithm: Design Specification

## Goal

Identify a user's top-K set from N cards (N ≤ 27), where K is configurable as a range `[kMin, kMax]` (default `[3, 5]`) and N is determined by the previous Identify phase. The algorithm returns the largest K in the range whose boundary is stable given the user's answers; in clean data it converges on `kMax`, while genuinely ambiguous boundaries fall back to a smaller K with clean partition structure. Top-K is treated as an unordered set. Comparisons are pairwise. Minimize the number of comparisons the user is asked to answer.

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

score = w_b · (boundary + wins_deficit_boost) + w_c · decay(edges) · closure − w_s · sampling

1. **Boundary relevance.** Compute the current best top-K set for *every* K in `[kMin, kMax]` under min-disagreement-partition (see below). Concatenate the near-optimal sets across all K's into one pool. A pair scores `boundary` equal to the count of pooled near-optimal sets that split it (some include A and exclude B, or vice versa). Aggregating across K's means a pair that disambiguates the K=4 boundary contributes too, not just K=kMax — important because a smaller K is an acceptable termination outcome.

   A small **wins-deficit boost** is added to the boundary term: each endpoint that's in the current K=kMax strict optimum but hasn't yet met the wins floor (see Termination) counts as one extra virtual split. Without this boost the algorithm would stop probing the K=kMax boundary the moment the partition was uniquely decided, and the wins floor would never be reached.

2. **Closure expansion.** Estimate how much new evidence the closure would gain if the comparison resolves either way. A pair where both cards have many existing connections to disjoint subgraphs has high closure expansion (asking it chains together two regions of the graph). For direction A → B, the gain is approximated by enumerating pairs (a, b) where a ∈ {A} ∪ strong-ancestors(A) and b ∈ {B} ∪ strong-descendants(B) — "strong" meaning closure weight ≥ τ. For each such (a, b), assume a single-hop on each side (combined path length 1 + 1{a≠A} + 1{b≠B}) and credit the difference between the prob-OR-combined new weight and the existing W(a, b). The two directions A→B and B→A are summed. This is a heuristic approximation, not exact path enumeration; precision isn't critical because this term mainly serves to seed asks in regions of the graph the partition hasn't yet touched. The `decay(edges)` factor — `exp(−edges / (k·N))` — reduces this term's influence as the closure saturates.

3. **Sampling balance.** Mildly penalize pairs involving cards that have already been compared many times, to avoid the failure mode of re-asking about cards the user has clear opinions on. This is a soft penalty, not a hard cap — it only matters as a tiebreaker between otherwise equivalent pairs.

The default weights are w_b = w_c = 1, w_s = 0.1 — boundary relevance and closure expansion contribute on roughly equal footing early, with closure expansion fading as edges accumulate, and sampling balance acting purely as a tiebreaker.

**Step 3: Pick the highest-scoring pair.** If multiple pairs tie, break ties by sampling balance, then RNG.

## Min-disagreement-partition computation

This is the algorithm's notion of "best top-K set given current data," computed independently for each K in `[kMin, kMax]`. For each candidate set S of size K, sum the _closure weights_ W(B, A) over all pairs where A ∈ S and B ∉ S — i.e., the total "evidence weight" of contradictions to the partition:

cost(S) = Σ\_{A ∈ S, B ∉ S} W(B, A)

A direct contradiction (some non-top card was directly judged to beat a top card) contributes a full 1 to the cost. A long transitive contradiction contributes its β^(k−1) weight — so a partition that violates only long chains is penalized less than one that violates direct comparisons.

Two consequences fall out:

- Borderline partitions stay tied longer. More candidate top-K sets remain near-optimal, which keeps boundary-relevance scoring finding pairs to ask about.
- Convergence shifts away from "the closure has no holes" and toward "the partition is stable" — see Termination.

The set with the minimum total cost is the current best top-K at that K. With N ≤ 27 and K ≤ 5, brute-force enumeration over C(N, K) candidate sets is fast enough — at N=27, K=5 that's ~80,000 sets to evaluate per K per recomputation.

For each K, two derived collections are tracked:

- **Strict optima**: sets within `optEps` (≈ 1e-9) of the minimum — used by the unique-optimum termination check.
- **Near-optimal sets**: sets within tolerance ε of the minimum (default ε = 1, equivalent to "one full direct contradiction's worth"). These drive the selection rule's boundary scoring.

The cost gap between the strict optimum and the next strictly-worse set is the **margin** for that K — used by the boundary-stable termination check to guard against pure-transitive disambiguation.

## Termination conditions

Mid-session termination only checks K=kMax. Smaller K's stabilize easily (e.g. K=3 becomes unique long before K=5 has the evidence to disambiguate), so checking them mid-session would terminate prematurely with a too-small set. A smaller K is offered via a fallback path only at "stuck" exits — when no useful comparisons remain or the hard cap is hit.

Three gates guard the K=kMax mid-session check:

- **`minTasks` floor** (default 0 = no floor). Below this round count, mid-session checks are suppressed and the algorithm keeps probing pairs even when the analysis thinks it's done. Tunable upward to force more rounds — useful when the cost function is converging on noise.
- **Per-card exposure floors.** Every card must have appeared in at least `minExposuresPerCard` comparisons (default 2), and every card in the current optimal top-K must have appeared in at least `minExposuresTopK` comparisons (default 3). A unique optimum derived from only one sighting of a boundary card is suspect — a single fluky comparison can decide its placement.
- **Per-card wins floor** (`minWinsTopK`, default 2). Every card in the proposed top-K must have *directly beaten* at least `min(minWinsTopK, n − K)` other cards. Clamping to `n − K` keeps the floor achievable for small N: a top-K card can only directly beat cards outside the K, so the maximum possible wins is `n − K`. This adds a per-card credibility check beyond raw exposure — a card that's been compared but never won shouldn't credibly anchor a top-K slot.

All three floors suppress only the mid-session check. The hard cap, "no eligible pairs", and the fallback irreducible-cycle path still fire when they apply (those represent genuine impossibility of further work).

The session ends when **any** of these is true:

1. **Boundary stability (mid-session, K=kMax).** All of the following hold for the K=kMax partition:
   - Exactly one set at the strict-optimum cost (unique optimum).
   - Cost gap to the next-strictly-worse set is at least ε (default ε = 1, equivalent to at least one full direct contradiction's worth of margin).
   - All gates above (`minTasks`, exposure floors, wins floor) are cleared.
   - No SCC of size ≥ 2 straddles the K=kMax boundary (no cycle containing both top-K and non-top-K cards).

   The margin gate is the key guard against premature exit: it ensures the optimum is separated from alternatives by something equivalent to a real direct comparison, not just a chain of decayed transitive contributions that happen to sum to a small fractional advantage. A single direct boundary edge (4→5 in a chain) is enough — its weight 1.0 ≥ ε. Pure transitive disambiguation (e.g., margin 0.3 from a length-2 path) is not.

2. **Irreducible cycle at the K=kMax boundary (mid-session).** Same gates as boundary-stable, but an SCC of size ≥ 2 straddles the boundary and additional comparisons within it would not break it (all internal pairs are already directly compared). The data is genuinely intransitive and no further pairwise comparisons can resolve it.

3. **Hard cap on comparisons (`maxTasks`).** Default `max(15, 5N − 5)` — 15 at N ≤ 4, 20 at N=5, 25 at N=6, 30 at N=7, …, 130 at N=27. The margin-gated boundary criterion needs headroom to clear the gap on noisy data, so the cap sits above the expected convergence point.

4. **No eligible pairs remain.** Every remaining pair has been directly asked, or has closure weight ≥ τ in some direction.

When the hard cap or no-eligible-pairs trigger fires, the **smaller-K fallback** runs: search K from kMax down to kMin and accept the largest K with a unique optimum at cost ≥ ε margin and no boundary-straddling SCC. Exposure and wins floors are deliberately *not* applied at the fallback — we're forced to stop anyway, so accepting a K that just barely missed the mid-session floors beats reporting an ambiguous result. The fallback starts at kMax (not kMax-1): if mid-session was blocked only by floors but kMax otherwise satisfies the looser fallback criteria, that's the answer.

The stop reason reported through the API reflects what actually *triggered* termination, not what the fallback ultimately accepted:

- `"boundary-stable"`: mid-session check fired (all floors cleared, K=kMax confirmed).
- `"irreducible-cycle"`: mid-session cycle-irreducibility fired, *or* no-eligible-pairs fired with a cycle straddling K=kMax.
- `"max-tasks"`: hard cap hit. Effective K may be < kMax if the fallback found a smaller stable K.
- `"no-eligible-pairs"`: ran out of pairs without a cycle at K=kMax. Effective K may be < kMax via fallback.

So `"boundary-stable"` always means "the algorithm actively decided the boundary was stable mid-session with full floors satisfied" — never a fallback firing.

## Cold start

Before any informative selection can happen, the graph needs initial edges. For the first few comparisons (suggested: ⌈N/4⌉, so ~7 for N=27), pick pairs that maximize _coverage_ — every card should appear in at least one early comparison before any card appears in a second. After this warmup, switch to the boundary-relevance-driven selection above.

## What to instrument for tuning

The algorithm has several tuning knobs that should be set empirically rather than guessed. The convergence visualization at `/ranking-convergence` runs the algorithm against synthetic oracles (perfect, noisy, random-bottom, mushy, reversal) at various N and exposes most of these as live inputs:

- **K range** (`kMin`, `kMax`) — the output size range. Default `[3, 5]`.
- **Selection weights** (`weightBoundary`, `weightClosure`, `weightSampling`) — defaults 1, 1, 0.1.
- **`epsilon`** — near-optimal tolerance for the partition view. Default 1.
- **`maxTasks`** — hard cap. Default `max(15, 5N − 5)`.
- **`minTasks`** — floor on mid-session early-exit. Default 0.
- **Per-card exposure floors** (`minExposuresPerCard`, `minExposuresTopK`) — minimum direct sightings per card / top-K card. Defaults 2, 3.
- **Per-card wins floor** (`minWinsTopK`) — minimum direct wins per top-K card, clamped to `n − K`. Default 2.
- **`decayBeta`** — path-weight decay base. Default 0.3.
- **`closureWeightThreshold`** (τ) — closure-weight eligibility threshold. Default 0.7.
- **`coldStartFraction`** — fraction of N used for warmup. Default 0.25.

The convergence harness logs round count, effective K, stop reason, and remaining-estimate trajectory per seed; the per-session debug panel in the prioritize UI shows the graph and partition state at each step.

See `docs/ideas.md` for design alternatives that were considered and rejected (with reasons), including stable-core intersection, hysteresis, output-time trimming, and pair re-asking.

## What's deliberately not in this design

- **No probabilistic model (BTL/Plackett-Luce).** The graph + closure + partition approach captures what we need without modeling assumptions about latent skill.
- **No edge weights from confidence.** Each edge represents one comparison and counts equally. If you find later that some users' early answers are noisier than their later ones, weights can be added — but start without them.
- **No re-comparison of pairs.** Each pair is asked at most once. This keeps the graph simple and avoids the question of how to reconcile contradictory answers from the same user.
- **No "settled card" pruning.** An earlier draft had a Settled/Unsettled card-state derivation that filtered out pairs whose endpoints were both consistently in (or out of) every near-optimal set. In practice this conflated _the cost function thinks this pair is decided_ with _we have direct evidence on this pair_, and let sessions exit before noise could surface as cycles. Eligibility is now purely structural: not directly asked, and closure weight below τ.
- **No ordering within the top-5.** The output is a set. If ordering is later wanted, it's a separate phase, not a modification of this algorithm.

## Output

When the session terminates, the algorithm returns:

1. The top-K set, where K is the `effectiveK` chosen by the termination logic (the largest stable K in `[kMin, kMax]`).
2. The stop reason indicating how termination was triggered (see Termination conditions).
3. The full comparison graph, for diagnostic and visualization use.
