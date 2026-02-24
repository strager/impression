// ============================================================
// Top-k Identification via Bayesian Bradley-Terry
// with Information-Gain Pair Selection — Pure Math Functions
// ============================================================
//
// This module contains the stateless mathematical functions used by
// the Ranking class. It is designed to be imported by the worker
// script without triggering circular dependencies.
//
// topKEntropy uses a sum-of-marginals surrogate rather than the
// true joint top-k set entropy H(S). The original Monte Carlo
// estimator of H(S) was too slow for interactive use despite being
// a closer approximation of the optimal objective. The surrogate
// is deterministic and faster but not guaranteed to preserve pair
// ordering in all cases.
// ============================================================

export type WinLoss = readonly [winner: number, loser: number];

export type RemainingEstimate = { low: number; mid: number; high: number } | null;

/**
 * A (k, weight) pair for multi-objective pair selection.
 * computeInformationGain accepts an array of these to evaluate
 * information gain as a weighted sum across multiple K values.
 */
export interface KWeight {
	readonly k: number;
	readonly weight: number;
}

/** Create a xorshift32 PRNG returning values in (0, 1). */
export function makeXorshift(seed: number): () => number {
	let state = seed === 0 ? 1 : seed;
	return () => {
		state ^= state << 13;
		state ^= state >> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x100000000;
	};
}

/**
 * Evaluate all possible pairs and return the one whose comparison would
 * teach us the most about which items are in the top-k.
 *
 * Exhaustive search over all C(N,2) pairs using computeInformationGain.
 * Applies a recency discount to pairs containing items from the last
 * comparison to reduce repeated presentations of the same item.
 *
 * @param recencyDiscount - multiplier in (0, 1] applied to the information
 *   gain of pairs that include items from the most recent comparison.
 *   1.0 = no discount; 0.5 = halve the effective informativeness of
 *   recently-shown items. Default 1.0.
 * @returns [i, j] — the most informative pair of indices
 */
export function selectPair(mu: Float64Array, sigma: Float64Array, history: readonly WinLoss[], kOrWeights: number | readonly KWeight[], n: number, priorVariance: number, recencyDiscount = 1.0): [number, number] {
	let bestPair: [number, number] = [0, 1];
	let bestGain = -Infinity;

	// Extract the last pair from history for recency discounting
	const lastPair = history.length > 0 ? history[history.length - 1] : null;

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			let gain = computeInformationGain(i, j, mu, sigma, history, kOrWeights, n, priorVariance);

			// Penalize pairs that include items from the last comparison.
			// Gain is negative (higher = better), so dividing by a value < 1
			// makes the gain more negative (worse), discouraging repeat items.
			if (lastPair !== null && recencyDiscount < 1) {
				if (i === lastPair[0] || i === lastPair[1]) {
					gain /= recencyDiscount;
				}
				if (j === lastPair[0] || j === lastPair[1]) {
					gain /= recencyDiscount;
				}
			}

			if (gain > bestGain) {
				bestGain = gain;
				bestPair = [i, j];
			}
		}
	}

	return bestPair;
}

/**
 * Compute the expected information gain about the top-k identity from
 * comparing items i vs j. Simulates both outcomes ("i wins" and "j wins"),
 * refits the model for each, computes the resulting top-k entropy, and
 * returns the negative expected posterior entropy (higher = more informative).
 *
 * @param kOrWeights - either a single k (number) or an array of KWeight
 *   for multi-objective evaluation. When given KWeight[], the information
 *   gain is a weighted sum of topKEntropy across all K values. bayesianRefit
 *   is called once per outcome regardless; only topKEntropy (cheap) is
 *   called multiple times. Weights below 0.01 are skipped.
 *
 * Chaloner, K., & Verdinelli, I. (1995). "Bayesian Experimental Design:
 *   A Review." Statistical Science, 10(3), 273-304.
 *
 * MacKay, D. J. C. (1992). "Information-Based Objective Functions for Active
 *   Model Selection." Neural Computation, 4(4), 590-604.
 *
 * Pfeiffer, T., Gao, X. A., Chen, Y., Mao, A., & Rand, D. G. (2012).
 *   "Adaptive Polling for Information Aggregation." AAAI, 26(1).
 */
export function computeInformationGain(i: number, j: number, mu: Float64Array, sigma: Float64Array, history: readonly WinLoss[], kOrWeights: number | readonly KWeight[], n: number, priorVariance: number): number {
	const weights: readonly KWeight[] = typeof kOrWeights === "number" ? [{ k: kOrWeights, weight: 1 }] : kOrWeights;

	const pIWins = sigmoid(mu[i] - mu[j]);
	const pJWins = 1 - pIWins;

	// Simulate outcome: i beats j
	const historyI: WinLoss[] = [...history, [i, j]];
	const refitI = bayesianRefit(historyI, n, priorVariance);

	// Simulate outcome: j beats i
	const historyJ: WinLoss[] = [...history, [j, i]];
	const refitJ = bayesianRefit(historyJ, n, priorVariance);

	// Compute weighted sum of topKEntropy across K objectives
	let expectedPosteriorEntropy = 0;
	for (const { k, weight } of weights) {
		if (weight < 0.01) continue;
		const entropyIfIWins = topKEntropy(refitI.mu, refitI.sigma, k);
		const entropyIfJWins = topKEntropy(refitJ.mu, refitJ.sigma, k);
		expectedPosteriorEntropy += weight * (pIWins * entropyIfIWins + pJWins * entropyIfJWins);
	}

	return -expectedPosteriorEntropy; // higher is better (lower expected entropy)
}

/**
 * Stop when the weakest top-k item's lower confidence bound exceeds the
 * strongest non-top-k item's upper confidence bound.
 *
 * Kalyanakrishnan, S., Tewari, A., Auer, P., & Stone, P. (2012). "PAC
 *   Subset Selection in Stochastic Multi-Armed Bandits." ICML.
 *
 * Kaufmann, E., & Kalyanakrishnan, S. (2013). "Information Complexity in
 *   Bandit Subset Selection." COLT.
 *
 * @param mu - MAP strength estimates
 * @param sigma - marginal standard deviations
 * @param k - number of top items
 * @param z - confidence level (e.g. 1.96 for 95%)
 * @param confidenceThreshold - gap must exceed this value (default 0)
 */
export function checkConfidenceStop(mu: Float64Array, sigma: Float64Array, k: number, z: number, confidenceThreshold: number): boolean {
	const constraint = findBindingConstraint(mu, sigma, k, z);
	if (constraint === null) return true; // k >= n, all items in top-k
	return constraint.weakestLcb - constraint.strongestUcb > confidenceThreshold;
}

/**
 * Find the binding constraint for confidence-based stopping: the weakest
 * top-k item (lowest LCB) and the strongest non-top-k item (highest UCB).
 *
 * Returns null when k >= n (all items are in the top-k).
 */
function findBindingConstraint(mu: Float64Array, sigma: Float64Array, k: number, z: number): { weakestIdx: number; weakestLcb: number; strongestIdx: number; strongestUcb: number } | null {
	const sorted = argsortDescending(mu);
	const topK = sorted.slice(0, k);
	const rest = sorted.slice(k);

	if (rest.length === 0) return null;

	let weakestIdx = topK[0];
	let weakestLcb = mu[topK[0]] - z * sigma[topK[0]];
	for (const i of topK) {
		const lcb = mu[i] - z * sigma[i];
		if (lcb < weakestLcb) {
			weakestLcb = lcb;
			weakestIdx = i;
		}
	}

	let strongestIdx = rest[0];
	let strongestUcb = mu[rest[0]] + z * sigma[rest[0]];
	for (const j of rest) {
		const ucb = mu[j] + z * sigma[j];
		if (ucb > strongestUcb) {
			strongestUcb = ucb;
			strongestIdx = j;
		}
	}

	return { weakestIdx, weakestLcb, strongestIdx, strongestUcb };
}

/**
 * Check if the top-k set has been unchanged for stabilityWindow rounds.
 * Returns the new stable count and the current top-k set (as a sorted array
 * of indices).
 *
 * @param mu - MAP strength estimates
 * @param k - number of top items
 * @param previousTopK - previous top-k set (sorted array of indices), or null
 * @param stableCount - current consecutive stable round count
 * @param stabilityWindow - number of consecutive stable rounds to trigger stop
 */
export function checkStabilityStop(mu: Float64Array, k: number, previousTopK: readonly number[] | null, stableCount: number, stabilityWindow: number): { stopped: boolean; topK: number[]; stableCount: number } {
	const sorted = argsortDescending(mu);
	const currentTopK = sorted.slice(0, k).sort((a, b) => a - b);

	let same = false;
	if (previousTopK !== null && previousTopK.length === currentTopK.length) {
		same = true;
		for (let i = 0; i < currentTopK.length; i++) {
			if (currentTopK[i] !== previousTopK[i]) {
				same = false;
				break;
			}
		}
	}

	const newStableCount = same ? stableCount + 1 : 0;

	return {
		stopped: newStableCount >= stabilityWindow,
		topK: currentTopK,
		stableCount: newStableCount,
	};
}

/**
 * Estimate how many rounds remain until the stability stop triggers.
 *
 * Uses the empirical flip rate from a sliding window of recent rounds to
 * model the expected number of consecutive non-flip rounds needed. Produces
 * a confidence interval via a Beta posterior on the flip probability.
 *
 * @param flipHistory - boolean array: true = top-k set changed on that round
 * @param stableCount - current consecutive stable round count
 * @param stabilityWindow - number of consecutive stable rounds to trigger stop
 * @param maxRemaining - optional hard cap on remaining rounds
 */
export function estimateStabilityStop(flipHistory: readonly boolean[], stableCount: number, stabilityWindow: number, maxRemaining?: number): RemainingEstimate {
	const cappedMaxRemaining = maxRemaining !== undefined ? Math.max(0, maxRemaining) : undefined;
	if (cappedMaxRemaining !== undefined && cappedMaxRemaining === 0) {
		return { low: 0, mid: 0, high: 0 };
	}

	if (flipHistory.length < stabilityWindow) return null;

	const needed = stabilityWindow - stableCount;

	// Empirical flip rate from sliding window with Jeffreys prior
	const window = Math.min(15, flipHistory.length);
	let flips = 0;
	for (let i = flipHistory.length - window; i < flipHistory.length; i++) {
		if (flipHistory[i]) flips++;
	}
	const p = (flips + 0.5) / (window + 1);

	// Expected remaining rounds via Markov chain:
	// Need `needed` consecutive non-flip rounds.
	// E[rounds] = (1/q) * ((1/q)^needed - 1) / (1/q - 1) when p >= 0.01
	function expectedRounds(flipProb: number, need: number): number {
		if (need <= 0) return 0;
		const qq = 1 - flipProb;
		if (flipProb < 0.01) return need;
		const invQ = 1 / qq;
		return (invQ * (Math.pow(invQ, need) - 1)) / (invQ - 1);
	}

	const rawMid = expectedRounds(p, needed);

	// Confidence interval via normal approximation to Beta posterior
	const se = 0.675 * Math.sqrt((p * (1 - p)) / (window + 1));
	const pLow = Math.max(0, p - se);
	const pHigh = Math.min(0.99, p + se);

	// Higher flip prob → more remaining rounds
	const rawLow = expectedRounds(pLow, needed);
	const rawHigh = expectedRounds(pHigh, needed);

	const low = cappedMaxRemaining === undefined ? rawLow : Math.min(rawLow, cappedMaxRemaining);
	const mid = cappedMaxRemaining === undefined ? rawMid : Math.min(rawMid, cappedMaxRemaining);
	const high = cappedMaxRemaining === undefined ? rawHigh : Math.min(rawHigh, cappedMaxRemaining);

	// Hide unreliable estimates where the confidence interval is too wide
	if (high > 3 * low && high - low > stabilityWindow) return null;

	return { low, mid, high };
}

/**
 * Helper: return indices sorted by descending mu value.
 */
export function argsortDescending(mu: Float64Array): number[] {
	const indices: number[] = [];
	for (let i = 0; i < mu.length; i++) {
		indices.push(i);
	}
	indices.sort((a, b) => mu[b] - mu[a]);
	return indices;
}

/**
 * Standard normal CDF: P(Z ≤ x) where Z ~ N(0,1).
 *
 * Uses the Abramowitz & Stegun rational approximation (formula 26.2.17).
 * Maximum absolute error ≈ 7.5 × 10⁻⁸.
 */
export function normalCDF(x: number): number {
	if (x < -8) return 0;
	if (x > 8) return 1;
	const a = Math.abs(x);
	const t = 1 / (1 + 0.2316419 * a);
	const d = 0.3989422804014327; // 1/sqrt(2*pi)
	const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
	const tail = d * Math.exp(-0.5 * a * a) * poly;
	return x >= 0 ? 1 - tail : tail;
}

// Gauss-Hermite quadrature nodes and weights (Q=7).
// These integrate ∫ f(t)·exp(-t²) dt exactly for polynomial f of degree ≤ 13.
// Source: Abramowitz & Stegun, Table 25.10.
const GH_NODES: readonly number[] = [-2.6519613568352334, -1.6735516287674714, -0.8162878828589647, 0.0, 0.8162878828589647, 1.6735516287674714, 2.6519613568352334];
const GH_WEIGHTS: readonly number[] = [0.0009717812450995193, 0.054515582819127044, 0.4256072526101283, 0.8102646175568073, 0.4256072526101283, 0.054515582819127044, 0.0009717812450995193];

const SIGMA_EPS = 1e-15;
const INV_SQRT_PI = 1 / Math.sqrt(Math.PI);

/**
 * Compute P(at most k-1 of the items j ≠ skipIndex exceed threshold x),
 * where each item j independently exceeds x with probability qProbs[j].
 *
 * Uses dynamic programming over a Poisson binomial distribution.
 * The dp buffer (length ≥ k) is overwritten and reused across calls.
 */
function poissonBinomialAtMostK(qProbs: Float64Array, n: number, k: number, skipIndex: number, dp: Float64Array): number {
	// dp[m] = P(exactly m successes among items processed so far)
	dp[0] = 1;
	for (let m = 1; m < k; m++) dp[m] = 0;

	let count = 0;
	for (let j = 0; j < n; j++) {
		if (j === skipIndex) continue;
		const q = qProbs[j];
		const limit = Math.min(count, k - 2);
		for (let m = limit + 1; m >= 1; m--) {
			dp[m] = dp[m] * (1 - q) + dp[m - 1] * q;
		}
		dp[0] *= 1 - q;
		count++;
	}

	// Sum dp[0..k-1] = P(at most k-1 successes)
	let sum = 0;
	for (let m = 0; m < k; m++) {
		sum += dp[m];
	}
	return sum;
}

/**
 * Compute p_i = P(item i ∈ top-k) via Gauss-Hermite quadrature.
 *
 * Integrates over item i's score distribution and, at each quadrature
 * point, uses the Poisson binomial DP to compute the probability that
 * at most k-1 other items outscore item i.
 *
 * The dp (length ≥ k) and qProbs (length ≥ n) buffers are reused.
 */
function topKMarginalProb(i: number, mu: Float64Array, sigma: Float64Array, k: number, n: number, dp: Float64Array, qProbs: Float64Array): number {
	const si = sigma[i];

	// If sigma_i ≈ 0, item i's score is deterministic at mu_i.
	if (si < SIGMA_EPS) {
		const x = mu[i];
		for (let j = 0; j < n; j++) {
			if (sigma[j] < SIGMA_EPS) {
				qProbs[j] = mu[j] > x ? 1 : 0;
			} else {
				qProbs[j] = 1 - normalCDF((x - mu[j]) / sigma[j]);
			}
		}
		return poissonBinomialAtMostK(qProbs, n, k, i, dp);
	}

	let weightedSum = 0;

	for (let q = 0; q < GH_NODES.length; q++) {
		const x = mu[i] + si * Math.SQRT2 * GH_NODES[q];

		// Compute P(item j > x) for each j
		for (let j = 0; j < n; j++) {
			if (sigma[j] < SIGMA_EPS) {
				qProbs[j] = mu[j] > x ? 1 : 0;
			} else {
				// P(j > x) = 1 - Φ((x - μ_j) / σ_j)
				qProbs[j] = 1 - normalCDF((x - mu[j]) / sigma[j]);
			}
		}

		weightedSum += GH_WEIGHTS[q] * poissonBinomialAtMostK(qProbs, n, k, i, dp);
	}

	// Gauss-Hermite computes ∫ f(t)·exp(-t²) dt; normalizing to ∫ φ(x) g(x) dx
	// requires a factor of 1/√π after the substitution x = μ + σ√2·t.
	return weightedSum * INV_SQRT_PI;
}

/**
 * Estimate how uncertain we still are about which K items are the best.
 *
 * Computes a surrogate for the true joint top-k set entropy H(S) using
 * the sum of per-item marginal membership entropies:
 *   H_proxy = Σ_i h(p_i), where p_i = P(item i ∈ top-k)
 * and h(p) = -p log(p) - (1-p) log(1-p) is binary entropy.
 *
 * This is an upper bound on H(S) (by subadditivity of entropy) and is
 * not guaranteed to preserve the ordering of pairs by information gain.
 * It is used as a speed-oriented surrogate: the original Monte Carlo
 * estimator of H(S) was too slow (65,000 samples per pair selection)
 * despite being a closer approximation of the optimal objective.
 *
 * Each p_i is computed via Gauss-Hermite quadrature over item i's
 * posterior score distribution, combined with a Poisson binomial DP
 * for the probability that at most k-1 other items outscore item i.
 *
 * @param mu - MAP strength estimates (length N)
 * @param sigma - marginal standard deviations (length N)
 * @param k - number of top items to identify
 */
export function topKEntropy(mu: Float64Array, sigma: Float64Array, k: number): number {
	const n = mu.length;
	if (k <= 0 || k >= n) return 0;

	// Pre-allocate buffers reused across items and quadrature points.
	const dp = new Float64Array(k);
	const qProbs = new Float64Array(n);

	let entropy = 0;
	for (let i = 0; i < n; i++) {
		const p = topKMarginalProb(i, mu, sigma, k, n, dp, qProbs);
		if (p > 0 && p < 1) {
			entropy -= p * Math.log(p) + (1 - p) * Math.log(1 - p);
		}
	}

	return entropy;
}

/**
 * Box-Muller transform: generate a standard normal sample from two uniform
 * random numbers in (0, 1).
 */
export function boxMuller(rng: () => number): number {
	const u1 = rng();
	const u2 = rng();
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Full Bayesian refit of all N strength parameters.
 *
 * Instead of just guessing a single score for each item, we track how *sure*
 * we are about each score. An item that's been compared ten times has a tight
 * range. An item compared once has a wide range. This function re-estimates
 * all scores and their uncertainties from scratch given the full history.
 *
 * Maximizes the log-posterior:
 *   log P(strengths | data) =
 *     sum_{(w,l) in history} log sigma(mu_w - mu_l)    [likelihood]
 *     - sum_i  mu_i^2 / (2 * priorVariance)            [Gaussian prior]
 *
 * Pins mu[0] = 0 for identifiability (Bradley-Terry strengths are only
 * defined up to a constant). Optimizes the remaining N-1 free parameters
 * with Newton's method, then extracts sigma from the inverse Hessian
 * (Laplace approximation).
 *
 * Caron, F., & Doucet, A. (2012). "Efficient Bayesian Inference for
 *   Generalized Bradley-Terry Models." JCGS, 21(1), 174-196.
 *
 * Herbrich, R., Minka, T., & Graepel, T. (2006). "TrueSkill: A Bayesian
 *   Skill Rating System." NeurIPS, 19.
 *
 * @param history - array of [winner, loser] index pairs
 * @param n - number of items
 * @param priorVariance - prior variance for each strength parameter
 * @returns mu (MAP estimates) and sigma (marginal standard deviations)
 */
export function bayesianRefit(history: readonly WinLoss[], n: number, priorVariance: number): { mu: Float64Array; sigma: Float64Array } {
	const mu = new Float64Array(n); // all zeros
	const sigma = new Float64Array(n);

	// Edge case: no data — return prior
	if (history.length === 0) {
		sigma.fill(Math.sqrt(priorVariance));
		return { mu, sigma };
	}

	// We pin mu[0] = 0 and optimize indices 1..n-1.
	// m = n-1 is the number of free parameters.
	const m = n - 1;

	// Working arrays for the free parameters (indices 1..n-1 of the full mu)
	const theta = new Float64Array(m); // initialized to 0

	const NEWTON_MAX_ITER = 50;
	const NEWTON_TOL = 1e-8;

	for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
		// Build full mu from theta (mu[0]=0, mu[i]=theta[i-1] for i>=1)
		mu[0] = 0;
		for (let i = 0; i < m; i++) {
			mu[i + 1] = theta[i];
		}

		// Compute gradient and Hessian of the negative log-posterior
		// w.r.t. the free parameters theta[0..m-1].
		const grad = new Float64Array(m);
		const hess = new Float64Array(m * m);

		// Prior contribution: -mu_i^2 / (2*priorVariance)
		// Gradient of negative log-posterior from prior: mu_i / priorVariance
		// Hessian diagonal from prior: 1 / priorVariance
		for (let i = 0; i < m; i++) {
			grad[i] = theta[i] / priorVariance;
			hess[i * m + i] = 1.0 / priorVariance;
		}

		// Likelihood contribution from each comparison
		for (const [winner, loser] of history) {
			const diff = mu[winner] - mu[loser];
			const p = sigmoid(diff);
			// gradient of -log(sigma(diff)) w.r.t. mu_winner is -(1-p)
			// gradient of -log(sigma(diff)) w.r.t. mu_loser is p
			// Hessian contribution: p*(1-p) for second derivative

			const pq = p * (1 - p);

			// Map full indices to free parameter indices (skip index 0)
			const wi = winner - 1; // -1 if winner is item 0
			const li = loser - 1;

			if (wi >= 0) {
				grad[wi] -= 1 - p;
			}
			if (li >= 0) {
				grad[li] += 1 - p;
			}

			// Hessian contributions
			if (wi >= 0) {
				hess[wi * m + wi] += pq;
			}
			if (li >= 0) {
				hess[li * m + li] += pq;
			}
			if (wi >= 0 && li >= 0) {
				hess[wi * m + li] -= pq;
				hess[li * m + wi] -= pq;
			}
		}

		// Newton step: delta = H^{-1} * grad
		// We need to solve H * delta = grad
		const hessL = new Float64Array(hess);
		choleskyDecompose(hessL, m);

		const delta = new Float64Array(grad);
		choleskySolve(hessL, delta, m);

		// Update: theta -= delta (we minimized neg log-posterior)
		let maxDelta = 0;
		for (let i = 0; i < m; i++) {
			theta[i] -= delta[i];
			maxDelta = Math.max(maxDelta, Math.abs(delta[i]));
		}

		if (maxDelta < NEWTON_TOL) {
			break;
		}
	}

	// Final mu
	mu[0] = 0;
	for (let i = 0; i < m; i++) {
		mu[i + 1] = theta[i];
	}

	// Compute sigma from inverse Hessian at the converged point
	// Rebuild Hessian at final theta
	const finalHess = new Float64Array(m * m);
	for (let i = 0; i < m; i++) {
		finalHess[i * m + i] = 1.0 / priorVariance;
	}
	for (const [winner, loser] of history) {
		const diff = mu[winner] - mu[loser];
		const p = sigmoid(diff);
		const pq = p * (1 - p);
		const wi = winner - 1;
		const li = loser - 1;
		if (wi >= 0) {
			finalHess[wi * m + wi] += pq;
		}
		if (li >= 0) {
			finalHess[li * m + li] += pq;
		}
		if (wi >= 0 && li >= 0) {
			finalHess[wi * m + li] -= pq;
			finalHess[li * m + wi] -= pq;
		}
	}

	choleskyDecompose(finalHess, m);
	const inv = choleskyInverse(finalHess, m);

	// sigma[0] for the pinned parameter: derive from the prior (it's pinned,
	// but for downstream use we report the prior uncertainty since it has no
	// data-driven update via the free parameters)
	sigma[0] = 0; // pinned, no uncertainty
	for (let i = 0; i < m; i++) {
		const variance = inv[i * m + i];
		sigma[i + 1] = Math.sqrt(Math.max(0, variance));
	}

	return { mu, sigma };
}

/**
 * The Bradley-Terry-Luce preference model.
 *
 * Every item has a hidden strength score. When you compare two items, the one
 * with the higher score is more likely to win — but not guaranteed, because
 * humans are noisy. This function turns the difference in scores into a
 * probability of winning.
 *
 * Bradley, R. A., & Terry, M. E. (1952). "Rank Analysis of Incomplete Block
 *   Designs: I. The Method of Paired Comparisons." Biometrika, 39(3/4),
 *   324–345.
 *
 * Luce, R. D. (1959). Individual Choice Behavior: A Theoretical Analysis.
 *   Wiley.
 */
export function sigmoid(x: number): number {
	return 1.0 / (1.0 + Math.exp(-x));
}

// ---- Linear algebra helpers (Cholesky) ----
// These operate on dense symmetric positive-definite matrices stored as
// Float64Array in row-major order. They are exported for testing but are
// internal implementation details of bayesianRefit.

/**
 * In-place Cholesky decomposition: A = L * L^T.
 * Overwrites the lower triangle of `a` with L. The upper triangle is not
 * zeroed out (callers must only read the lower triangle).
 *
 * @param a - n×n symmetric positive-definite matrix (row-major Float64Array)
 * @param n - dimension
 */
export function choleskyDecompose(a: Float64Array, n: number): void {
	for (let j = 0; j < n; j++) {
		let sum = 0;
		for (let k = 0; k < j; k++) {
			sum += a[j * n + k] * a[j * n + k];
		}
		const diag = a[j * n + j] - sum;
		if (diag <= 0) {
			throw new Error("Matrix is not positive definite");
		}
		a[j * n + j] = Math.sqrt(diag);

		for (let i = j + 1; i < n; i++) {
			let s = 0;
			for (let k = 0; k < j; k++) {
				s += a[i * n + k] * a[j * n + k];
			}
			a[i * n + j] = (a[i * n + j] - s) / a[j * n + j];
		}
	}
}

/**
 * Solve L * L^T * x = b given Cholesky factor L.
 * Forward substitution (L * y = b) then back substitution (L^T * x = y).
 *
 * @param l - n×n lower-triangular Cholesky factor (row-major)
 * @param b - right-hand side vector (overwritten with solution)
 * @param n - dimension
 */
export function choleskySolve(l: Float64Array, b: Float64Array, n: number): void {
	// Forward substitution: L * y = b
	for (let i = 0; i < n; i++) {
		let sum = 0;
		for (let j = 0; j < i; j++) {
			sum += l[i * n + j] * b[j];
		}
		b[i] = (b[i] - sum) / l[i * n + i];
	}

	// Back substitution: L^T * x = y
	for (let i = n - 1; i >= 0; i--) {
		let sum = 0;
		for (let j = i + 1; j < n; j++) {
			sum += l[j * n + i] * b[j];
		}
		b[i] = (b[i] - sum) / l[i * n + i];
	}
}

/**
 * Check if the ranking can stop early with a reduced K value.
 *
 * Loops from k-1 down to minK, returning the largest K that passes
 * checkConfidenceStop, or null if none pass. The caller typically
 * passes a z-score higher than the base z (the "reluctance" penalty)
 * that decays over time, so early rounds require very strong evidence
 * while later rounds accept the same threshold as full-K confidence.
 */
export function checkAdaptiveKReduction(mu: Float64Array, sigma: Float64Array, k: number, minK: number, z: number, confidenceThreshold: number): number | null {
	for (let reducedK = k - 1; reducedK >= minK; reducedK--) {
		if (checkConfidenceStop(mu, sigma, reducedK, z, confidenceThreshold)) {
			return reducedK;
		}
	}
	return null;
}

/**
 * Compute the full inverse of A given its Cholesky factor L, where A = L*L^T.
 * Returns a new Float64Array containing the n×n inverse matrix.
 *
 * @param l - n×n lower-triangular Cholesky factor (row-major)
 * @param n - dimension
 * @returns n×n inverse matrix (row-major Float64Array)
 */
export function choleskyInverse(l: Float64Array, n: number): Float64Array {
	const inv = new Float64Array(n * n);
	const col = new Float64Array(n);

	for (let j = 0; j < n; j++) {
		// Solve L * L^T * x = e_j
		col.fill(0);
		col[j] = 1;
		choleskySolve(l, col, n);
		for (let i = 0; i < n; i++) {
			inv[i * n + j] = col[i];
		}
	}

	return inv;
}
