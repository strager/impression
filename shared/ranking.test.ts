import { describe, expect, it } from "vitest";

import { Ranking } from "./ranking.ts";

function perfectOracle(strength: readonly number[]): (a: string, b: string) => { best: string; worst: string } {
	return (a, b) => {
		const ai = Number(a);
		const bi = Number(b);
		if (strength[ai] >= strength[bi]) return { best: a, worst: b };
		return { best: b, worst: a };
	};
}

function makeItems(n: number): string[] {
	return Array.from({ length: n }, (_, i) => String(i));
}

describe("Ranking — perfect oracle", () => {
	it("converges to the true top-5 on n=8 fully-ordered items", () => {
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const r = new Ranking(items, { k: 5, seed: 1 });
		while (!r.stopped) {
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		const top = new Set(r.topK);
		expect(top.size).toBe(5);
		for (let i = 0; i < 5; i++) {
			expect(top.has(String(i))).toBe(true);
		}
		expect(r.stopReason).toBe("boundary-stable");
	});

	it("stops without exceeding the hard cap", () => {
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const r = new Ranking(items, { k: 5, seed: 2, maxTasks: 30 });
		while (!r.stopped) {
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		expect(r.round).toBeLessThanOrEqual(30);
	});
});

describe("Ranking — cycle handling", () => {
	it("detects an SCC formed by a 3-cycle", () => {
		const r = new Ranking(["a", "b", "c", "d", "e", "f", "g"], { k: 5, seed: 3, maxTasks: 99 });
		// Force a 3-cycle a > b, b > c, c > a using the explicit-set form of recordTask.
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("c", "a", ["c", "a"]);
		const dbg = r.debugState();
		// Expect at least one SCC of size 3 (the cycle) plus some singletons.
		const big = dbg.sccs.filter((s) => s.length >= 3);
		expect(big.length).toBeGreaterThanOrEqual(1);
		const inCycle = new Set(big[0]);
		expect(inCycle.has("a")).toBe(true);
		expect(inCycle.has("b")).toBe(true);
		expect(inCycle.has("c")).toBe(true);
	});
});

describe("Ranking — weighted closure", () => {
	it("assigns β^(k-1) weight to a single transitive chain", () => {
		const r = new Ranking(["a", "b", "c", "d"], { k: 2, seed: 5, decayBeta: 0.3, maxPathLength: 8, maxTasks: 99 });
		// Chain a → b → c → d.
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("c", "d", ["c", "d"]);
		const dbg = r.debugState();
		// Closure should include implied weighted entries for non-direct pairs.
		const find = (a: string, b: string) => dbg.closureImplied.find((e) => e[0] === a && e[1] === b)?.[2];
		expect(find("a", "c")).toBeCloseTo(0.3, 6); // 2-edge path → β^1
		expect(find("a", "d")).toBeCloseTo(0.09, 6); // 3-edge path → β^2
		expect(find("b", "d")).toBeCloseTo(0.3, 6); // 2-edge path → β^1
	});

	it("combines multiple paths via probabilistic OR", () => {
		const r = new Ranking(["a", "b", "c", "d"], { k: 2, seed: 6, decayBeta: 0.3, maxPathLength: 8, maxTasks: 99 });
		// Two parallel 2-edge paths: a → b → d AND a → c → d. Expect W(a, d) = 1 - (1-0.3)^2 = 0.51.
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("a", "c", ["a", "c"]);
		r.recordTask("b", "d", ["b", "d"]);
		r.recordTask("c", "d", ["c", "d"]);
		const dbg = r.debugState();
		const wAd = dbg.closureImplied.find((e) => e[0] === "a" && e[1] === "d")?.[2];
		expect(wAd).toBeCloseTo(0.51, 6);
	});
});

describe("Ranking — undo round-trip", () => {
	it("returns to the prior state after recordTask + undoLastTask", () => {
		const n = 6;
		const items = makeItems(n);
		const r = new Ranking(items, { k: 3, seed: 4, maxTasks: 99 });
		// Record a couple of tasks first.
		r.recordTask("0", "1", ["0", "1"]);
		r.recordTask("2", "3", ["2", "3"]);
		const beforeRound = r.round;
		const beforeTop = [...r.topK];
		const beforeDebug = r.debugState();
		const beforeEdgeCount = beforeDebug.edges.length;

		r.recordTask("4", "5", ["4", "5"]);
		expect(r.round).toBe(beforeRound + 1);

		r.undoLastTask();
		expect(r.round).toBe(beforeRound);
		expect([...r.topK]).toEqual(beforeTop);
		expect(r.debugState().edges.length).toBe(beforeEdgeCount);
	});
});

describe("Ranking — margin gate on boundary stability", () => {
	it("does not terminate when the cost margin is below epsilon (pure-transitive separation)", () => {
		// Chain a→b→c, k=1. After both edges:
		//   cost({a}) = 0 (unique optimum)
		//   cost({b}) = W(a,b) = 1
		//   cost({c}) = W(a,c) + W(b,c) = 0.3 + 1 = 1.3
		// So the margin from the optimum to the next-best is 1.0. With ε = 1.5,
		// the gate is NOT cleared and the algorithm should keep going.
		const r = new Ranking(["a", "b", "c"], { k: 1, seed: 1, epsilon: 1.5, minTasks: 0, minExposuresPerCard: 0, minExposuresTopK: 0, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		expect(r.stopped).toBe(false);
	});

	it("does terminate boundary-stable when the margin clears epsilon", () => {
		// Same chain, but with ε = 1.0 the margin (1.0) is exactly at the gate.
		const r = new Ranking(["a", "b", "c"], { k: 1, seed: 1, epsilon: 1, minTasks: 0, minExposuresPerCard: 0, minExposuresTopK: 0, minWinsTopK: 0, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		expect(r.stopped).toBe(true);
		expect(r.stopReason).toBe("boundary-stable");
	});
});

describe("Ranking — irreducible-cycle termination", () => {
	it("stops with irreducible-cycle when a boundary-straddling SCC has all internal pairs compared", () => {
		// Cycle a→b→c→a with k=2: top-2 candidates {a,b}, {a,c}, {b,c} all tie at the same
		// weighted cost (the SCC sits across the boundary regardless of the partition).
		// All three internal pairs are direct edges, so no eligible pair remains.
		// minTasks=3 prevents the boundary-stable check from firing after the first two edges
		// (which look linear until the cycle closes).
		const r = new Ranking(["a", "b", "c"], { k: 2, seed: 1, minTasks: 3, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("c", "a", ["c", "a"]);
		expect(r.stopped).toBe(true);
		expect(r.stopReason).toBe("irreducible-cycle");
	});
});

describe("Ranking — no-eligible-pairs termination", () => {
	it("stops with no-eligible-pairs when all pairs are compared but the margin does not clear epsilon", () => {
		// N=2, k=1, one direct edge → optimum {a} unique with margin 1. With ε=2 the
		// boundary-stable gate fails, no SCC exists, and the only pair is already compared.
		const r = new Ranking(["a", "b"], { k: 1, seed: 1, epsilon: 2, minTasks: 0, minExposuresPerCard: 0, minExposuresTopK: 0, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		expect(r.stopped).toBe(true);
		expect(r.stopReason).toBe("no-eligible-pairs");
	});
});

describe("Ranking — cold-start coverage", () => {
	it("does not double-expose any card while some card has zero exposure", () => {
		const n = 10;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const r = new Ranking(items, { k: 5, seed: 7, maxTasks: 99 });
		const warmupCount = Math.ceil(n / 4);
		for (let step = 0; step < warmupCount; step++) {
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
			const exposures = r.debugState().exposures;
			const minE = Math.min(...exposures);
			const maxE = Math.max(...exposures);
			if (minE === 0) {
				// Spec: every card should appear at least once before any appears twice.
				expect(maxE).toBeLessThanOrEqual(1);
			}
		}
	});
});

describe("Ranking — minTasks gate", () => {
	it("suppresses early boundary-stable exit until minTasks is reached", () => {
		// With a perfect linear oracle on n=8, boundary stability would normally fire well
		// before round 15 (a couple of well-placed edges separate the top-5 cleanly).
		// minTasks=15 must keep the algorithm asking.
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const minTasks = 15;
		const r = new Ranking(items, { k: 5, seed: 1, minTasks, maxTasks: 99 });
		// Step through up to minTasks rounds; the algorithm must not stop before then.
		while (r.round < minTasks) {
			expect(r.stopped).toBe(false);
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		expect(r.round).toBeGreaterThanOrEqual(minTasks);
	});
});

describe("Ranking — per-card exposure floor", () => {
	it("suppresses boundary-stable exit while a card has fewer than minExposuresPerCard appearances", () => {
		// Chain a→b→c→d with k=1. After 3 edges the optimum is uniquely {a} with a margin of
		// 1.0 ≥ ε. With minExposuresPerCard=0 it would terminate boundary-stable here.
		// With the default floor of 2, cards a and d only have 1 appearance, so the early-exit
		// path must stay suppressed.
		const r = new Ranking(["a", "b", "c", "d"], { k: 1, seed: 1, epsilon: 1, minTasks: 0, minExposuresTopK: 0, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("c", "d", ["c", "d"]);
		expect(r.stopped).toBe(false);
	});

	it("suppresses boundary-stable exit while a top-K card has fewer than minExposuresTopK appearances", () => {
		// Same chain; the base per-card floor is satisfied by adding b↔d, but top-K card a still
		// only has 1 appearance, below the default top-K floor of 3.
		const r = new Ranking(["a", "b", "c", "d"], { k: 1, seed: 1, epsilon: 1, minTasks: 0, minExposuresPerCard: 0, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("c", "d", ["c", "d"]);
		// After this, the optimum is uniquely {a} with margin ≥ ε, but a has only 1 exposure.
		expect(r.stopped).toBe(false);
	});

	it("terminates boundary-stable once the floors are met", () => {
		// Chain a→b→c→d plus a→c and a→d gives a 3 exposures and the rest 2+, satisfying both
		// the per-card floor (2) and the top-K floor (3 for {a}).
		const r = new Ranking(["a", "b", "c", "d"], { k: 1, seed: 1, epsilon: 1, minTasks: 0, maxTasks: 99 });
		r.recordTask("a", "b", ["a", "b"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("c", "d", ["c", "d"]);
		r.recordTask("a", "c", ["a", "c"]);
		r.recordTask("a", "d", ["a", "d"]);
		expect(r.stopped).toBe(true);
		expect(r.stopReason).toBe("boundary-stable");
	});
});

describe("Ranking — selection prioritizes boundary-relevant pairs", () => {
	it("picks the pair that splits the most near-optimal sets", () => {
		// Setup: a and b both beat c and d directly, but a vs b is unknown.
		// With ε=2 the near-optimal sets are {a,b}, {a,c}, {a,d}, {b,c}, {b,d} (cost 0 or 1).
		// (a, b) splits 4 of those sets; (c, d) also splits 4, but (a, b)'s endpoints have
		// lower sampling exposure (0+0 vs 2+2), so the sampling tiebreaker favors it.
		const r = new Ranking(["a", "b", "c", "d"], { k: 2, seed: 1, epsilon: 2, minTasks: 99, maxTasks: 99 });
		r.recordTask("a", "c", ["a", "c"]);
		r.recordTask("a", "d", ["a", "d"]);
		r.recordTask("b", "c", ["b", "c"]);
		r.recordTask("b", "d", ["b", "d"]);
		expect(r.stopped).toBe(false);
		const { items: pair } = r.selectTask();
		const picked = new Set(pair);
		expect(picked.has("a") && picked.has("b")).toBe(true);
	});
});

describe("Ranking — clone", () => {
	it("clone reproduces public state and the same next selectTask", () => {
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const r = new Ranking(items, { k: 5, seed: 13, maxTasks: 99 });
		// Run a handful of rounds — past warmup, into score-driven territory.
		for (let i = 0; i < 6; i++) {
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		const copy = r.clone();
		expect(copy.round).toBe(r.round);
		expect(copy.stopped).toBe(r.stopped);
		expect(copy.stopReason).toBe(r.stopReason);
		expect(copy.effectiveK).toBe(r.effectiveK);
		expect([...copy.topK]).toEqual([...r.topK]);
		// With the RNG-determinism fix in _pickNextPair, original and clone must agree on
		// the next pair — verifies clone preserves the RNG state that drives tie-breaks.
		expect(copy.selectTask().items).toEqual(r.selectTask().items);
	});
});

describe("Ranking — fallback prefers kMax when stable", () => {
	it("with minTasks=maxTasks, returns K=kMax (not kMax-1) on clean data", () => {
		// minTasks=maxTasks forces full budget. Mid-session check is blocked the entire run;
		// termination goes through the no-eligible-pairs or max-tasks path → fallback. The
		// fallback must check K=kMax first (not start at kMax-1) — otherwise it grabs the
		// uniquely-stable K=kMax-1 set and reports K=4 when K=5 is also uniquely stable.
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const budget = 5 * n - 5;
		const r = new Ranking(items, { k: 5, seed: 1, minTasks: budget, maxTasks: budget });
		while (!r.stopped) {
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		expect(r.effectiveK).toBe(5);
		const top = new Set(r.topK);
		for (let i = 0; i < 5; i++) expect(top.has(String(i))).toBe(true);
	});
});

describe("Ranking — variable K range", () => {
	// Scenario: n=6, all 14 pairs except (e, f) compared. Top-4 {a,b,c,d} is uniquely optimal
	// (any partition that drops one of them pays ≥ 1.0 in direct contradictions). K=5 has two
	// tied optima — {a,b,c,d,e} and {a,b,c,d,f} both cost 0 — and the only pair that would
	// disambiguate (e vs f) is never reached because the comparison budget is exhausted first.
	const ambiguousFifthPairs: [string, string][] = [
		["a", "b"], ["a", "c"], ["a", "d"], ["a", "e"], ["a", "f"],
		["b", "c"], ["b", "d"], ["b", "e"], ["b", "f"],
		["c", "d"], ["c", "e"], ["c", "f"],
		["d", "e"], ["d", "f"],
	];

	it("falls back to top-4 at max-tasks when top-5 is ambiguous (default kMin=3)", () => {
		const items = ["a", "b", "c", "d", "e", "f"];
		const r = new Ranking(items, { k: 5, seed: 1, maxTasks: 14 });
		for (const [best, worst] of ambiguousFifthPairs) {
			if (r.stopped) break;
			r.recordTask(best, worst, [best, worst]);
		}
		expect(r.stopped).toBe(true);
		// Stop reason reflects the trigger (max-tasks), not the fact that the fallback found a
		// stable K=4 — "boundary-stable" stays reserved for mid-session firings.
		expect(r.stopReason).toBe("max-tasks");
		expect(r.effectiveK).toBe(4);
		expect(new Set(r.topK)).toEqual(new Set(["a", "b", "c", "d"]));
	});

	it("kMin overridden to kMax: no fallback, terminates with max-tasks at kMax", () => {
		const items = ["a", "b", "c", "d", "e", "f"];
		const r = new Ranking(items, { k: 5, kMin: 5, seed: 1, maxTasks: 14 });
		for (const [best, worst] of ambiguousFifthPairs) {
			if (r.stopped) break;
			r.recordTask(best, worst, [best, worst]);
		}
		expect(r.stopped).toBe(true);
		expect(r.stopReason).toBe("max-tasks");
		expect(r.effectiveK).toBe(5);
		expect(r.topK.length).toBe(5);
	});

	it("prefers kMax when the full top-kMax stabilizes naturally", () => {
		// Fully ordered chain; K=5 converges cleanly and the K range doesn't affect output.
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const r = new Ranking(items, { k: 5, seed: 1 });
		while (!r.stopped) {
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		expect(r.stopReason).toBe("boundary-stable");
		expect(r.effectiveK).toBe(5);
		const top = new Set(r.topK);
		for (let i = 0; i < 5; i++) expect(top.has(String(i))).toBe(true);
	});
});

describe("Ranking — estimateRemaining", () => {
	it("stays within [0, budget] and reaches 0 when stopped", () => {
		const n = 8;
		const items = makeItems(n);
		const strength = Array.from({ length: n }, (_, i) => n - i);
		const oracle = perfectOracle(strength);
		const maxTasks = 50;
		const r = new Ranking(items, { k: 5, seed: 21, maxTasks });
		while (!r.stopped) {
			const est = r.estimateRemaining();
			expect(est).not.toBeNull();
			expect(est!).toBeGreaterThanOrEqual(0);
			expect(est!).toBeLessThanOrEqual(maxTasks);
			const { items: pair } = r.selectTask();
			const { best, worst } = oracle(pair[0], pair[1]);
			r.recordTask(best, worst);
		}
		expect(r.estimateRemaining()).toBe(0);
	});
});
