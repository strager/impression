// ============================================================
// Active Ranking via Pairwise Comparisons + Graph Closure
// ============================================================
//
// Identifies the top K items from N items through pairwise
// comparisons. Maintains a directed preference graph; derived
// transitive closure and SCCs drive selection and termination.
// Supports a K range [kMin, kMax]: the session terminates at
// the largest K whose boundary is stable, so a clear top-4 can
// be returned when the 5th slot is irreducibly ambiguous.
// See docs/ranking.md for the design specification.
// ============================================================

import { enumerateCombinations, makeXorshift } from "./ranking-math.ts";
import type { XorshiftRng } from "./ranking-math.ts";

export type StopReason = "boundary-stable" | "no-eligible-pairs" | "irreducible-cycle" | "max-tasks";

export interface RankingConfig {
	/** Upper bound on the size of the returned top set. Default 5. */
	k: number;
	/** Lower bound on the size of the returned top set. 0 → match k (fixed-size output). Default 3. */
	kMin: number;
	/** Hard cap on total comparisons. Default 5N - 5 for N ≥ 10 (with a piecewise floor below). 0 → use n-dependent default. */
	maxTasks: number;
	/** Floor on total comparisons before any early-termination (boundary-stable / irreducible-cycle) can fire. Default 0 → match maxTasks (force exhaustion of the budget). */
	minTasks: number;
	/** Per-card exposure floor before boundary-stable / unique-optimum irreducible-cycle can fire: every card must have appeared in at least this many comparisons. Default 2. */
	minExposuresPerCard: number;
	/** Higher exposure floor applied only to cards in the current optimal top-K. Default 3. */
	minExposuresTopK: number;
	/** Per-top-K-card direct-wins floor — every card in the proposed top-K must have beaten at least this many opponents to credibly claim its slot. Clamped to min(this, n - K) since cards in the top-K can only directly beat cards below the line. Default 2. */
	minWinsTopK: number;
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
	kMin: 3,
	maxTasks: 0,
	minTasks: 0,
	minExposuresPerCard: 2,
	minExposuresTopK: 3,
	minWinsTopK: 2,
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
	// Per-K partition state. K ranges over [_kMin, _kMax] (clipped to [1, n]).
	private readonly _kMin: number;
	private readonly _kMax: number;
	private readonly _combinationsByK: Map<number, number[][]>;
	private _optimalSetsByK: Map<number, number[][]>;
	private _bestSetsByK: Map<number, number[][]>;
	// Cost gap from optimum to next-best (strictly worse) set per K. Termination requires this margin ≥ ε so
	// weak transitive disambiguation alone can't end the session.
	private _costMarginByK: Map<number, number>;

	private _stopped: boolean;
	private _stopReason: StopReason | null;
	// During the session: _kMax (the K we're trying to converge to). At termination: the K we settled on.
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
			// 5n - 5, floored at 15 for very small n. The wins floor needs headroom for boundary
			// confirmation comparisons, which the old tighter piecewise floor (25 at n=7-8) didn't
			// allow.
			this._config.maxTasks = Math.max(15, 5 * this._n - 5);
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

		// Resolve K range. kMin = 0 means "fixed K" (legacy behavior).
		const kMaxRaw = this._config.k;
		const kMinRaw = this._config.kMin > 0 ? this._config.kMin : kMaxRaw;
		this._kMax = Math.min(this._n, Math.max(1, kMaxRaw));
		this._kMin = Math.min(this._kMax, Math.max(1, kMinRaw));
		this._effectiveK = this._kMax;

		this._combinationsByK = new Map();
		for (let k = this._kMin; k <= this._kMax; k++) {
			this._combinationsByK.set(k, enumerateCombinations(this._n, k));
		}
		this._optimalSetsByK = new Map();
		this._bestSetsByK = new Map();
		this._costMarginByK = new Map();
		for (let k = this._kMin; k <= this._kMax; k++) {
			this._optimalSetsByK.set(k, []);
			this._bestSetsByK.set(k, []);
			this._costMarginByK.set(k, Infinity);
		}

		this._stopped = false;
		this._stopReason = null;

		// Trivial case: every K in the range satisfies k >= n, so the entire item set is the answer.
		if (kMaxRaw >= this._n) {
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
		// Each comparison adds 2 exposures; a deficit of d needs at least ceil(d/2) more tasks.
		const exposureGap = Math.ceil(this._exposureDeficit(this._topForK(this._kMax)) / 2);
		// Disambiguation: estimate against the K we're actively trying to converge to (kMax).
		// Smaller K's may converge sooner and trigger an early stop; the estimate is for the
		// pessimistic "still pushing for kMax" path so the user-facing number doesn't drop suddenly.
		const ambig = (this._bestSetsByK.get(this._kMax) ?? []).length;
		const ambigEstimate = ambig <= 1 ? 1 : ambig - 1;
		const margin = this._costMarginByK.get(this._kMax) ?? Infinity;
		const marginGap = Math.max(0, this._config.epsilon - margin);
		const ambigPlusMargin = ambigEstimate + Math.ceil(marginGap);
		return Math.min(budget, Math.max(minGap, exposureGap, ambigPlusMargin));
	}

	get topK(): readonly T[] {
		const k = this._effectiveK;
		const set = this._topForK(k);
		return set.slice(0, k).map((i) => this._items[i]);
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
		// Surface the K we're currently displaying — _effectiveK matches what topK returns.
		const bestSetsForDisplay = this._bestSetsByK.get(this._effectiveK) ?? [];
		return {
			edges,
			closureImplied: implied,
			sccs: sccsT,
			bestTopK: this.topK,
			nearOptimalCount: bestSetsForDisplay.length,
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

	private _topForK(k: number): number[] {
		const optimal = this._optimalSetsByK.get(k);
		if (optimal !== undefined && optimal.length > 0) return optimal[0];
		return this._fallbackTopK(k);
	}

	private _resetWithoutRecompute(): void {
		this._edge = new Uint8Array(this._n * this._n);
		this._exposures = new Array<number>(this._n).fill(0);
		this._records = [];
		this._pendingTask = null;
		this._rng = makeXorshift(this._seed);
		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = this._kMax;
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

		// Min-disagreement-partition over C(n, K) for every K in [kMin, kMax].
		const eps = this._config.epsilon;
		const optEps = 1e-9; // tolerance for floating-point equality at the optimum
		const inS = new Uint8Array(n);
		const complement = new Int32Array(n);
		for (let k = this._kMin; k <= this._kMax; k++) {
			const sets = this._combinationsByK.get(k);
			if (sets === undefined || sets.length === 0) {
				this._optimalSetsByK.set(k, []);
				this._bestSetsByK.set(k, []);
				this._costMarginByK.set(k, Infinity);
				continue;
			}
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
			const best: number[][] = [];
			const optimal: number[][] = [];
			for (const sc of scored) {
				if (sc.score <= cmin + optEps) optimal.push(sc.set);
				if (sc.score <= cmin + eps) best.push(sc.set);
			}
			this._optimalSetsByK.set(k, optimal);
			this._bestSetsByK.set(k, best);

			// Cost gap to the next-best (strictly worse) set. Used to gate termination so
			// pure-transitive evidence (small fractional contributions) can't prematurely
			// declare uniqueness — only direct evidence (≥ 1.0 per contradiction) clears ε=1.
			let secondBest = Infinity;
			for (const sc of scored) {
				if (sc.score > cmin + optEps && sc.score < secondBest) secondBest = sc.score;
			}
			this._costMarginByK.set(k, secondBest - cmin);
		}
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
		const eps = this._config.epsilon;

		// Mid-session stability check at K=kMax.
		if (this._records.length >= this._config.minTasks) {
			const optimal = this._optimalSetsByK.get(this._kMax) ?? [];
			const margin = this._costMarginByK.get(this._kMax) ?? Infinity;
			if (optimal.length === 1 && margin >= eps) {
				const top = optimal[0];
				if (this._exposureFloorsMet(top) && this._winsFloorsMet(top)) {
					const topSet = new Set(top);
					const straddling = this._findStraddlingSccs(topSet);
					if (straddling.length === 0) {
						this._effectiveK = this._kMax;
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
						this._effectiveK = this._kMax;
						this._stopped = true;
						this._stopReason = "irreducible-cycle";
						return;
					}
				}
			}
		}

		// Hard cap.
		if (this._records.length >= this._config.maxTasks) {
			if (this._tryFallbackToSmallerK("boundary-stable")) return;
			this._effectiveK = this._kMax;
			this._stopped = true;
			this._stopReason = "max-tasks";
			return;
		}

		// Eligibility fallback: when no pair would help, stop. Use the kMax top to check whether
		// a boundary cycle straddles — if so, report irreducible-cycle (matches "nothing more to
		// ask" intent regardless of which K we'd report).
		const eligible = this._anyEligiblePair();
		if (!eligible.any) {
			if (this._tryFallbackToSmallerK("boundary-stable")) return;
			this._effectiveK = this._kMax;
			this._stopped = true;
			this._stopReason = eligible.boundaryCycleStraddles ? "irreducible-cycle" : "no-eligible-pairs";
		}
	}

	/**
	 * "Stuck" exit fallback. When we can't make further progress mid-session, search from kMax
	 * downward for the largest K with a unique optimum, margin ≥ ε, and no boundary-straddling
	 * SCC. Exposure / wins floors are deliberately relaxed here — we're forced to stop anyway,
	 * so accepting a kMax that just barely missed the mid-session floors beats falling to a
	 * smaller K. We *do* start at kMax (not kMax-1): if the mid-session gate was blocked by
	 * minTasks or floors but kMax is otherwise stable at termination, that's the answer.
	 * Returns true if a stop was emitted.
	 */
	private _tryFallbackToSmallerK(reason: StopReason): boolean {
		const eps = this._config.epsilon;
		for (let k = this._kMax; k >= this._kMin; k--) {
			const optimal = this._optimalSetsByK.get(k) ?? [];
			const margin = this._costMarginByK.get(k) ?? Infinity;
			if (optimal.length !== 1 || margin < eps) continue;
			const topSet = new Set(optimal[0]);
			if (this._findStraddlingSccs(topSet).length > 0) continue;
			this._effectiveK = k;
			this._stopped = true;
			this._stopReason = reason;
			return true;
		}
		return false;
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
		// Check straddling against the kMax optimum (the K we'd otherwise report).
		const optimalKMax = this._optimalSetsByK.get(this._kMax) ?? [];
		const top = optimalKMax.length > 0 ? new Set(optimalKMax[0]) : new Set<number>();
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

	private _exposureFloorsMet(topIndices: readonly number[]): boolean {
		const minBase = this._config.minExposuresPerCard;
		const minTop = this._config.minExposuresTopK;
		if (minBase <= 0 && minTop <= 0) return true;
		const top = new Set(topIndices);
		for (let i = 0; i < this._n; i++) {
			const required = top.has(i) ? minTop : minBase;
			if (this._exposures[i] < required) return false;
		}
		return true;
	}

	private _winsFloorsMet(topIndices: readonly number[]): boolean {
		const k = topIndices.length;
		const required = Math.min(this._config.minWinsTopK, Math.max(0, this._n - k));
		if (required <= 0) return true;
		const n = this._n;
		for (const i of topIndices) {
			const row = i * n;
			let wins = 0;
			for (let j = 0; j < n && wins < required; j++) {
				if (this._edge[row + j] === 1) wins++;
			}
			if (wins < required) return false;
		}
		return true;
	}

	private _exposureDeficit(topIndices: readonly number[]): number {
		const minBase = this._config.minExposuresPerCard;
		const minTop = this._config.minExposuresTopK;
		if (minBase <= 0 && minTop <= 0) return 0;
		const top = new Set(topIndices);
		let deficit = 0;
		for (let i = 0; i < this._n; i++) {
			const required = top.has(i) ? minTop : minBase;
			const gap = required - this._exposures[i];
			if (gap > 0) deficit += gap;
		}
		return deficit;
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
		// Concatenate near-optimal sets from every K in the range into one mask block. Splitting
		// any of them is informative — a pair that resolves the K=4 boundary helps too, since a
		// smaller stable K is now an acceptable termination outcome.
		const allBest: number[][] = [];
		for (let k = this._kMin; k <= this._kMax; k++) {
			const sets = this._bestSetsByK.get(k);
			if (sets === undefined) continue;
			for (const s of sets) allBest.push(s);
		}
		const numBest = allBest.length;
		const bestSetMasks = new Uint8Array(numBest * n);
		for (let si = 0; si < numBest; si++) {
			const row = si * n;
			for (const i of allBest[si]) bestSetMasks[row + i] = 1;
		}
		// Wins-floor deficit: keep collecting boundary evidence even after K=kMax has a unique
		// optimum. Once the partition is "decided", boundary score drops to 0 for every pair and
		// the algorithm would otherwise stop probing — so the wins floor would never be reached
		// without an extra nudge. Pairs involving a candidate top-K card that's short on wins get
		// treated as if they split an extra near-optimal set, restoring selection pressure on the
		// boundary until each top-K card has demonstrated it's actually above others.
		// Use the union of all K=kMax strict optima (sets within optEps of minimum cost), not
		// near-optimal — strict optima cover tied-boundary cases (e.g., the algorithm hasn't
		// disambiguated which of several cards is 5th) without pulling in clearly-not-top cards
		// that just happen to be inside ε-near-optimal alternatives.
		const winsDeficitByCard = new Int8Array(n);
		const kMaxOpt = this._optimalSetsByK.get(this._kMax) ?? [];
		if (kMaxOpt.length >= 1) {
			const k = kMaxOpt[0].length;
			const required = Math.min(this._config.minWinsTopK, Math.max(0, n - k));
			if (required > 0) {
				const candidates = new Set<number>();
				for (const s of kMaxOpt) for (const idx of s) candidates.add(idx);
				for (const idx of candidates) {
					const row = idx * n;
					let wins = 0;
					for (let j = 0; j < n && wins < required; j++) {
						if (this._edge[row + j] === 1) wins++;
					}
					if (wins < required) winsDeficitByCard[idx] = 1;
				}
			}
		}
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				if (!this._isEligible(i, j)) continue;
				// Count near-optimal sets that split (i, j) across every K in the range. Pairs
				// that split no near-optimal set score 0 here — they can still win on closure
				// expansion when partitions are effectively decided but more graph structure is
				// needed (e.g., to break cycles).
				let boundary = 0;
				for (let si = 0; si < numBest; si++) {
					const row = si * n;
					if (bestSetMasks[row + i] !== bestSetMasks[row + j]) boundary++;
				}
				// Each wins-floor-deficit endpoint counts as an additional virtual split — keeps
				// the algorithm picking boundary-confirming pairs once the partition is decided.
				boundary += winsDeficitByCard[i] + winsDeficitByCard[j];
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
