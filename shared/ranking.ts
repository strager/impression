// ============================================================
// Active Ranking via Pairwise Comparisons + Graph Closure
// ============================================================
//
// Identifies the top K items from N items through pairwise
// comparisons. Maintains a directed preference graph; derived
// transitive closure and SCCs drive selection and termination.
// See docs/ranking.md for the design specification.
// ============================================================

import { enumerateCombinations, makeXorshift } from "./ranking-math.ts";
import type { XorshiftRng } from "./ranking-math.ts";

export type StopReason = "boundary-stable" | "no-eligible-pairs" | "irreducible-cycle" | "max-tasks";

export interface RankingConfig {
	/** Number of top items to identify. Default 5. */
	k: number;
	/** Hard cap on total comparisons. Default 5N - 5 for N ≥ 10 (with a piecewise floor below). 0 → use n-dependent default. */
	maxTasks: number;
	/** Floor on total comparisons before any early-termination (boundary-stable / irreducible-cycle) can fire. Default 0 → match maxTasks (force exhaustion of the budget). */
	minTasks: number;
	/** Tolerance (in contradiction-weight units) for "near-optimal" in the partition view. Default 1. */
	epsilon: number;
	/** Weight on boundary-relevance term in scoring. Default 1. */
	weightBoundary: number;
	/** Weight on closure-expansion term in scoring (multiplied by a decay over edges). Default 1. */
	weightClosure: number;
	/** Weight on sampling balance penalty (acts as a tiebreaker). Default 0.1. */
	weightSampling: number;
	/** Fraction of N used for the warmup/coverage phase. Default 0.25 (⌈N/4⌉). */
	coldStartFraction: number;
	/** Decay base for transitive path weights. Path of length k has weight β^(k-1). Default 0.3. */
	decayBeta: number;
	/** Pairs with closure weight (in either direction) above this threshold are skipped. Default 0.7. */
	closureWeightThreshold: number;
	/** DFS depth bound for closure path enumeration. Default 8 (β^7 ≈ 2e-4 with default β=0.3). */
	maxPathLength: number;
	/** RNG seed. Default Date.now(). */
	seed: number;
}

export interface PairRecord<T> {
	set: [T, T];
	best: T;
	worst: T;
}

const DEFAULT_CONFIG: RankingConfig = {
	k: 5,
	maxTasks: 0,
	minTasks: 0,
	epsilon: 1,
	weightBoundary: 1,
	weightClosure: 1,
	weightSampling: 0.1,
	coldStartFraction: 0.25,
	decayBeta: 0.3,
	closureWeightThreshold: 0.7,
	maxPathLength: 8,
	seed: 0,
};

export interface RankingDebugState<T> {
	edges: readonly (readonly [T, T])[];
	/** Implied pairs with their weighted closure (only those with weight in (0, 1)). */
	closureImplied: readonly (readonly [T, T, number])[];
	sccs: readonly (readonly T[])[];
	bestTopK: readonly T[];
	nearOptimalCount: number;
	exposures: readonly number[];
	config: RankingConfig;
	round: number;
}

/**
 * Pair-based active ranking using a preference graph + transitive closure.
 *
 * Usage:
 *   const ranking = new Ranking(items);
 *   while (!ranking.stopped) {
 *     const { items: pair } = ranking.selectTask();
 *     // ask user which they prefer
 *     ranking.recordTask(winner, loser);
 *   }
 *   console.log(ranking.topK);
 */
export class Ranking<T> {
	private readonly _items: readonly T[];
	private readonly _indexByItem: Map<T, number>;
	private readonly _config: RankingConfig;
	private readonly _n: number;
	private readonly _seed: number;

	// Direct edges as N×N flat (1 = winner→loser exists).
	private _edge: Uint8Array;

	private _exposures: number[];
	private _records: PairRecord<T>[];
	private _pendingTask: [number, number] | null;

	private _rng: XorshiftRng;

	private _closureW: Float64Array;
	private _sccs: number[][];
	private _optimalSets: number[][];
	private _bestSets: number[][];
	// Termination requires this margin ≥ ε so weak transitive disambiguation alone can't end the session.
	private _costMargin: number;

	// Cached C(n, k) — depends only on (n, k), which are fixed for an instance.
	private readonly _combinations: number[][];

	private _stopped: boolean;
	private _stopReason: StopReason | null;
	private _effectiveK: number;

	constructor(items: readonly T[], config?: Partial<RankingConfig>) {
		this._items = items;
		this._indexByItem = new Map();
		for (let i = 0; i < items.length; i++) this._indexByItem.set(items[i], i);
		if (this._indexByItem.size !== items.length) {
			throw new Error("Ranking items must be unique");
		}
		this._config = { ...DEFAULT_CONFIG, ...config };
		if (this._config.seed === 0) {
			this._config.seed = Date.now();
		}
		this._n = items.length;
		if (this._config.maxTasks === 0) {
			// 5n - 5 for n ≥ 10 (45 at n=10, 70 at n=15, 130 at n=27); piecewise floor
			// for smaller n where 5n - 5 overshoots — the boundary problem is too small
			// to need that much budget when k is close to n.
			if (this._n <= 6) this._config.maxTasks = 15;
			else if (this._n <= 8) this._config.maxTasks = 25;
			else if (this._n === 9) this._config.maxTasks = 35;
			else this._config.maxTasks = 5 * this._n - 5;
		}
		this._seed = this._config.seed;
		this._rng = makeXorshift(this._seed);

		this._edge = new Uint8Array(this._n * this._n);
		this._exposures = new Array<number>(this._n).fill(0);
		this._records = [];
		this._pendingTask = null;

		this._closureW = new Float64Array(this._n * this._n);
		this._sccs = [];
		for (let i = 0; i < this._n; i++) this._sccs.push([i]);
		this._optimalSets = [];
		this._bestSets = [];
		this._costMargin = Infinity;

		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = Math.min(this._config.k, this._n);

		const ek = Math.min(this._config.k, this._n);
		this._combinations = ek > 0 && ek <= this._n ? enumerateCombinations(this._n, ek) : [];

		// Trivial case: k >= n.
		if (this._config.k >= this._n) {
			this._stopped = true;
			this._stopReason = "boundary-stable";
		}

		this._recomputeDerived();
	}

	// -----------------------------------------------------------
	// Public API
	// -----------------------------------------------------------

	selectTask(): { items: [T, T] } {
		if (this._stopped) {
			throw new Error("Ranking has already stopped");
		}
		if (this._pendingTask !== null) {
			return { items: [this._items[this._pendingTask[0]], this._items[this._pendingTask[1]]] };
		}
		const pair = this._pickNextPair();
		if (pair === null) {
			// Should have been caught by termination, but be defensive.
			throw new Error("No eligible pair available; ranking should have stopped");
		}
		this._pendingTask = pair;
		return { items: [this._items[pair[0]], this._items[pair[1]]] };
	}

	recordTask(best: T, worst: T, set?: readonly T[]): { stopped: boolean; stopReason: StopReason | null } {
		if (this._stopped) {
			throw new Error("Ranking has already stopped");
		}
		const bi = this._indexOf(best);
		const wi = this._indexOf(worst);
		if (bi === wi) {
			throw new Error("best and worst must differ");
		}

		// Honor optional explicit set; otherwise auto-pick if no pending task.
		if (set !== undefined) {
			if (set.length !== 2) {
				throw new Error("Ranking expects pairs; set must have length 2");
			}
			const a = this._indexOf(set[0]);
			const b = this._indexOf(set[1]);
			if (!((a === bi && b === wi) || (a === wi && b === bi))) {
				throw new Error("best/worst do not match the provided set");
			}
			this._pendingTask = [a, b];
			// Match the one RNG step that live runs consume in _pickNextPair, so replay
			// stays synchronized.
			this._rng.next();
		} else if (this._pendingTask === null) {
			const pair = this._pickNextPair();
			if (pair === null) {
				throw new Error("No eligible pair available; ranking should have stopped");
			}
			this._pendingTask = pair;
		}

		const pending = this._pendingTask;
		this._records.push({
			set: [this._items[pending[0]], this._items[pending[1]]],
			best,
			worst,
		});

		this._addEdge(bi, wi);
		this._exposures[bi]++;
		this._exposures[wi]++;
		this._pendingTask = null;

		this._recomputeDerived();
		this._checkTermination();

		return { stopped: this._stopped, stopReason: this._stopReason };
	}

	undoLastTask(): PairRecord<T> {
		if (this._records.length === 0) {
			throw new Error("No task to undo");
		}
		const last = this._records[this._records.length - 1];
		const newRecords = this._records.slice(0, -1);
		this._resetWithoutRecompute();
		for (const r of newRecords) {
			const bi = this._indexOf(r.best);
			const wi = this._indexOf(r.worst);
			this._records.push({ set: [r.set[0], r.set[1]], best: r.best, worst: r.worst });
			this._addEdge(bi, wi);
			this._exposures[bi]++;
			this._exposures[wi]++;
			// Match the one RNG step live _pickNextPair consumes per task.
			this._rng.next();
		}
		this._recomputeDerived();
		this._checkTermination();
		return last;
	}

	clone(): Ranking<T> {
		const copy = new Ranking(this._items, { ...this._config });
		for (const r of this._records) {
			copy.recordTask(r.best, r.worst, r.set);
		}
		return copy;
	}

	estimateRemaining(): number | null {
		if (this._stopped) return 0;
		const budget = this._config.maxTasks - this._records.length;
		// Floor: we can't exit before minTasks, regardless of how clean the partition looks.
		const minGap = Math.max(0, this._config.minTasks - this._records.length);
		// Disambiguation: each near-optimal set roughly costs one well-placed comparison
		// to push out of contention (since each direct edge contributes ~1.0 to cost differential).
		// Plus margin-clearing: if costMargin < ε, we need additional comparisons to widen the gap.
		const ambig = this._bestSets.length;
		const ambigEstimate = ambig <= 1 ? 1 : ambig - 1;
		const marginGap = Math.max(0, this._config.epsilon - this._costMargin);
		const ambigPlusMargin = ambigEstimate + Math.ceil(marginGap);
		return Math.min(budget, Math.max(minGap, ambigPlusMargin));
	}

	get topK(): readonly T[] {
		const ek = Math.min(this._effectiveK, this._n);
		const set = this._optimalSets.length > 0 ? this._optimalSets[0] : this._fallbackTopK(ek);
		return set.slice(0, ek).map((i) => this._items[i]);
	}

	get effectiveK(): number {
		return this._effectiveK;
	}

	get round(): number {
		return this._records.length;
	}

	get stopped(): boolean {
		return this._stopped;
	}

	get stopReason(): StopReason | null {
		return this._stopReason;
	}

	get history(): readonly PairRecord<T>[] {
		return this._records;
	}

	get maxTasks(): number {
		return this._config.maxTasks;
	}

	get minTasks(): number {
		return this._config.minTasks;
	}

	debugState(): RankingDebugState<T> {
		const edges: [T, T][] = [];
		const implied: [T, T, number][] = [];
		const n = this._n;
		for (let w = 0; w < n; w++) {
			for (let l = 0; l < n; l++) {
				if (this._edge[w * n + l] === 1) {
					edges.push([this._items[w], this._items[l]]);
				} else {
					const cw = this._closureW[w * n + l];
					if (cw > 0) implied.push([this._items[w], this._items[l], cw]);
				}
			}
		}
		const sccsT: T[][] = this._sccs.map((s) => s.map((i) => this._items[i]));
		return {
			edges,
			closureImplied: implied,
			sccs: sccsT,
			bestTopK: this.topK,
			nearOptimalCount: this._bestSets.length,
			exposures: [...this._exposures],
			config: { ...this._config },
			round: this._records.length,
		};
	}

	// -----------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------

	private _indexOf(item: T): number {
		const idx = this._indexByItem.get(item);
		if (idx === undefined) {
			throw new Error("Item not found in ranking");
		}
		return idx;
	}

	private _resetWithoutRecompute(): void {
		this._edge = new Uint8Array(this._n * this._n);
		this._exposures = new Array<number>(this._n).fill(0);
		this._records = [];
		this._pendingTask = null;
		this._rng = makeXorshift(this._seed);
		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = Math.min(this._config.k, this._n);
		if (this._config.k >= this._n) {
			this._stopped = true;
			this._stopReason = "boundary-stable";
		}
	}

	private _addEdge(w: number, l: number): void {
		const n = this._n;
		const f = w * n + l;
		const r = l * n + w;
		if (this._edge[f] === 1) return;
		if (this._edge[r] === 1) {
			throw new Error("Pair has already been compared in the opposite direction");
		}
		this._edge[f] = 1;
	}

	private _recomputeDerived(): void {
		const n = this._n;

		// Weighted transitive closure: enumerate simple paths via DFS, combine via probabilistic OR.
		// Each path of length k contributes p = β^(k-1); W(X,Y) = 1 - ∏(1 - p_i) over distinct simple paths.
		const w = new Float64Array(n * n);
		const beta = this._config.decayBeta;
		const maxLen = Math.min(this._config.maxPathLength, n);
		const visited = new Uint8Array(n);
		// Pre-cache out-neighbor lists.
		const outAdj: number[][] = [];
		for (let v = 0; v < n; v++) outAdj.push(this._outNeighbors(v));
		// Pre-compute path-weight per depth: pw[d] = β^(d-1) for d ≥ 1.
		const pw = new Float64Array(maxLen + 1);
		for (let d = 1; d <= maxLen; d++) pw[d] = d === 1 ? 1 : Math.pow(beta, d - 1);
		const dfs = (start: number, current: number, depth: number): void => {
			if (depth >= maxLen) return;
			const neighbors = outAdj[current];
			for (const next of neighbors) {
				if (visited[next] === 1) continue;
				const newDepth = depth + 1;
				const idx = start * n + next;
				const pathWeight = pw[newDepth];
				w[idx] = 1 - (1 - w[idx]) * (1 - pathWeight);
				visited[next] = 1;
				dfs(start, next, newDepth);
				visited[next] = 0;
			}
		};
		for (let i = 0; i < n; i++) {
			visited.fill(0);
			visited[i] = 1;
			dfs(i, i, 0);
		}
		// Diagonal stays 0.
		for (let i = 0; i < n; i++) w[i * n + i] = 0;
		this._closureW = w;

		// Iterative Tarjan's SCC on direct-edge graph.
		const sccs: number[][] = [];
		const indexArr = new Array<number>(n).fill(-1);
		const lowlink = new Array<number>(n).fill(0);
		const onStack = new Array<boolean>(n).fill(false);
		const stack: number[] = [];
		let index = 0;
		const strongConnect = (v: number): void => {
			interface Frame {
				v: number;
				it: number;
				neighbors: number[];
			}
			const callStack: Frame[] = [];
			indexArr[v] = index;
			lowlink[v] = index;
			index++;
			stack.push(v);
			onStack[v] = true;
			callStack.push({ v, it: 0, neighbors: outAdj[v] });
			while (callStack.length > 0) {
				const top = callStack[callStack.length - 1];
				if (top.it < top.neighbors.length) {
					const w = top.neighbors[top.it];
					top.it++;
					if (indexArr[w] === -1) {
						indexArr[w] = index;
						lowlink[w] = index;
						index++;
						stack.push(w);
						onStack[w] = true;
						callStack.push({ v: w, it: 0, neighbors: outAdj[w] });
					} else if (onStack[w]) {
						if (indexArr[w] < lowlink[top.v]) lowlink[top.v] = indexArr[w];
					}
				} else {
					// Done with top.v.
					if (lowlink[top.v] === indexArr[top.v]) {
						const comp: number[] = [];
						for (;;) {
							const w = stack.pop();
							if (w === undefined) break;
							onStack[w] = false;
							comp.push(w);
							if (w === top.v) break;
						}
						sccs.push(comp);
					}
					callStack.pop();
					if (callStack.length > 0) {
						const parent = callStack[callStack.length - 1];
						if (lowlink[top.v] < lowlink[parent.v]) lowlink[parent.v] = lowlink[top.v];
					}
				}
			}
		};
		for (let v = 0; v < n; v++) {
			if (indexArr[v] === -1) strongConnect(v);
		}
		this._sccs = sccs;

		// Min-disagreement-partition over C(n, k).
		const k = Math.min(this._config.k, n);
		this._effectiveK = k;
		if (k <= 0 || k > n) {
			this._bestSets = [];
			return;
		}
		const sets = this._combinations;
		const inS = new Uint8Array(n);
		const complement = new Int32Array(n);
		let cmin = Infinity;
		const scored: { set: number[]; score: number }[] = [];
		for (const s of sets) {
			inS.fill(0);
			for (const i of s) inS[i] = 1;
			let compLen = 0;
			for (let a = 0; a < n; a++) {
				if (inS[a] === 0) complement[compLen++] = a;
			}
			// Sum closure weights from outside-S into S — weighted contradictions.
			let cut = 0;
			for (let ai = 0; ai < compLen; ai++) {
				const aRow = complement[ai] * n;
				for (const b of s) cut += this._closureW[aRow + b];
			}
			scored.push({ set: s, score: cut });
			if (cut < cmin) cmin = cut;
		}
		const eps = this._config.epsilon;
		const optEps = 1e-9; // tolerance for floating-point equality at the optimum
		const best: number[][] = [];
		const optimal: number[][] = [];
		for (const sc of scored) {
			if (sc.score <= cmin + optEps) optimal.push(sc.set);
			if (sc.score <= cmin + eps) best.push(sc.set);
		}
		this._optimalSets = optimal;
		this._bestSets = best;

		// Cost gap to the next-best (strictly worse) set. Used to gate termination so
		// pure-transitive evidence (small fractional contributions) can't prematurely
		// declare uniqueness — only direct evidence (≥ 1.0 per contradiction) clears ε=1.
		let secondBest = Infinity;
		for (const sc of scored) {
			if (sc.score > cmin + optEps && sc.score < secondBest) secondBest = sc.score;
		}
		this._costMargin = secondBest - cmin;
	}

	private _outNeighbors(v: number): number[] {
		const n = this._n;
		const row = v * n;
		const out: number[] = [];
		for (let j = 0; j < n; j++) {
			if (this._edge[row + j] === 1) out.push(j);
		}
		return out;
	}

	private _fallbackTopK(k: number): number[] {
		// If no near-optimal sets (shouldn't normally happen), return arbitrary first k indices.
		const out: number[] = [];
		for (let i = 0; i < k; i++) out.push(i);
		return out;
	}

	private _checkTermination(): void {
		if (this._stopped) return;
		const n = this._n;

		// Boundary stability: unique optimum + cost gap to next-best ≥ ε + no SCC straddling boundary.
		// The margin gate prevents pure-transitive disambiguation (fractional contributions)
		// from declaring uniqueness; a single direct boundary edge (margin = 1.0) is enough
		// at default ε = 1. Check first because it's the cleanest possible termination —
		// when both this and "no eligible pairs" hold, prefer reporting the boundary outcome.
		// minTasks gates this so we don't exit before gathering enough evidence to surface
		// noise as cycles or contradictory direct edges.
		if (this._records.length >= this._config.minTasks && this._optimalSets.length === 1 && this._costMargin >= this._config.epsilon) {
			const top = new Set(this._optimalSets[0]);
			const straddling = this._findStraddlingSccs(top);
			if (straddling.length === 0) {
				this._stopped = true;
				this._stopReason = "boundary-stable";
				return;
			}
			// Boundary straddled by a cycle — check if every straddling SCC is irreducible
			// (i.e. all internal pairs already directly compared).
			let irreducible = true;
			for (const comp of straddling) {
				for (let a = 0; a < comp.length && irreducible; a++) {
					for (let b = a + 1; b < comp.length; b++) {
						const ia = comp[a];
						const ib = comp[b];
						if (this._edge[ia * n + ib] === 0 && this._edge[ib * n + ia] === 0) {
							irreducible = false;
							break;
						}
					}
				}
				if (!irreducible) break;
			}
			if (irreducible) {
				this._stopped = true;
				this._stopReason = "irreducible-cycle";
				return;
			}
		}

		// Hard cap.
		if (this._records.length >= this._config.maxTasks) {
			this._stopped = true;
			this._stopReason = "max-tasks";
			return;
		}

		// Eligibility fallback: when the optimum isn't unique but no pair would help.
		const eligible = this._anyEligiblePair();
		if (!eligible.any) {
			if (eligible.boundaryCycleStraddles) {
				this._stopped = true;
				this._stopReason = "irreducible-cycle";
			} else {
				this._stopped = true;
				this._stopReason = "no-eligible-pairs";
			}
		}
	}

	private _anyEligiblePair(): { any: boolean; boundaryCycleStraddles: boolean } {
		const n = this._n;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				if (this._isEligible(i, j)) {
					return { any: true, boundaryCycleStraddles: false };
				}
			}
		}
		const top = this._optimalSets.length > 0 ? new Set(this._optimalSets[0]) : new Set<number>();
		return { any: false, boundaryCycleStraddles: this._findStraddlingSccs(top).length > 0 };
	}

	private _findStraddlingSccs(top: ReadonlySet<number>): number[][] {
		const result: number[][] = [];
		for (const comp of this._sccs) {
			if (comp.length < 2) continue;
			let hasIn = false;
			let hasOut = false;
			for (const i of comp) {
				if (top.has(i)) hasIn = true;
				else hasOut = true;
				if (hasIn && hasOut) break;
			}
			if (hasIn && hasOut) result.push(comp);
		}
		return result;
	}

	private _isEligible(i: number, j: number): boolean {
		const n = this._n;
		const f = i * n + j;
		const r = j * n + i;
		if (this._edge[f] === 1 || this._edge[r] === 1) return false;
		const tau = this._config.closureWeightThreshold;
		if (this._closureW[f] >= tau || this._closureW[r] >= tau) return false;
		return true;
	}

	private _pickNextPair(): [number, number] | null {
		const n = this._n;

		// Consume exactly one main-RNG step per call so post-undo replay (which advances
		// the main RNG once per recorded task) stays synchronized with live runs. The sort
		// tie-break uses a sub-RNG seeded from this step's pre-advance state.
		const tieBreakSeed = this._rng.state;
		this._rng.next();
		const tieBreakRng = makeXorshift(tieBreakSeed);

		// Cold start: prefer pairs of low-exposure cards for coverage.
		const warmupCount = Math.ceil(n * this._config.coldStartFraction);
		if (this._records.length < warmupCount) {
			const pair = this._pickCoveragePair();
			if (pair !== null) return pair;
		}

		// Score-driven selection.
		const candidates: { i: number; j: number; score: number; sampling: number }[] = [];
		const decayDenom = Math.max(1, this._config.k * n);
		const closureMult = Math.exp(-this._records.length / decayDenom);
		const ancByV: number[][] = new Array<number[]>(n);
		const descByV: number[][] = new Array<number[]>(n);
		for (let v = 0; v < n; v++) {
			ancByV[v] = this._ancestors(v);
			descByV[v] = this._descendants(v);
		}
		// Membership masks: bestSetMask[s][v] = 1 if v ∈ bestSets[s]. Faster than s.includes(v) inside O(n²) loop.
		const numBest = this._bestSets.length;
		const bestSetMasks = new Uint8Array(numBest * n);
		for (let si = 0; si < numBest; si++) {
			const row = si * n;
			for (const i of this._bestSets[si]) bestSetMasks[row + i] = 1;
		}
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				if (!this._isEligible(i, j)) continue;
				// Count near-optimal sets that split (i, j). Pairs that split no near-optimal set
				// score 0 here — they can still win on closure expansion when the partition is
				// effectively decided but more graph structure is needed (e.g., to break cycles).
				let boundary = 0;
				for (let si = 0; si < numBest; si++) {
					const row = si * n;
					if (bestSetMasks[row + i] !== bestSetMasks[row + j]) boundary++;
				}
				const closure = this._closureExpansion(i, j, ancByV, descByV);
				const sampling = this._exposures[i] + this._exposures[j];
				const score = this._config.weightBoundary * boundary + this._config.weightClosure * closureMult * closure - this._config.weightSampling * sampling;
				candidates.push({ i, j, score, sampling });
			}
		}
		if (candidates.length === 0) return null;
		// Sort by score desc, then by lower sampling, then by RNG to break further ties.
		candidates.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			if (a.sampling !== b.sampling) return a.sampling - b.sampling;
			return tieBreakRng.next() - 0.5;
		});
		const top = candidates[0];
		return [top.i, top.j];
	}

	private _pickCoveragePair(): [number, number] | null {
		const n = this._n;
		// Prefer pairs where both cards have minimum exposure (and the pair is eligible).
		let bestPair: [number, number] | null = null;
		let bestKey = Infinity;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				if (!this._isEligible(i, j)) continue;
				const key = Math.max(this._exposures[i], this._exposures[j]) * 100 + (this._exposures[i] + this._exposures[j]);
				if (key < bestKey) {
					bestKey = key;
					bestPair = [i, j];
				}
			}
		}
		return bestPair;
	}

	private _closureExpansion(i: number, j: number, ancByV: readonly number[][], descByV: readonly number[][]): number {
		const n = this._n;
		// Estimate weighted closure-evidence gain summed over both possible outcomes.
		// For direction A→B: every (a, b) where a strongly implies A (or a===A) and B strongly
		// implies b (or b===B) gains a path through the new edge. We approximate the path
		// length using one closure-hop on each side that isn't endpoint, and combine the new
		// path's weight with the existing closure weight via probabilistic OR.
		const beta = this._config.decayBeta;
		const tau = this._config.closureWeightThreshold;
		const ancI = ancByV[i];
		const ancJ = ancByV[j];
		const descI = descByV[i];
		const descJ = descByV[j];
		const computeGain = (anc: readonly number[], from: number, desc: readonly number[], to: number): number => {
			let gain = 0;
			const ancList = [from, ...anc];
			const descList = [to, ...desc];
			for (const a of ancList) {
				for (const b of descList) {
					if (a === b) continue;
					const idx = a * n + b;
					const existing = this._closureW[idx];
					if (existing >= tau) continue;
					const aHops = a === from ? 0 : 1;
					const bHops = b === to ? 0 : 1;
					const len = aHops + 1 + bHops;
					const newP = len === 1 ? 1 : Math.pow(beta, len - 1);
					const combined = 1 - (1 - existing) * (1 - newP);
					gain += combined - existing;
				}
			}
			return gain;
		};
		const gainIJ = computeGain(ancI, i, descJ, j);
		const gainJI = computeGain(ancJ, j, descI, i);
		return gainIJ + gainJI;
	}

	private _ancestors(v: number): number[] {
		const n = this._n;
		const tau = this._config.closureWeightThreshold;
		const out: number[] = [];
		for (let i = 0; i < n; i++) {
			if (i !== v && this._closureW[i * n + v] >= tau) out.push(i);
		}
		return out;
	}

	private _descendants(v: number): number[] {
		const n = this._n;
		const tau = this._config.closureWeightThreshold;
		const out: number[] = [];
		for (let j = 0; j < n; j++) {
			if (j !== v && this._closureW[v * n + j] >= tau) out.push(j);
		}
		return out;
	}
}
