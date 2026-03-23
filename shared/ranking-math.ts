// ============================================================
// MaxDiff (Best-Worst Scaling) — Pure Math Functions
// ============================================================
//
// Sequential logit model for MaxDiff observations:
//   P(best=b | set S)       = softmax(u over S)[b]
//   P(worst=w | S\{b})      = softmax(-u over S\{b})[w]
//
// MLE with L2 regularization + Laplace approximation for
// uncertainty (inverse Hessian as approximate covariance).
// ============================================================

export interface MaxDiffObservation {
	set: number[];
	best: number;
	worst: number;
}

export type RemainingEstimate = number | null;

export interface XorshiftRng {
	/** Return next value in (0, 1). */
	next(): number;
	/** Current internal state (readable/restorable). */
	state: number;
}

/** Create a xorshift32 PRNG returning values in (0, 1). */
export function makeXorshift(seed: number): XorshiftRng {
	let state = seed === 0 ? 1 : seed;
	return {
		next(): number {
			state ^= state << 13;
			state ^= state >> 17;
			state ^= state << 5;
			return (state >>> 0) / 0x100000000;
		},
		get state(): number {
			return state;
		},
		set state(s: number) {
			state = s;
		},
	};
}

/**
 * Helper: return indices sorted by descending value.
 */
export function argsortDescending(values: Float64Array | readonly number[]): number[] {
	const indices: number[] = [];
	for (let i = 0; i < values.length; i++) {
		indices.push(i);
	}
	indices.sort((a, b) => {
		const va = typeof values[a] === "number" ? values[a] : 0;
		const vb = typeof values[b] === "number" ? values[b] : 0;
		return vb - va;
	});
	return indices;
}

/**
 * Log-likelihood of a single MaxDiff observation under the sequential logit model.
 *
 * P(best=b, worst=w | S, u) = softmax(u over S)[b] * softmax(-u over S\{b})[w]
 */
export function sequentialLogitLogLik(obs: MaxDiffObservation, u: Float64Array): number {
	const { set, best, worst } = obs;

	// log P(best | set) = u[best] - log(sum exp(u[j]) for j in set)
	let maxU = -Infinity;
	for (const j of set) {
		if (u[j] > maxU) maxU = u[j];
	}
	let sumExp = 0;
	for (const j of set) {
		sumExp += Math.exp(u[j] - maxU);
	}
	const logPBest = u[best] - maxU - Math.log(sumExp);

	// log P(worst | set\{best}) using -u
	const setMinusBest = set.filter((j) => j !== best);
	let maxNegU = -Infinity;
	for (const j of setMinusBest) {
		if (-u[j] > maxNegU) maxNegU = -u[j];
	}
	let sumExpNeg = 0;
	for (const j of setMinusBest) {
		sumExpNeg += Math.exp(-u[j] - maxNegU);
	}
	const logPWorst = -u[worst] - maxNegU - Math.log(sumExpNeg);

	return logPBest + logPWorst;
}

/**
 * Gradient of regularized negative log-posterior:
 *   -sum log P(obs) + lambda * ||u||^2
 */
export function negLogPosteriorGradient(data: readonly MaxDiffObservation[], u: Float64Array, lambdaL2: number, n: number): Float64Array {
	const grad = new Float64Array(n);

	for (const obs of data) {
		const { set, best, worst } = obs;

		// Softmax probabilities for best choice
		let maxU = -Infinity;
		for (const j of set) {
			if (u[j] > maxU) maxU = u[j];
		}
		let sumExp = 0;
		const expU: number[] = [];
		for (const j of set) {
			const e = Math.exp(u[j] - maxU);
			expU.push(e);
			sumExp += e;
		}

		// grad_i of -log P(best) = p_i - indicator(i == best)
		for (let idx = 0; idx < set.length; idx++) {
			const j = set[idx];
			const p = expU[idx] / sumExp;
			grad[j] += p - (j === best ? 1 : 0);
		}

		// Softmax probabilities for worst choice (using -u over set\{best})
		const setMinusBest = set.filter((j) => j !== best);
		let maxNegU = -Infinity;
		for (const j of setMinusBest) {
			if (-u[j] > maxNegU) maxNegU = -u[j];
		}
		let sumExpNeg = 0;
		const expNegU: number[] = [];
		for (const j of setMinusBest) {
			const e = Math.exp(-u[j] - maxNegU);
			expNegU.push(e);
			sumExpNeg += e;
		}

		// grad_i of -log P(worst) = -(q_i - indicator(i == worst))
		// = -q_i + indicator(i == worst)
		// But since we're using -u, the chain rule gives:
		// d/du_i [-log softmax(-u)[worst]] = q_i - indicator(i == worst)
		// Wait, let me be careful. Let v = -u. softmax(v)[w] = exp(v_w)/sum exp(v_j).
		// -log softmax(v)[w] = -v_w + log sum exp(v_j)
		// d/du_i = d/dv_i * dv_i/du_i = (softmax(v)[i] - indicator(i==w)) * (-1)
		// = -(softmax(-u)[i] - indicator(i==w))
		// = -q_i + indicator(i==w)
		for (let idx = 0; idx < setMinusBest.length; idx++) {
			const j = setMinusBest[idx];
			const q = expNegU[idx] / sumExpNeg;
			grad[j] += -q + (j === worst ? 1 : 0);
		}
	}

	// L2 regularization: + 2 * lambda * u_i
	for (let i = 0; i < n; i++) {
		grad[i] += 2 * lambdaL2 * u[i];
	}

	return grad;
}

/**
 * Hessian of regularized negative log-posterior (dense N×N, row-major Float64Array).
 */
export function negLogPosteriorHessian(data: readonly MaxDiffObservation[], u: Float64Array, lambdaL2: number, n: number): Float64Array {
	const H = new Float64Array(n * n);

	for (const obs of data) {
		const { set, best } = obs;

		// Best-choice Hessian contribution: diag(p) - p*p^T
		const probs = softmaxProbs(set, u);
		for (let si = 0; si < set.length; si++) {
			const i = set[si];
			const pi = probs[si];
			for (let sj = 0; sj < set.length; sj++) {
				H[i * n + set[sj]] += -pi * probs[sj];
			}
			H[i * n + i] += pi;
		}

		// Worst-choice Hessian contribution: diag(q) - q*q^T over set\{best} with -u
		const setMinusBest = set.filter((j) => j !== best);
		const negU = new Float64Array(n);
		for (let i = 0; i < n; i++) negU[i] = -u[i];
		const qProbs = softmaxProbs(setMinusBest, negU);
		for (let si = 0; si < setMinusBest.length; si++) {
			const i = setMinusBest[si];
			const qi = qProbs[si];
			for (let sj = 0; sj < setMinusBest.length; sj++) {
				H[i * n + setMinusBest[sj]] += -qi * qProbs[sj];
			}
			H[i * n + i] += qi;
		}
	}

	// L2 regularization: + 2 * lambda * I
	for (let i = 0; i < n; i++) {
		H[i * n + i] += 2 * lambdaL2;
	}

	return H;
}

/** Compute softmax probabilities for indices in `set` using utilities `u`. */
function softmaxProbs(set: readonly number[], u: Float64Array): number[] {
	let maxVal = -Infinity;
	for (const j of set) {
		if (u[j] > maxVal) maxVal = u[j];
	}
	let sumExp = 0;
	const probs: number[] = new Array<number>(set.length);
	for (let i = 0; i < set.length; i++) {
		const e = Math.exp(u[set[i]] - maxVal);
		probs[i] = e;
		sumExp += e;
	}
	for (let i = 0; i < set.length; i++) {
		probs[i] /= sumExp;
	}
	return probs;
}

/**
 * Invert a dense N×N matrix (row-major Float64Array) using Gaussian elimination
 * with partial pivoting. Adds eps to diagonal for numerical stability.
 */
export function invertMatrix(h: Float64Array, n: number, eps: number): Float64Array {
	// Build augmented matrix [H | I]
	const aug = new Float64Array(n * 2 * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			aug[i * 2 * n + j] = h[i * n + j];
		}
		aug[i * 2 * n + i] += eps;
		aug[i * 2 * n + n + i] = 1;
	}

	const cols = 2 * n;

	// Forward elimination with partial pivoting
	for (let col = 0; col < n; col++) {
		// Find pivot
		let maxVal = Math.abs(aug[col * cols + col]);
		let maxRow = col;
		for (let row = col + 1; row < n; row++) {
			const v = Math.abs(aug[row * cols + col]);
			if (v > maxVal) {
				maxVal = v;
				maxRow = row;
			}
		}

		// Swap rows
		if (maxRow !== col) {
			for (let j = 0; j < cols; j++) {
				const tmp = aug[col * cols + j];
				aug[col * cols + j] = aug[maxRow * cols + j];
				aug[maxRow * cols + j] = tmp;
			}
		}

		const pivot = aug[col * cols + col];

		// Scale pivot row
		for (let j = col; j < cols; j++) {
			aug[col * cols + j] /= pivot;
		}

		// Eliminate column
		for (let row = 0; row < n; row++) {
			if (row === col) continue;
			const factor = aug[row * cols + col];
			for (let j = col; j < cols; j++) {
				aug[row * cols + j] -= factor * aug[col * cols + j];
			}
		}
	}

	// Extract inverse from right half
	const inv = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			inv[i * n + j] = aug[i * cols + n + j];
		}
	}
	return inv;
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
 */
export function normalCdf(z: number): number {
	if (z < -8) return 0;
	if (z > 8) return 1;

	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const sign = z < 0 ? -1 : 1;
	const x = Math.abs(z) / Math.SQRT2;
	const t = 1.0 / (1.0 + p * x);
	const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

	return 0.5 * (1 + sign * y);
}

/**
 * Fit MLE utilities and compute Laplace approximation covariance.
 *
 * Newton's method with sum(u)=0 constraint enforced by projection.
 * Returns { mu, sigma } where sigma is the diagonal of the inverse Hessian
 * (full covariance is also available internally but we only need the diagonal
 * and pairwise terms for confidentTopK).
 */
export function fitSequentialLogitMLE(data: readonly MaxDiffObservation[], n: number, lambdaL2: number): { mu: Float64Array; sigma: Float64Array } {
	const mu = new Float64Array(n);
	const sigma = new Float64Array(n * n);

	if (data.length === 0 || n <= 1) {
		// Initial high uncertainty
		const initVar = 1.0 / (2 * lambdaL2);
		for (let i = 0; i < n; i++) {
			sigma[i * n + i] = initVar;
		}
		return { mu, sigma };
	}

	// Newton's method
	const maxIter = 50;
	const tol = 1e-8;
	const u = new Float64Array(n);

	for (let iter = 0; iter < maxIter; iter++) {
		const grad = negLogPosteriorGradient(data, u, lambdaL2, n);
		const H = negLogPosteriorHessian(data, u, lambdaL2, n);

		// Solve H * delta = -grad
		// Simple approach: invert H, multiply
		const Hinv = invertMatrix(H, n, 1e-8);
		const delta = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				delta[i] -= Hinv[i * n + j] * grad[j];
			}
		}

		// Update
		for (let i = 0; i < n; i++) {
			u[i] += delta[i];
		}

		// Project to sum(u)=0
		let sum = 0;
		for (let i = 0; i < n; i++) sum += u[i];
		const mean = sum / n;
		for (let i = 0; i < n; i++) u[i] -= mean;

		// Check convergence
		let maxDelta = 0;
		for (let i = 0; i < n; i++) {
			const d = Math.abs(delta[i]);
			if (d > maxDelta) maxDelta = d;
		}
		if (maxDelta < tol) break;
	}

	// Copy solution
	for (let i = 0; i < n; i++) mu[i] = u[i];

	// Laplace approximation: Sigma = H^{-1} at the optimum
	const H = negLogPosteriorHessian(data, mu, lambdaL2, n);
	const Sigma = invertMatrix(H, n, 1e-6);
	for (let i = 0; i < n * n; i++) sigma[i] = Sigma[i];

	return { mu, sigma };
}

/**
 * Check if the current top-k is confidently identified.
 *
 * Uses the Gaussian approximation: u_i - u_j ~ N(mu_i - mu_j, Sigma_ii + Sigma_jj - 2*Sigma_ij)
 */
export function confidentTopK(mu: Float64Array, sigma: Float64Array, k: number, delta: number, mode: "boundary_only" | "all_cross_pairs"): boolean {
	const n = mu.length;
	if (k >= n) return true;
	if (k <= 0) return true;

	const ranking = argsortDescending(mu);

	function pBeats(i: number, j: number): number {
		const meanDiff = mu[i] - mu[j];
		const varDiff = sigma[i * n + i] + sigma[j * n + j] - 2 * sigma[i * n + j];
		const z = meanDiff / Math.sqrt(Math.max(varDiff, 1e-12));
		return normalCdf(z);
	}

	if (mode === "boundary_only") {
		const iStar = ranking[k - 1]; // weakest within top-k
		const jStar = ranking[k]; // strongest outside top-k
		return pBeats(iStar, jStar) >= 1 - delta;
	}

	// all_cross_pairs
	for (let ki = 0; ki < k; ki++) {
		for (let oi = k; oi < n; oi++) {
			if (pBeats(ranking[ki], ranking[oi]) < 1 - delta) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Estimate P(current top-k set is correct) by Monte Carlo sampling
 * from the posterior N(mu, sigma).
 *
 * Performs Cholesky decomposition of sigma, draws nSamples from the
 * multivariate normal, and counts how often the top-k set matches.
 */
export function bayesianTopKProbability(mu: Float64Array, sigma: Float64Array, k: number, nSamples: number, rng: XorshiftRng): number {
	const n = mu.length;
	if (k >= n || k <= 0) return 1;

	// Current top-k set
	const currentRanking = argsortDescending(mu);
	const currentTopK = new Set(currentRanking.slice(0, k));

	// Cholesky decomposition: L such that L L^T = sigma
	const L = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j <= i; j++) {
			let sum = 0;
			for (let p = 0; p < j; p++) {
				sum += L[i * n + p] * L[j * n + p];
			}
			if (i === j) {
				L[i * n + j] = Math.sqrt(Math.max(sigma[i * n + j] - sum, 0));
			} else {
				const denom = L[j * n + j];
				L[i * n + j] = denom > 0 ? (sigma[i * n + j] - sum) / denom : 0;
			}
		}
	}

	// Box-Muller + Cholesky sampling
	let matches = 0;
	const normals = new Float64Array(n);
	const sample = new Float64Array(n);

	for (let s = 0; s < nSamples; s++) {
		// Generate standard normals via Box-Muller
		for (let i = 0; i < n; i += 2) {
			const u1 = rng.next();
			const u2 = rng.next();
			const r = Math.sqrt(-2 * Math.log(u1));
			normals[i] = r * Math.cos(2 * Math.PI * u2);
			if (i + 1 < n) {
				normals[i + 1] = r * Math.sin(2 * Math.PI * u2);
			}
		}

		// sample = mu + L * normals
		for (let i = 0; i < n; i++) {
			let val = mu[i];
			for (let j = 0; j <= i; j++) {
				val += L[i * n + j] * normals[j];
			}
			sample[i] = val;
		}

		// Check if top-k set matches
		const sampleRanking = argsortDescending(sample);
		let match = true;
		for (let i = 0; i < k; i++) {
			if (!currentTopK.has(sampleRanking[i])) {
				match = false;
				break;
			}
		}
		if (match) matches++;
	}

	return matches / nSamples;
}

/**
 * Score a candidate task set by sum of pairwise variance.
 * Higher = more informative (targets uncertainty reduction).
 */
export function scoreTaskSet(set: readonly number[], sigma: Float64Array, n: number): number {
	let score = 0;
	for (let i = 0; i < set.length; i++) {
		for (let j = i + 1; j < set.length; j++) {
			const a = set[i];
			const b = set[j];
			score += sigma[a * n + a] + sigma[b * n + b] - 2 * sigma[a * n + b];
		}
	}
	return score;
}

/**
 * Enumerate all C(n, m) combinations of m items from 0..n-1.
 * Each combination is sorted ascending.
 */
export function enumerateCombinations(n: number, m: number): number[][] {
	const result: number[][] = [];
	const combo = new Array<number>(m);

	function recurse(start: number, depth: number): void {
		if (depth === m) {
			result.push([...combo]);
			return;
		}
		for (let i = start; i <= n - (m - depth); i++) {
			combo[depth] = i;
			recurse(i + 1, depth + 1);
		}
	}

	recurse(0, 0);
	return result;
}

/**
 * In-place Fisher-Yates shuffle using the provided RNG.
 */
export function shuffleArray(arr: unknown[], rng: XorshiftRng): void {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		const tmp = arr[i];
		arr[i] = arr[j];
		arr[j] = tmp;
	}
}

/**
 * Pair-balanced greedy shuffle: reorder triplets so that least-covered pairs
 * are prioritized. Guarantees all pairs are covered early and pair counts
 * stay balanced throughout.
 *
 * Algorithm: for each slot, find the minimum pair count, collect all remaining
 * triplets that contain at least one pair with that count, randomly pick one.
 */
export function pairBalancedShuffle(triplets: number[][], n: number, rng: XorshiftRng): number[][] {
	const pairCounts = new Int32Array(n * n);
	const remaining = [...triplets.map((t, i) => i)]; // indices into triplets
	const result: number[][] = [];

	for (const _ of triplets) {
		// Find minimum pair count across all C(n,2) pairs
		let minCount = Infinity;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				if (pairCounts[i * n + j] < minCount) {
					minCount = pairCounts[i * n + j];
				}
			}
		}

		// Collect candidates: triplets containing at least one pair with minCount
		const candidates: number[] = [];
		for (let ri = 0; ri < remaining.length; ri++) {
			const t = triplets[remaining[ri]];
			let hasMin = false;
			for (let a = 0; a < t.length && !hasMin; a++) {
				for (let b = a + 1; b < t.length && !hasMin; b++) {
					const lo = Math.min(t[a], t[b]);
					const hi = Math.max(t[a], t[b]);
					if (pairCounts[lo * n + hi] === minCount) {
						hasMin = true;
					}
				}
			}
			if (hasMin) candidates.push(ri);
		}

		// Randomly pick one candidate
		const pick = candidates[Math.floor(rng.next() * candidates.length)];
		const chosen = triplets[remaining[pick]];
		result.push(chosen);

		// Update pair counts
		for (let a = 0; a < chosen.length; a++) {
			for (let b = a + 1; b < chosen.length; b++) {
				const lo = Math.min(chosen[a], chosen[b]);
				const hi = Math.max(chosen[a], chosen[b]);
				pairCounts[lo * n + hi]++;
			}
		}

		// Remove from remaining (swap with last)
		remaining[pick] = remaining[remaining.length - 1];
		remaining.pop();
	}

	return result;
}

/**
 * Estimate remaining tasks using Fisher information budget.
 *
 * Computes how much variance reduction the boundary contrast needs,
 * estimates the average per-task contribution by evaluating the Fisher
 * information of each possible task in the schedule, and divides.
 */
export function estimateRemainingFisher(mu: Float64Array, sigma: Float64Array, k: number, m: number, delta: number, maxTasks: number, totalTasks: number): RemainingEstimate {
	const n = mu.length;
	if (k >= n || k <= 0) return 0;

	const ranking = argsortDescending(mu);
	const iStar = ranking[k - 1];
	const jStar = ranking[k];
	const meanDiff = mu[iStar] - mu[jStar];
	if (meanDiff <= 0) return null;

	const varDiff = sigma[iStar * n + iStar] + sigma[jStar * n + jStar] - 2 * sigma[iStar * n + jStar];
	const currentZ = meanDiff / Math.sqrt(Math.max(varDiff, 1e-12));
	const targetZ = -inverseNormalCdf(delta);
	if (currentZ >= targetZ) return 0;

	// Don't show until the boundary gap has meaningful signal.
	if (currentZ < 0.5) return null;

	// Target variance for the boundary contrast: varDiff_target = (meanDiff / targetZ)^2
	const targetVarDiff = (meanDiff / targetZ) ** 2;
	const varToReduce = varDiff - targetVarDiff;
	if (varToReduce <= 0) return 0;

	// If the correction factor is too large, the estimate is too speculative.
	if (varDiff / targetVarDiff > 10) return null;

	// Contrast vector: e[iStar]=1, e[jStar]=-1, rest 0.
	// Sigma * e column:
	const sigmaE = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		sigmaE[i] = sigma[i * n + iStar] - sigma[i * n + jStar];
	}

	// Enumerate all C(n, m) tasks and compute average variance reduction.
	// For one observation with Hessian contribution H_obs, the first-order
	// variance reduction on the contrast is: e^T Sigma H_obs Sigma e.
	const combos = enumerateCombinations(n, m);
	let totalReduction = 0;
	const negU = new Float64Array(n);
	for (let i = 0; i < n; i++) negU[i] = -mu[i];

	for (const set of combos) {
		// Best-choice contribution: diag(p) - p*p^T over the set
		const probs = softmaxProbs(set, mu);

		// Compute (diag(p) - p*p^T) * sigmaE restricted to set indices,
		// then dot with sigmaE to get e^T Sigma H_best Sigma e.
		// H_best_sigmaE[i] = sum_j H_best[set[i], set[j]] * sigmaE[set[j]]
		//                   = p[i]*sigmaE[set[i]] - p[i] * sum_j(p[j]*sigmaE[set[j]])
		let pDotSigmaE = 0;
		for (let si = 0; si < set.length; si++) {
			pDotSigmaE += probs[si] * sigmaE[set[si]];
		}
		let bestReduction = 0;
		for (let si = 0; si < set.length; si++) {
			const hSigmaE_i = probs[si] * sigmaE[set[si]] - probs[si] * pDotSigmaE;
			bestReduction += sigmaE[set[si]] * hSigmaE_i;
		}

		// Worst-choice contribution: diag(q) - q*q^T over set\{best} with -u
		// The noise-free best is the item in set with highest mu.
		let bestIdx = set[0];
		for (const j of set) {
			if (mu[j] > mu[bestIdx]) bestIdx = j;
		}
		const setMinusBest = set.filter((j) => j !== bestIdx);
		const qProbs = softmaxProbs(setMinusBest, negU);

		let qDotSigmaE = 0;
		for (let si = 0; si < setMinusBest.length; si++) {
			qDotSigmaE += qProbs[si] * sigmaE[setMinusBest[si]];
		}
		let worstReduction = 0;
		for (let si = 0; si < setMinusBest.length; si++) {
			const hSigmaE_i = qProbs[si] * sigmaE[setMinusBest[si]] - qProbs[si] * qDotSigmaE;
			worstReduction += sigmaE[setMinusBest[si]] * hSigmaE_i;
		}

		totalReduction += bestReduction + worstReduction;
	}

	const avgReduction = totalReduction / combos.length;
	if (avgReduction <= 0) return null;

	// The per-task reduction rate shrinks as Sigma shrinks. Model the decay
	// as dv/dt = -r*(v/v0)^2, which gives: T = varToReduce * varDiff / (r * targetVarDiff).
	// The correction factor varDiff/targetVarDiff accounts for diminishing returns.
	const mid = Math.min(Math.ceil((varToReduce * varDiff) / (avgReduction * targetVarDiff)), maxTasks - totalTasks);
	return Math.max(0, mid);
}

function inverseNormalCdf(p: number): number {
	// Rational approximation (Abramowitz & Stegun 26.2.23)
	if (p <= 0) return -8;
	if (p >= 1) return 8;
	if (p === 0.5) return 0;

	const sign = p < 0.5 ? -1 : 1;
	const pp = p < 0.5 ? p : 1 - p;
	const t = Math.sqrt(-2 * Math.log(pp));

	const c0 = 2.515517;
	const c1 = 0.802853;
	const c2 = 0.010328;
	const d1 = 1.432788;
	const d2 = 0.189269;
	const d3 = 0.001308;

	return sign * (t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t));
}
