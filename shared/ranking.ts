// ============================================================
// Top-k Identification via Bayesian Bradley-Terry
// with Information-Gain Pair Selection
// ============================================================
//
// Identifies the top K items from N items through pairwise comparisons.
// Uses a Bayesian Bradley-Terry model for strength estimation, a Laplace
// approximation for uncertainty quantification, and information-gain pair
// selection to minimize the number of comparisons needed.
//
// Components:
//   - Bradley-Terry model (sigmoid): P(i beats j) = σ(μ_i - μ_j)
//   - Bayesian inference (bayesianRefit): MAP via Newton's method + Laplace
//   - Active learning (computeInformationGain, selectPair): pick the most
//     informative pair to compare next
//   - Stopping rules: confidence separation, stability, hard cap
//   - Adaptive K reduction: when items near the K boundary have similar
//     strength, stop early with fewer items (e.g. top-3 or top-4 instead
//     of top-5) rather than grinding through the full comparison budget.
//     The effectiveK getter reports how many items were actually selected.
//
// Stopping rule order (checked after every comparison):
//   1. Confidence stop (full K) — top-K LCBs exceed non-top-K UCBs
//   2. Adaptive K reduction — reduced K passes confidence with a z-score
//      that starts high (reluctance) and decays linearly to the base z
//   3. Stability stop (full K) — top-K set unchanged for stabilityWindow
//   4. Max comparisons — hard budget; scans reduced K values for
//      confidence or stability before falling back to full K
//
// References:
//   Bradley & Terry (1952), Luce (1959), Caron & Doucet (2012),
//   Herbrich et al. (2006/TrueSkill), Chaloner & Verdinelli (1995),
//   MacKay (1992), Pfeiffer et al. (2012), Kalyanakrishnan et al. (2012),
//   Kaufmann & Kalyanakrishnan (2013)
// ============================================================

import type { KWeight, RemainingEstimate, WinLoss } from "./ranking-math.ts";
import { argsortDescending, checkAdaptiveKReduction, checkConfidenceStop, checkStabilityStop, estimateStabilityStop } from "./ranking-math.ts";
import type { BayesianRefitRequest, BayesianRefitResponse, SelectPairRequest, SelectPairResponse, WorkerRequest, WorkerResponse } from "./ranking-worker-protocol.ts";

// Re-export all pure math functions so existing imports from ranking.ts keep working.
export { argsortDescending, bayesianRefit, boxMuller, checkAdaptiveKReduction, checkConfidenceStop, checkStabilityStop, choleskyDecompose, choleskyInverse, choleskySolve, computeInformationGain, estimateStabilityStop, makeXorshift, normalCDF, selectPair, sigmoid, topKEntropy } from "./ranking-math.ts";
export type { KWeight, RemainingEstimate, WinLoss } from "./ranking-math.ts";

export interface RankingConfig {
	/** Number of top items to identify. */
	k: number;
	/** Minimum acceptable K for adaptive K reduction.
	 * Must satisfy 1 <= minK <= k. Defaults to min(3, k). */
	minK: number;
	/** Extra z-score penalty at round 0 for reduced-K stopping, decays
	 * linearly to 0 at maxComparisons. Higher values make the algorithm
	 * more reluctant to reduce K early. The effective z-score for reduced-K
	 * checks is: z + kReductionReluctance * (1 - round / maxComparisons). */
	kReductionReluctance: number;
	/** Z-score for confidence-based stopping (e.g. 1.96 for 95%). */
	z: number;
	/** Number of consecutive stable rounds before stopping. */
	stabilityWindow: number;
	/** Hard cap on total pairwise comparisons. */
	maxComparisons: number;
	/** Prior variance for each strength parameter. */
	priorVariance: number;
	/** Gap the confidence intervals must exceed to trigger early stop. */
	confidenceThreshold: number;
	/** Penalize pairs that include items from the last comparison.
	 * Value in (0, 1]: 1.0 = no penalty, lower = stronger penalty. */
	recencyDiscount: number;
	/** Disable the worker-side bayesianRefit cache (useful for benchmarks). */
	noWorkerCache: boolean;
	/** Disable speculative precomputation of the next pair after selectPair(). */
	noSpeculation: boolean;
}

export type StopReason = "confidence" | "stability" | "max-comparisons";

export interface ComparisonRecord<T> {
	winner: T;
	loser: T;
}

interface ReducedKStabilityEntry {
	readonly k: number;
	readonly topK: readonly number[];
	readonly stableCount: number;
}

interface HistoryEntry {
	readonly winnerIndex: number;
	readonly loserIndex: number;
	readonly topK: readonly number[];
	readonly stableCount: number;
	readonly flip: boolean | null;
	readonly reducedKStability: readonly ReducedKStabilityEntry[];
}

const DEFAULT_CONFIG: RankingConfig = {
	k: 5,
	minK: 3,
	kReductionReluctance: 1.0,
	z: 1.96,
	stabilityWindow: 10,
	maxComparisons: 80,
	priorVariance: 1.0,
	confidenceThreshold: 0.0,
	recencyDiscount: 0.5,
	noWorkerCache: false,
	noSpeculation: false,
};

/**
 * Bayesian Bradley-Terry ranking algorithm.
 *
 * Identifies the top K items from N items through iterative pairwise
 * comparisons. Callers pass in their items (strings, objects, etc.) and
 * interact using those item values. Internally, items are mapped to numeric
 * indices for the math.
 *
 * Heavy math (selectPair, bayesianRefit) is offloaded to a Web Worker
 * (browser) or worker_threads (Node). The methods `selectPair()`,
 * `recordComparison()`, and `undoLastComparison()` are async.
 *
 * Usage:
 *   const ranking = new Ranking(items);
 *   while (!ranking.stopped) {
 *     const { a, b } = await ranking.selectPair();
 *     // show a and b to user, get their choice
 *     await ranking.recordComparison(winner, loser);
 *   }
 *   console.log(ranking.topK);
 */
export class Ranking<T> {
	private readonly _items: readonly T[];
	private readonly _config: RankingConfig;
	private readonly _n: number;
	private _mu: Float64Array;
	private _sigma: Float64Array;
	private _history: HistoryEntry[];
	private _comparisonRecords: ComparisonRecord<T>[];
	private _round: number;
	private _stopped: boolean;
	private _stopReason: StopReason | null;
	private _effectiveK: number;

	constructor(items: readonly T[], config?: Partial<RankingConfig>) {
		this._items = items;
		this._config = { ...DEFAULT_CONFIG, ...config };
		// If minK wasn't explicitly provided, clamp it to k
		if (config?.minK === undefined) {
			this._config.minK = Math.min(this._config.minK, this._config.k);
		}
		if (this._config.minK < 1 || this._config.minK > this._config.k) {
			throw new Error(`minK must be between 1 and k (got minK=${String(this._config.minK)}, k=${String(this._config.k)})`);
		}
		this._n = items.length;
		this._mu = new Float64Array(this._n);
		this._sigma = new Float64Array(this._n).fill(Math.sqrt(this._config.priorVariance));
		this._history = [];
		this._comparisonRecords = [];
		this._round = 0;
		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = this._config.k;
	}

	private _indexOf(item: T): number {
		const idx = this._items.indexOf(item);
		if (idx === -1) {
			throw new Error("Item not found in ranking");
		}
		return idx;
	}

	private _historyAsWinLoss(history: readonly HistoryEntry[]): WinLoss[] {
		return history.map((entry) => [entry.winnerIndex, entry.loserIndex]);
	}

	private _topKFromMu(mu: Float64Array): number[] {
		return argsortDescending(mu)
			.slice(0, this._config.k)
			.sort((a, b) => a - b);
	}

	private _stableCountFromHistory(): number {
		const current = this._history.at(-1);
		return current === undefined ? 0 : current.stableCount;
	}

	private _flipHistoryFromHistory(): boolean[] {
		const flips: boolean[] = [];
		for (const entry of this._history) {
			if (entry.flip !== null) {
				flips.push(entry.flip);
			}
		}
		return flips;
	}

	/**
	 * Build round-dependent weights for multi-objective pair selection.
	 *
	 * Full K always gets weight 1.0. Reduced K values (k-1 down to minK)
	 * get weight equal to progress (round / maxComparisons), so early
	 * rounds focus on the full K objective while later rounds increasingly
	 * gather information useful for reduced K values too.
	 *
	 * Weights are normalized to sum to 1.
	 */
	private _computeKWeights(): KWeight[] {
		const { k, minK, maxComparisons } = this._config;
		const progress = this._round / maxComparisons;
		const candidates: KWeight[] = [{ k, weight: 1.0 }];
		for (let rk = k - 1; rk >= minK; rk--) {
			candidates.push({ k: rk, weight: progress });
		}
		const total = candidates.reduce((sum, c) => sum + c.weight, 0);
		return candidates.map((c) => ({ k: c.k, weight: c.weight / total }));
	}

	private async _selectPairOnWorker(mu: Float64Array, sigma: Float64Array, history: WinLoss[]): Promise<[number, number]> {
		await ensureWorker();
		const id = nextRequestId++;
		const response = await postToWorker({
			type: "selectPair",
			id,
			mu,
			sigma,
			history,
			kWeights: this._computeKWeights(),
			n: this._n,
			priorVariance: this._config.priorVariance,
			recencyDiscount: this._config.recencyDiscount,
			noCache: this._config.noWorkerCache,
		});
		return response.pair;
	}

	private async _recordComparisonPure(
		mu: Float64Array,
		sigma: Float64Array,
		history: WinLoss[],
		wi: number,
		li: number,
		round: number,
		previousTopK: readonly number[] | null,
		stableCount: number,
		previousReducedKStability: readonly ReducedKStabilityEntry[],
	): Promise<{
		mu: Float64Array;
		sigma: Float64Array;
		history: WinLoss[];
		round: number;
		topK: readonly number[];
		stableCount: number;
		flip: boolean | null;
		stopped: boolean;
		stopReason: StopReason | null;
		effectiveK: number;
		reducedKStability: readonly ReducedKStabilityEntry[];
	}> {
		const newHistory: WinLoss[] = [...history, [wi, li]];
		const newRound = round + 1;

		await ensureWorker();
		const id = nextRequestId++;
		const response = await postToWorker({
			type: "bayesianRefit",
			id,
			history: newHistory,
			n: this._n,
			priorVariance: this._config.priorVariance,
			noCache: this._config.noWorkerCache,
		});

		const newMu = response.mu instanceof Float64Array ? response.mu : new Float64Array(response.mu);
		const newSigma = response.sigma instanceof Float64Array ? response.sigma : new Float64Array(response.sigma);

		const { k, minK, z, confidenceThreshold, stabilityWindow, maxComparisons, kReductionReluctance } = this._config;

		// Update reduced-K stability tracking
		const newReducedKStability: ReducedKStabilityEntry[] = [];
		for (let rk = k - 1; rk >= minK; rk--) {
			const prev = previousReducedKStability.find((e) => e.k === rk);
			const prevTopK = prev !== undefined ? prev.topK : null;
			const prevStableCount = prev !== undefined ? prev.stableCount : 0;
			const stabResult = checkStabilityStop(newMu, rk, prevTopK, prevStableCount, stabilityWindow);
			newReducedKStability.push({ k: rk, topK: stabResult.topK, stableCount: stabResult.stableCount });
		}

		// 1. Confidence stop (full K)
		if (checkConfidenceStop(newMu, newSigma, k, z, confidenceThreshold)) {
			return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: this._topKFromMu(newMu), stableCount, flip: null, stopped: true, stopReason: "confidence", effectiveK: k, reducedKStability: newReducedKStability };
		}

		// 2. Adaptive K reduction
		const reducedZ = z + kReductionReluctance * (1 - newRound / maxComparisons);
		const adaptiveK = checkAdaptiveKReduction(newMu, newSigma, k, minK, reducedZ, confidenceThreshold);
		if (adaptiveK !== null) {
			const adaptiveTopK = argsortDescending(newMu)
				.slice(0, adaptiveK)
				.sort((a, b) => a - b);
			return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: adaptiveTopK, stableCount, flip: null, stopped: true, stopReason: "confidence", effectiveK: adaptiveK, reducedKStability: newReducedKStability };
		}

		// 3. Stability stop (full K)
		const stability = checkStabilityStop(newMu, k, previousTopK, stableCount, stabilityWindow);
		const flip = previousTopK !== null ? stability.stableCount === 0 : null;
		const newTopK = stability.topK;
		const newStableCount = stability.stableCount;
		if (stability.stopped) {
			return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: newTopK, stableCount: newStableCount, flip, stopped: true, stopReason: "stability", effectiveK: k, reducedKStability: newReducedKStability };
		}

		// 4. Max comparisons fallback with reduced-K scan
		if (newRound >= maxComparisons) {
			// Scan reduced K values descending, pick largest that passes either
			// reduced-confidence (reducedZ = z since reluctance is gone) or reduced-stability
			for (let rk = k - 1; rk >= minK; rk--) {
				if (checkConfidenceStop(newMu, newSigma, rk, z, confidenceThreshold)) {
					const fallbackTopK = argsortDescending(newMu)
						.slice(0, rk)
						.sort((a, b) => a - b);
					return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: fallbackTopK, stableCount: newStableCount, flip, stopped: true, stopReason: "confidence", effectiveK: rk, reducedKStability: newReducedKStability };
				}
				const rkEntry = newReducedKStability.find((e) => e.k === rk);
				if (rkEntry !== undefined && rkEntry.stableCount >= stabilityWindow) {
					return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: rkEntry.topK, stableCount: newStableCount, flip, stopped: true, stopReason: "stability", effectiveK: rk, reducedKStability: newReducedKStability };
				}
			}
			return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: newTopK, stableCount: newStableCount, flip, stopped: true, stopReason: "max-comparisons", effectiveK: k, reducedKStability: newReducedKStability };
		}

		return { mu: newMu, sigma: newSigma, history: newHistory, round: newRound, topK: newTopK, stableCount: newStableCount, flip, stopped: false, stopReason: null, effectiveK: k, reducedKStability: newReducedKStability };
	}

	private _speculateAfterPairSelection(i: number, j: number): void {
		if (this._config.noSpeculation) return;
		const history = this._historyAsWinLoss(this._history);
		const current = this._history.at(-1);
		const previousTopK = current === undefined ? null : current.topK;
		const stableCount = current === undefined ? 0 : current.stableCount;
		const reducedKStability = current === undefined ? [] : current.reducedKStability;
		const speculate = async (wi: number, li: number): Promise<void> => {
			const result = await this._recordComparisonPure(this._mu, this._sigma, history, wi, li, this._round, previousTopK, stableCount, reducedKStability);
			if (!result.stopped) {
				await this._selectPairOnWorker(result.mu, result.sigma, result.history);
			}
		};
		// eslint-disable-next-line @typescript-eslint/no-empty-function -- fire-and-forget; errors are intentionally swallowed
		speculate(i, j).catch(() => {});
		// eslint-disable-next-line @typescript-eslint/no-empty-function -- fire-and-forget; errors are intentionally swallowed
		speculate(j, i).catch(() => {});
	}

	async selectPair(): Promise<{ a: T; b: T }> {
		if (this._stopped) {
			throw new Error("Ranking has already stopped");
		}
		const [i, j] = await this._selectPairOnWorker(this._mu, this._sigma, this._historyAsWinLoss(this._history));
		this._speculateAfterPairSelection(i, j);
		return { a: this._items[i], b: this._items[j] };
	}

	async recordComparison(winner: T, loser: T): Promise<{ stopped: boolean; stopReason: StopReason | null }> {
		if (this._stopped) {
			throw new Error("Ranking has already stopped");
		}

		const wi = this._indexOf(winner);
		const li = this._indexOf(loser);
		const current = this._history.at(-1);
		const previousTopK = current === undefined ? null : current.topK;
		const stableCount = current === undefined ? 0 : current.stableCount;
		const reducedKStability = current === undefined ? [] : current.reducedKStability;

		const result = await this._recordComparisonPure(this._mu, this._sigma, this._historyAsWinLoss(this._history), wi, li, this._round, previousTopK, stableCount, reducedKStability);

		this._mu = result.mu;
		this._sigma = result.sigma;
		this._history.push({
			winnerIndex: wi,
			loserIndex: li,
			topK: result.topK,
			stableCount: result.stableCount,
			flip: result.flip,
			reducedKStability: result.reducedKStability,
		});
		this._comparisonRecords.push({ winner, loser });
		this._round = result.round;
		this._stopped = result.stopped;
		this._stopReason = result.stopReason;
		this._effectiveK = result.effectiveK;

		return { stopped: result.stopped, stopReason: result.stopReason };
	}

	async undoLastComparison(): Promise<ComparisonRecord<T>> {
		if (this._history.length === 0) {
			throw new Error("No comparison to undo");
		}

		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = this._config.k;

		this._history.pop();
		const record = this._comparisonRecords.pop();
		if (record === undefined) {
			throw new Error("No comparison to undo");
		}
		this._round--;

		// Refit model on worker
		await ensureWorker();
		const id = nextRequestId++;
		const response = await postToWorker({
			type: "bayesianRefit",
			id,
			history: this._historyAsWinLoss(this._history),
			n: this._n,
			priorVariance: this._config.priorVariance,
			noCache: this._config.noWorkerCache,
		});

		this._mu = response.mu instanceof Float64Array ? response.mu : new Float64Array(response.mu);
		this._sigma = response.sigma instanceof Float64Array ? response.sigma : new Float64Array(response.sigma);

		return record;
	}

	get topK(): readonly T[] {
		const indices: number[] = [];
		for (let i = 0; i < this._n; i++) {
			indices.push(i);
		}
		indices.sort((a, b) => this._mu[b] - this._mu[a]);
		return indices.slice(0, this._effectiveK).map((i) => this._items[i]);
	}

	get effectiveK(): number {
		return this._effectiveK;
	}

	get round(): number {
		return this._round;
	}

	get stopped(): boolean {
		return this._stopped;
	}

	get stopReason(): StopReason | null {
		return this._stopReason;
	}

	get mu(): readonly number[] {
		return Array.from(this._mu);
	}

	get sigma(): readonly number[] {
		return Array.from(this._sigma);
	}

	get history(): readonly ComparisonRecord<T>[] {
		return this._comparisonRecords;
	}

	clone(): Ranking<T> {
		const copy = new Ranking(this._items, this._config);
		copy._mu = this._mu.slice();
		copy._sigma = this._sigma.slice();
		copy._history = [...this._history];
		copy._comparisonRecords = [...this._comparisonRecords];
		copy._round = this._round;
		copy._stopped = this._stopped;
		copy._stopReason = this._stopReason;
		copy._effectiveK = this._effectiveK;
		return copy;
	}

	estimateRemaining(): RemainingEstimate {
		const maxRemaining = Math.max(0, this._config.maxComparisons - this._round);
		return estimateStabilityStop(this._flipHistoryFromHistory(), this._stableCountFromHistory(), this._config.stabilityWindow, maxRemaining);
	}

	debugState(): {
		mu: Float64Array;
		sigma: Float64Array;
		effectiveK: number;
		fullKStableCount: number;
		reducedKStability: readonly ReducedKStabilityEntry[];
		kWeights: KWeight[];
		config: RankingConfig;
		round: number;
	} {
		const current = this._history.at(-1);
		return {
			mu: this._mu,
			sigma: this._sigma,
			effectiveK: this._effectiveK,
			fullKStableCount: current === undefined ? 0 : current.stableCount,
			reducedKStability: current === undefined ? [] : current.reducedKStability,
			kWeights: this._computeKWeights(),
			config: this._config,
			round: this._round,
		};
	}
}

// ---- Global worker singleton ----

interface PendingRequest {
	resolve: (response: WorkerResponse) => void;
}

const pendingRequests = new Map<number, PendingRequest>();
let globalWorkerReady: Promise<void> | null = null;

function ensureWorker(): Promise<void> {
	if (globalWorkerReady !== null) return globalWorkerReady;
	globalWorkerReady = initWorker();
	return globalWorkerReady;
}

function handleWorkerResponse(data: WorkerResponse): void {
	const pending = pendingRequests.get(data.id);
	if (pending !== undefined) {
		pendingRequests.delete(data.id);
		pending.resolve(data);
	}
}

let workerPostMessage: (msg: WorkerRequest) => void = () => {
	throw new Error("Worker not initialized");
};

async function initWorker(): Promise<void> {
	if ("Worker" in globalThis) {
		// Browser: use standard Web Worker
		// The `new Worker(new URL(...), ...)` pattern must be a single expression
		// so Vite can statically detect and bundle the worker for production builds.
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- dual-compiled: error in backend tsconfig but not frontend
		// @ts-ignore -- Worker is a DOM global (valid in frontend tsconfig but not backend)
		const w: { postMessage(msg: WorkerRequest): void; addEventListener(event: "message", handler: (event: { data: WorkerResponse }) => void): void } = new Worker(new URL("./ranking.worker.ts", import.meta.url), { type: "module" });
		w.addEventListener("message", (event) => {
			handleWorkerResponse(event.data);
		});
		workerPostMessage = (msg) => {
			w.postMessage(msg);
		};
		return;
	}

	// Node: use worker_threads
	const { Worker: NodeWorker } = await import("node:worker_threads");
	const workerPath = new URL("./ranking.worker.ts", import.meta.url);
	const w = new NodeWorker(workerPath);
	w.on("message", (data: WorkerResponse) => {
		handleWorkerResponse(data);
	});
	workerPostMessage = (msg) => {
		w.postMessage(msg);
	};
}

let nextRequestId = 0;

function postToWorker(request: SelectPairRequest): Promise<SelectPairResponse>;
function postToWorker(request: BayesianRefitRequest): Promise<BayesianRefitResponse>;
function postToWorker(request: WorkerRequest): Promise<WorkerResponse> {
	return new Promise((resolve) => {
		pendingRequests.set(request.id, { resolve });
		workerPostMessage(request);
	});
}
