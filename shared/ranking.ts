// ============================================================
// Active Ranking via MaxDiff (Best-Worst Scaling)
// ============================================================
//
// Identifies the top K items from N items through MaxDiff tasks.
// Each task shows m items; the user picks the best and worst.
// Uses sequential logit MLE + Laplace approximation for
// uncertainty-aware adaptive task selection.
// ============================================================

import type { MaxDiffObservation, RemainingEstimate, XorshiftRng } from "./ranking-math.ts";
import { argsortDescending, bayesianTopKProbability, confidentTopK, enumerateCombinations, estimateRemainingFisher, fitSequentialLogitMLE, makeXorshift, pairBalancedShuffle } from "./ranking-math.ts";

export { argsortDescending, makeXorshift } from "./ranking-math.ts";
export type { MaxDiffObservation, RemainingEstimate, XorshiftRng } from "./ranking-math.ts";

export type StopMode = "boundary_only" | "all_cross_pairs" | "bayesian";

export interface RankingConfig {
	/** Number of top items to identify. */
	k: number;
	/** Minimum acceptable top-k if full k can't be confidently identified. Default k. */
	minK: number;
	/** Hard cap on total tasks. Default: depends on n (40 for n<=8, 100 for n>=12, linear between). Set to 0 to use the n-dependent default. */
	maxTasks: number;
	/** Failure probability for confidence check. Default: depends on n. Set to 0 to use the n-dependent default. */
	delta: number;
	/** L2 regularization strength. Default 0.5. */
	lambdaL2: number;
	/** Minimum exposures per item before confidence stop. Default 2. */
	minExposures: number;
	/** Number of candidate task sets to evaluate. Default 20. */
	candidatePool: number;
	/** Number of items per task. Default 3. */
	m: number;
	/** RNG seed. Default Date.now(). */
	seed: number;
	/** Stop algorithm. Default "boundary_only". */
	stopMode: StopMode;
	/** Failure probability for reduced-k confidence check at budget limit. Default 0.05. */
	minKDelta: number;
}

export type StopReason = "confidence" | "reduced-k" | "max-tasks";

export interface TaskRecord<T> {
	set: T[];
	best: T;
	worst: T;
}

const DEFAULT_CONFIG: RankingConfig = {
	k: 5,
	minK: 5,
	maxTasks: 0,
	delta: 0,
	lambdaL2: 0.5,
	minExposures: 2,
	candidatePool: 20,
	m: 3,
	seed: 0,
	stopMode: "boundary_only",
	minKDelta: 0.05,
};

/**
 * Active ranking algorithm using MaxDiff (Best-Worst Scaling).
 *
 * Identifies the top K items from N items through iterative MaxDiff tasks.
 * Each task presents m items; the user picks best and worst.
 *
 * Usage:
 *   const ranking = new Ranking(items);
 *   while (!ranking.stopped) {
 *     const { items: taskItems } = ranking.selectTask();
 *     // show taskItems to user, get their best and worst choices
 *     ranking.recordTask(best, worst);
 *   }
 *   console.log(ranking.topK);
 */
export class Ranking<T> {
	private readonly _items: readonly T[];
	private readonly _config: RankingConfig;
	private readonly _n: number;

	// Model state
	private _mu: Float64Array;
	private _sigma: Float64Array; // N×N flat
	private _exposures: number[];
	private _observations: MaxDiffObservation[];
	private _taskRecords: TaskRecord<T>[];
	private _pendingTask: number[] | null;
	private _totalTasks: number;

	// Balanced task schedule (BIBD)
	private _taskSchedule: number[][];
	private _scheduleIndex: number;

	// RNG
	private readonly _seed: number;
	private _rng: XorshiftRng;

	// Hysteresis for estimate visibility
	private _lastEstimateMid: number | null;
	private _consecutiveNulls: number;
	private _estimateShown: boolean;

	// Stopping
	private _stopped: boolean;
	private _stopReason: StopReason | null;
	private _effectiveK: number;

	constructor(items: readonly T[], config?: Partial<RankingConfig>) {
		this._items = items;
		this._config = { ...DEFAULT_CONFIG, ...config };
		// If minK not explicitly provided, default to k
		if (config !== undefined && config.minK === undefined) {
			this._config.minK = this._config.k;
		}
		if (this._config.seed === 0) {
			this._config.seed = Date.now();
		}
		this._n = items.length;
		if (this._config.maxTasks === 0) {
			if (this._n <= 8) this._config.maxTasks = 40;
			else if (this._n >= 12) this._config.maxTasks = 100;
			else this._config.maxTasks = Math.round(40 + ((100 - 40) * (this._n - 8)) / (12 - 8));
		}
		if (this._config.delta === 0) {
			if (this._n <= 8) this._config.delta = 0.05;
			else if (this._n <= 10) this._config.delta = 0.1;
			else this._config.delta = 0.15;
		}
		this._seed = this._config.seed;
		this._rng = makeXorshift(this._seed);

		this._mu = new Float64Array(this._n);
		this._sigma = new Float64Array(this._n * this._n);
		this._exposures = new Array<number>(this._n).fill(0);
		this._observations = [];
		this._taskRecords = [];
		this._pendingTask = null;
		this._totalTasks = 0;
		this._lastEstimateMid = null;
		this._consecutiveNulls = 0;
		this._estimateShown = false;
		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = this._config.k;
		this._taskSchedule = [];
		this._scheduleIndex = 0;

		// Initialize with prior covariance
		const initVar = 1.0 / (2 * this._config.lambdaL2);
		for (let i = 0; i < this._n; i++) {
			this._sigma[i * this._n + i] = initVar;
		}

		// Check trivial case: k >= n
		if (this._config.k >= this._n) {
			this._stopped = true;
			this._stopReason = "confidence";
		}
	}

	private _indexOf(item: T): number {
		const idx = this._items.indexOf(item);
		if (idx === -1) {
			throw new Error("Item not found in ranking");
		}
		return idx;
	}

	private _isConfident(k: number, delta: number): boolean {
		if (this._config.stopMode === "bayesian") {
			const rng = makeXorshift(this._totalTasks * 31337);
			return bayesianTopKProbability(this._mu, this._sigma, k, 2000, rng) >= 1 - delta;
		}
		return confidentTopK(this._mu, this._sigma, k, delta, this._config.stopMode);
	}

	private _generateSchedule(): void {
		const combos = enumerateCombinations(this._n, this._config.m);
		this._taskSchedule = pairBalancedShuffle(combos, this._n, this._rng);
		this._scheduleIndex = 0;
	}

	private _selectTaskInternal(): number[] {
		if (this._pendingTask !== null) {
			return this._pendingTask;
		}

		if (this._config.m >= this._n) {
			const all: number[] = [];
			for (let i = 0; i < this._n; i++) all.push(i);
			this._pendingTask = all;
			return all;
		}

		if (this._scheduleIndex >= this._taskSchedule.length) {
			this._generateSchedule();
		}

		const task = this._taskSchedule[this._scheduleIndex++];
		this._pendingTask = task;
		return task;
	}

	private _recordTaskInternal(bestIdx: number, worstIdx: number): void {
		if (this._pendingTask === null) {
			throw new Error("No pending task to record");
		}

		const set = this._pendingTask;
		const obs: MaxDiffObservation = { set: [...set], best: bestIdx, worst: worstIdx };
		this._observations.push(obs);

		for (const idx of set) {
			this._exposures[idx]++;
		}

		this._totalTasks++;
		this._pendingTask = null;

		// Refit MLE on full dataset
		const result = fitSequentialLogitMLE(this._observations, this._n, this._config.lambdaL2);
		this._mu = result.mu;
		this._sigma = result.sigma;

		// Check confidence stop (only after minimum coverage)
		const minExp = Math.min(...this._exposures);
		if (minExp >= this._config.minExposures) {
			if (this._isConfident(this._config.k, this._config.delta)) {
				this._effectiveK = this._config.k;
				this._stopped = true;
				this._stopReason = "confidence";
				return;
			}
		}

		// Check hard budget
		if (this._totalTasks >= this._config.maxTasks) {
			// At budget limit, try reduced k values before giving up.
			if (this._config.minK < this._config.k) {
				for (let kk = this._config.k - 1; kk >= this._config.minK; kk--) {
					if (this._isConfident(kk, this._config.minKDelta)) {
						this._effectiveK = kk;
						this._stopped = true;
						this._stopReason = "reduced-k";
						return;
					}
				}
			}
			this._stopped = true;
			this._stopReason = "max-tasks";
		}
	}

	private _replay(observations: readonly MaxDiffObservation[], taskRecords: readonly TaskRecord<T>[]): void {
		// Reset all state
		this._mu = new Float64Array(this._n);
		this._sigma = new Float64Array(this._n * this._n);
		const initVar = 1.0 / (2 * this._config.lambdaL2);
		for (let i = 0; i < this._n; i++) {
			this._sigma[i * this._n + i] = initVar;
		}
		this._exposures = new Array<number>(this._n).fill(0);
		this._observations = [];
		this._taskRecords = [];
		this._pendingTask = null;
		this._totalTasks = 0;
		this._lastEstimateMid = null;
		this._consecutiveNulls = 0;
		this._estimateShown = false;
		this._stopped = false;
		this._stopReason = null;
		this._effectiveK = this._config.k;
		this._taskSchedule = [];
		this._scheduleIndex = 0;

		// Check trivial case
		if (this._config.k >= this._n) {
			this._stopped = true;
			this._stopReason = "confidence";
			return;
		}

		// Re-create RNG from seed
		this._rng = makeXorshift(this._seed);

		// Replay each task
		for (let i = 0; i < observations.length; i++) {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- _recordTaskInternal can set _stopped
			if (this._stopped) break;
			const obs = observations[i];
			this._selectTaskInternal(); // advances RNG
			this._taskRecords.push(taskRecords[i]);
			this._recordTaskInternal(obs.best, obs.worst);
		}
	}

	selectTask(): { items: T[] } {
		if (this._stopped) {
			throw new Error("Ranking has already stopped");
		}

		const task = this._selectTaskInternal();
		return { items: task.map((i) => this._items[i]) };
	}

	recordTask(best: T, worst: T, set?: readonly T[]): { stopped: boolean; stopReason: StopReason | null } {
		if (this._stopped) {
			throw new Error("Ranking has already stopped");
		}

		const bi = this._indexOf(best);
		const wi = this._indexOf(worst);

		if (set !== undefined) {
			// Replay path: use the provided set and advance the schedule
			// to keep RNG in sync.
			const taskIndices = set.map((item) => this._indexOf(item));
			this._selectTaskInternal(); // advance RNG/schedule
			this._pendingTask = taskIndices;
		} else if (this._pendingTask === null) {
			// Auto-select task if none pending
			this._selectTaskInternal();
		}

		const pendingTask = this._pendingTask;
		if (pendingTask === null) {
			throw new Error("Failed to select task");
		}

		this._taskRecords.push({
			set: pendingTask.map((i) => this._items[i]),
			best,
			worst,
		});
		this._recordTaskInternal(bi, wi);

		return { stopped: this._stopped, stopReason: this._stopReason };
	}

	undoLastTask(): TaskRecord<T> {
		if (this._observations.length === 0) {
			throw new Error("No task to undo");
		}

		const record = this._taskRecords[this._taskRecords.length - 1];
		const newObs = this._observations.slice(0, -1);
		const newRecords = this._taskRecords.slice(0, -1);
		this._replay(newObs, newRecords);

		return record;
	}

	get topK(): readonly T[] {
		const ranking = argsortDescending(this._mu);
		const ek = Math.min(this._effectiveK, this._n);
		return ranking.slice(0, ek).map((i) => this._items[i]);
	}

	get effectiveK(): number {
		return this._effectiveK;
	}

	get delta(): number {
		return this._config.delta;
	}

	get maxTasks(): number {
		return this._config.maxTasks;
	}

	get round(): number {
		return this._totalTasks;
	}

	get stopped(): boolean {
		return this._stopped;
	}

	get stopReason(): StopReason | null {
		return this._stopReason;
	}

	get history(): readonly TaskRecord<T>[] {
		return this._taskRecords;
	}

	clone(): Ranking<T> {
		const copy = new Ranking(this._items, { ...this._config });
		copy._replay(this._observations, this._taskRecords);
		return copy;
	}

	estimateRemaining(): RemainingEstimate {
		if (this._stopped) return 0;
		const est = estimateRemainingFisher(this._mu, this._sigma, this._config.k, this._config.m, this._config.delta, this._config.maxTasks, this._totalTasks);
		if (est !== null) {
			this._lastEstimateMid = est;
			this._consecutiveNulls = 0;
			this._estimateShown = true;
			return est;
		}
		// Gate wants to hide. If already showing, tolerate a few null rounds.
		this._consecutiveNulls++;
		if (this._estimateShown && this._consecutiveNulls <= 2 && this._lastEstimateMid !== null) {
			return Math.max(0, this._lastEstimateMid - this._consecutiveNulls);
		}
		this._estimateShown = false;
		return null;
	}

	debugState(): {
		mu: Float64Array;
		sigma: Float64Array;
		exposures: readonly number[];
		config: RankingConfig;
		round: number;
	} {
		return {
			mu: this._mu,
			sigma: this._sigma,
			exposures: this._exposures,
			config: this._config,
			round: this._totalTasks,
		};
	}
}
