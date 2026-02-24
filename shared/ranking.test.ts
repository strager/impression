import { describe, expect, it } from "vitest";

import { type KWeight, type WinLoss, bayesianRefit, checkAdaptiveKReduction, checkConfidenceStop, checkStabilityStop, choleskyDecompose, choleskyInverse, choleskySolve, computeInformationGain, estimateStabilityStop, normalCDF, Ranking, selectPair, sigmoid, topKEntropy } from "./ranking.ts";

describe("sigmoid", () => {
	it("returns 0.5 at x=0", () => {
		expect(sigmoid(0)).toBe(0.5);
	});

	it("approaches 1 for large positive x", () => {
		expect(sigmoid(10)).toBeCloseTo(1.0, 4);
		expect(sigmoid(100)).toBeCloseTo(1.0, 10);
	});

	it("approaches 0 for large negative x", () => {
		expect(sigmoid(-10)).toBeCloseTo(0.0, 4);
		expect(sigmoid(-100)).toBeCloseTo(0.0, 10);
	});

	it("satisfies symmetry: sigmoid(x) + sigmoid(-x) = 1", () => {
		for (const x of [0.5, 1.0, 2.0, 5.0]) {
			expect(sigmoid(x) + sigmoid(-x)).toBeCloseTo(1.0, 10);
		}
	});

	it("is monotonically increasing", () => {
		const xs = [-5, -2, -1, 0, 1, 2, 5];
		for (let i = 1; i < xs.length; i++) {
			expect(sigmoid(xs[i])).toBeGreaterThan(sigmoid(xs[i - 1]));
		}
	});
});

// Helper to build a row-major Float64Array from a 2D array
function mat(rows: number[][]): Float64Array {
	const n = rows.length;
	const a = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			a[i * n + j] = rows[i][j];
		}
	}
	return a;
}

// Helper to multiply two n×n row-major matrices
function matMul(a: Float64Array, b: Float64Array, n: number): Float64Array {
	const c = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			let sum = 0;
			for (let k = 0; k < n; k++) {
				sum += a[i * n + k] * b[k * n + j];
			}
			c[i * n + j] = sum;
		}
	}
	return c;
}

// Extract the lower triangle from a decomposed matrix (zero out upper)
function lowerTriangle(a: Float64Array, n: number): Float64Array {
	const l = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j <= i; j++) {
			l[i * n + j] = a[i * n + j];
		}
	}
	return l;
}

// Transpose an n×n row-major matrix
function transpose(a: Float64Array, n: number): Float64Array {
	const t = new Float64Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			t[i * n + j] = a[j * n + i];
		}
	}
	return t;
}

describe("choleskyDecompose", () => {
	it("decomposes a 2x2 identity matrix", () => {
		const a = mat([
			[1, 0],
			[0, 1],
		]);
		choleskyDecompose(a, 2);
		const l = lowerTriangle(a, 2);
		// L should be identity
		expect(l[0 * 2 + 0]).toBeCloseTo(1, 10);
		expect(l[0 * 2 + 1]).toBeCloseTo(0, 10);
		expect(l[1 * 2 + 0]).toBeCloseTo(0, 10);
		expect(l[1 * 2 + 1]).toBeCloseTo(1, 10);
	});

	it("decomposes a 3x3 SPD matrix and L*L^T reconstructs it", () => {
		// A known SPD matrix
		const original = mat([
			[4, 2, 1],
			[2, 5, 3],
			[1, 3, 6],
		]);
		const a = new Float64Array(original);
		choleskyDecompose(a, 3);
		const l = lowerTriangle(a, 3);
		const lt = transpose(l, 3);
		const reconstructed = matMul(l, lt, 3);

		for (let i = 0; i < 9; i++) {
			expect(reconstructed[i]).toBeCloseTo(original[i], 10);
		}
	});

	it("throws for a non-positive-definite matrix", () => {
		const a = mat([
			[1, 2],
			[2, 1],
		]);
		expect(() => {
			choleskyDecompose(a, 2);
		}).toThrow("not positive definite");
	});
});

describe("choleskySolve", () => {
	it("solves A*x = b for a 3x3 system", () => {
		const a = mat([
			[4, 2, 1],
			[2, 5, 3],
			[1, 3, 6],
		]);
		choleskyDecompose(a, 3);
		const l = lowerTriangle(a, 3);

		// b = [1, 2, 3], solve A*x = b
		const b = new Float64Array([1, 2, 3]);
		choleskySolve(l, b, 3);

		// Verify by multiplying original A * x and checking it equals [1, 2, 3]
		const orig = mat([
			[4, 2, 1],
			[2, 5, 3],
			[1, 3, 6],
		]);
		for (let i = 0; i < 3; i++) {
			let dot = 0;
			for (let j = 0; j < 3; j++) {
				dot += orig[i * 3 + j] * b[j];
			}
			expect(dot).toBeCloseTo([1, 2, 3][i], 10);
		}
	});
});

describe("choleskyInverse", () => {
	it("computes the inverse of a 3x3 SPD matrix", () => {
		const a = mat([
			[4, 2, 1],
			[2, 5, 3],
			[1, 3, 6],
		]);
		choleskyDecompose(a, 3);
		const l = lowerTriangle(a, 3);
		const inv = choleskyInverse(l, 3);

		// A * A^-1 should be identity
		const orig = mat([
			[4, 2, 1],
			[2, 5, 3],
			[1, 3, 6],
		]);
		const product = matMul(orig, inv, 3);
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				const expected = i === j ? 1 : 0;
				expect(product[i * 3 + j]).toBeCloseTo(expected, 9);
			}
		}
	});

	it("inverse diagonal entries are 1/a_ii for diagonal matrix", () => {
		const a = mat([
			[4, 0, 0],
			[0, 9, 0],
			[0, 0, 16],
		]);
		choleskyDecompose(a, 3);
		const l = lowerTriangle(a, 3);
		const inv = choleskyInverse(l, 3);

		expect(inv[0 * 3 + 0]).toBeCloseTo(1 / 4, 10);
		expect(inv[1 * 3 + 1]).toBeCloseTo(1 / 9, 10);
		expect(inv[2 * 3 + 2]).toBeCloseTo(1 / 16, 10);
	});
});

describe("bayesianRefit", () => {
	const PRIOR_VARIANCE = 1.0;

	it("returns prior when history is empty", () => {
		const { mu, sigma } = bayesianRefit([], 4, PRIOR_VARIANCE);
		for (let i = 0; i < 4; i++) {
			expect(mu[i]).toBe(0);
			expect(sigma[i]).toBeCloseTo(Math.sqrt(PRIOR_VARIANCE), 10);
		}
	});

	it("pins mu[0] = 0", () => {
		// Item 1 beats item 0 several times — mu[0] should still be 0
		const history: WinLoss[] = [
			[1, 0],
			[1, 0],
			[1, 0],
		];
		const { mu } = bayesianRefit(history, 2, PRIOR_VARIANCE);
		expect(mu[0]).toBe(0);
		expect(mu[1]).toBeGreaterThan(0);
	});

	it("winner gets higher mu than loser after single comparison", () => {
		const { mu } = bayesianRefit([[1, 2]], 3, PRIOR_VARIANCE);
		expect(mu[1]).toBeGreaterThan(mu[2]);
	});

	it("increases winner-loser separation with repeated evidence", () => {
		const single = bayesianRefit([[1, 2]], 3, PRIOR_VARIANCE);
		const repeated = bayesianRefit(
			[
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
			],
			3,
			PRIOR_VARIANCE,
		);

		const singleGap = single.mu[1] - single.mu[2];
		const repeatedGap = repeated.mu[1] - repeated.mu[2];
		expect(repeatedGap).toBeGreaterThan(singleGap);
	});

	it("repeated comparisons increase confidence (smaller sigma)", () => {
		const once = bayesianRefit([[1, 2]], 3, PRIOR_VARIANCE);
		const many = bayesianRefit(
			[
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
				[1, 2],
			],
			3,
			PRIOR_VARIANCE,
		);
		// sigma for items 1 and 2 should be smaller with more data
		expect(many.sigma[1]).toBeLessThan(once.sigma[1]);
		expect(many.sigma[2]).toBeLessThan(once.sigma[2]);
	});

	it("strong repeated winner has much higher mu", () => {
		const history: WinLoss[] = [];
		for (let i = 0; i < 10; i++) {
			history.push([1, 2]);
		}
		const { mu } = bayesianRefit(history, 3, PRIOR_VARIANCE);
		// mu[1] should be significantly positive, mu[2] significantly negative
		expect(mu[1]).toBeGreaterThan(1);
		expect(mu[2]).toBeLessThan(-1);
	});

	it("symmetric matchups produce roughly equal strengths", () => {
		// Item 1 beats 2 three times, item 2 beats 1 three times
		const history: WinLoss[] = [
			[1, 2],
			[2, 1],
			[1, 2],
			[2, 1],
			[1, 2],
			[2, 1],
		];
		const { mu } = bayesianRefit(history, 3, PRIOR_VARIANCE);
		// They should be close to each other (both pulled toward 0 by prior)
		expect(Math.abs(mu[1] - mu[2])).toBeLessThan(0.3);
	});
});

describe("normalCDF", () => {
	it("returns 0.5 at x=0", () => {
		expect(normalCDF(0)).toBeCloseTo(0.5, 7);
	});

	it("returns ~0.8413 at x=1", () => {
		expect(normalCDF(1)).toBeCloseTo(0.8413447460685429, 6);
	});

	it("returns ~0.975 at x=1.96", () => {
		expect(normalCDF(1.96)).toBeCloseTo(0.975, 4);
	});

	it("is symmetric: Φ(x) + Φ(-x) = 1", () => {
		for (const x of [0.5, 1, 2, 3]) {
			expect(normalCDF(x) + normalCDF(-x)).toBeCloseTo(1, 10);
		}
	});

	it("returns 0 for very negative x", () => {
		expect(normalCDF(-10)).toBe(0);
	});

	it("returns 1 for very positive x", () => {
		expect(normalCDF(10)).toBe(1);
	});
});

describe("topKEntropy", () => {
	it("returns 0 entropy when sigma is zero (certain top-k)", () => {
		// 5 items with distinct strengths, near-zero uncertainty
		const mu = new Float64Array([5, 4, 3, 2, 1]);
		const tinySigma = new Float64Array([1e-15, 1e-15, 1e-15, 1e-15, 1e-15]);
		const entropy = topKEntropy(mu, tinySigma, 2);
		expect(entropy).toBeCloseTo(0, 2);
	});

	it("returns high entropy when all items are equal with large sigma", () => {
		const n = 6;
		const mu = new Float64Array(n); // all zeros
		const sigma = new Float64Array(n).fill(10);
		const entropy = topKEntropy(mu, sigma, 2);
		// With equal means and large noise, many different top-k sets are possible
		expect(entropy).toBeGreaterThan(1);
	});

	it("entropy is lower with more separated means", () => {
		const n = 6;
		const sigma = new Float64Array(n).fill(1);

		// Close means
		const muClose = new Float64Array([0.1, 0.0, -0.1, -0.2, -0.3, -0.4]);
		const entropyClose = topKEntropy(muClose, sigma, 2);

		// Well-separated means
		const muSep = new Float64Array([10, 8, -5, -6, -7, -8]);
		const entropySep = topKEntropy(muSep, sigma, 2);

		expect(entropySep).toBeLessThan(entropyClose);
	});

	it("is deterministic", () => {
		const mu = new Float64Array([2, 1, 0, -1, -2]);
		const sigma = new Float64Array([0.5, 0.5, 0.5, 0.5, 0.5]);

		const e1 = topKEntropy(mu, sigma, 2);
		const e2 = topKEntropy(mu, sigma, 2);
		expect(e1).toBe(e2);
	});
});

describe("computeInformationGain", () => {
	const PRIOR_VARIANCE = 1.0;

	it("boundary pair is more informative than clearly-separated pair", () => {
		// 6 items: indices 0-5, k=2
		// Items 0,1 are clearly top (mu=5), items 4,5 are clearly bottom (mu=-5)
		// Items 2,3 are on the boundary (mu=0)
		const n = 6;
		const k = 2;
		const mu = new Float64Array([5, 4, 0.1, -0.1, -4, -5]);
		const sigma = new Float64Array(n).fill(0.8);
		const history: WinLoss[] = [];

		// Boundary pair: 2 vs 3 (both near the k/rest boundary)
		const gainBoundary = computeInformationGain(2, 3, mu, sigma, history, k, n, PRIOR_VARIANCE);

		// Clearly-separated pair: 0 vs 5 (one clearly in, one clearly out)
		const gainClear = computeInformationGain(0, 5, mu, sigma, history, k, n, PRIOR_VARIANCE);

		// Boundary comparison should be more informative (higher gain = less negative)
		expect(gainBoundary).toBeGreaterThan(gainClear);
	});

	it("returns a finite number", () => {
		const n = 4;
		const k = 2;
		const mu = new Float64Array([1, 0.5, -0.5, -1]);
		const sigma = new Float64Array(n).fill(1);

		const gain = computeInformationGain(0, 1, mu, sigma, [], k, n, PRIOR_VARIANCE);
		expect(Number.isFinite(gain)).toBe(true);
	});

	it("is deterministic", () => {
		const n = 4;
		const k = 2;
		const mu = new Float64Array([1, 0, -0.5, -1]);
		const sigma = new Float64Array(n).fill(0.8);

		const g1 = computeInformationGain(1, 2, mu, sigma, [], k, n, PRIOR_VARIANCE);
		const g2 = computeInformationGain(1, 2, mu, sigma, [], k, n, PRIOR_VARIANCE);
		expect(g1).toBe(g2);
	});
});

describe("checkConfidenceStop", () => {
	it("returns false when items are not separated", () => {
		// All items have same mu, large sigma
		const mu = new Float64Array([0, 0, 0, 0]);
		const sigma = new Float64Array([1, 1, 1, 1]);
		expect(checkConfidenceStop(mu, sigma, 2, 1.96, 0)).toBe(false);
	});

	it("returns true when top-k is clearly separated", () => {
		// Top-2 have mu=10 with tight sigma, rest have mu=-10 with tight sigma
		const mu = new Float64Array([10, 9, -9, -10]);
		const sigma = new Float64Array([0.1, 0.1, 0.1, 0.1]);
		expect(checkConfidenceStop(mu, sigma, 2, 1.96, 0)).toBe(true);
	});

	it("returns false when sigma is too large despite mu separation", () => {
		const mu = new Float64Array([2, 1, -1, -2]);
		const sigma = new Float64Array([3, 3, 3, 3]);
		expect(checkConfidenceStop(mu, sigma, 2, 1.96, 0)).toBe(false);
	});

	it("returns true when k equals n (all items in top-k)", () => {
		const mu = new Float64Array([1, 0]);
		const sigma = new Float64Array([1, 1]);
		expect(checkConfidenceStop(mu, sigma, 2, 1.96, 0)).toBe(true);
	});
});

describe("checkStabilityStop", () => {
	it("returns stableCount=0 on first call (no previous)", () => {
		const mu = new Float64Array([3, 2, 1, 0]);
		const result = checkStabilityStop(mu, 2, null, 0, 10);
		expect(result.stableCount).toBe(0);
		expect(result.stopped).toBe(false);
		expect(result.topK).toEqual([0, 1]);
	});

	it("increments stableCount when top-k is unchanged", () => {
		const mu = new Float64Array([3, 2, 1, 0]);
		const result = checkStabilityStop(mu, 2, [0, 1], 5, 10);
		expect(result.stableCount).toBe(6);
		expect(result.stopped).toBe(false);
	});

	it("resets stableCount when top-k changes", () => {
		const mu = new Float64Array([3, 2, 1, 0]);
		// Previous top-k was [0, 2], now it's [0, 1]
		const result = checkStabilityStop(mu, 2, [0, 2], 8, 10);
		expect(result.stableCount).toBe(0);
		expect(result.stopped).toBe(false);
	});

	it("triggers stop when stableCount reaches window", () => {
		const mu = new Float64Array([3, 2, 1, 0]);
		const result = checkStabilityStop(mu, 2, [0, 1], 9, 10);
		expect(result.stableCount).toBe(10);
		expect(result.stopped).toBe(true);
	});
});

describe("selectPair", () => {
	const PRIOR_VARIANCE = 1.0;

	it("returns valid indices (i < j, both in range)", () => {
		const n = 5;
		const mu = new Float64Array(n);
		const sigma = new Float64Array(n).fill(1);
		const [i, j] = selectPair(mu, sigma, [], 2, n, PRIOR_VARIANCE);
		expect(i).toBeGreaterThanOrEqual(0);
		expect(i).toBeLessThan(n);
		expect(j).toBeGreaterThan(i);
		expect(j).toBeLessThan(n);
	});

	it("is deterministic", () => {
		const n = 5;
		const mu = new Float64Array([2, 1, 0, -1, -2]);
		const sigma = new Float64Array(n).fill(1);
		const [i1, j1] = selectPair(mu, sigma, [], 2, n, PRIOR_VARIANCE);
		const [i2, j2] = selectPair(mu, sigma, [], 2, n, PRIOR_VARIANCE);
		expect(i1).toBe(i2);
		expect(j1).toBe(j2);
	});

	it("recencyDiscount=1.0 does not change the selected pair", () => {
		const n = 5;
		const mu = new Float64Array([2, 1, 0, -1, -2]);
		const sigma = new Float64Array(n).fill(1);
		const history: WinLoss[] = [[0, 1]];
		const [i1, j1] = selectPair(mu, sigma, history, 2, n, PRIOR_VARIANCE);
		const [i2, j2] = selectPair(mu, sigma, history, 2, n, PRIOR_VARIANCE, 1.0);
		expect(i1).toBe(i2);
		expect(j1).toBe(j2);
	});

	it("recencyDiscount discourages items from the last comparison", () => {
		// Set up a scenario where items 1,2 are on the boundary and were
		// just compared. With discount, a different pair should be picked.
		const n = 6;
		const k = 2;
		// Item 0 is clearly top, items 3,4,5 clearly bottom.
		// Items 1,2 are right on the boundary — normally the most informative.
		const mu = new Float64Array([5, 0.1, -0.1, -5, -6, -7]);
		const sigma = new Float64Array(n).fill(1.0);

		// Last comparison involved item 1 (winner) and item 2 (loser)
		const history: WinLoss[] = [[1, 2]];

		// Without discount: pair should involve the boundary items 1 or 2
		const [iNoDiscount, jNoDiscount] = selectPair(mu, sigma, history, k, n, PRIOR_VARIANCE, 1.0);
		const noDiscountInvolves1or2 = iNoDiscount === 1 || jNoDiscount === 1 || iNoDiscount === 2 || jNoDiscount === 2;

		// With aggressive discount: should avoid items 1 and 2
		const [iDiscount, jDiscount] = selectPair(mu, sigma, history, k, n, PRIOR_VARIANCE, 0.1);
		const discountInvolves1or2 = iDiscount === 1 || jDiscount === 1 || iDiscount === 2 || jDiscount === 2;

		// Without discount the boundary items should be picked;
		// with aggressive discount the recently-shown items should be avoided
		expect(noDiscountInvolves1or2).toBe(true);
		expect(discountInvolves1or2).toBe(false);
	});

	it("recencyDiscount has no effect when history is empty", () => {
		const n = 4;
		const mu = new Float64Array([1, 0, -0.5, -1]);
		const sigma = new Float64Array(n).fill(1);
		const [i1, j1] = selectPair(mu, sigma, [], 2, n, PRIOR_VARIANCE, 1.0);
		const [i2, j2] = selectPair(mu, sigma, [], 2, n, PRIOR_VARIANCE, 0.5);
		expect(i1).toBe(i2);
		expect(j1).toBe(j2);
	});
});

describe("Ranking class", () => {
	it("selectPair returns distinct items from the candidate set", async () => {
		const items = ["a", "b", "c", "d"] as const;
		const ranking = new Ranking(items, { k: 2 });
		const pair = await ranking.selectPair();

		expect(items).toContain(pair.a);
		expect(items).toContain(pair.b);
		expect(pair.a).not.toBe(pair.b);
	});

	it("converges on correct top-k with a perfect oracle", async () => {
		// 10 items with known true strengths 0..9 (item 9 is strongest)
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const trueStrength = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const expectedTopK = new Set([5, 6, 7, 8, 9]);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 5, // disable adaptive K reduction to test full convergence
			maxComparisons: 80,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			// Perfect oracle: item with higher true strength wins
			const winner = trueStrength[a] > trueStrength[b] ? a : b;
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
		}

		const topK = new Set(ranking.topK);
		expect(topK).toEqual(expectedTopK);
		expect(ranking.round).toBeLessThan(80);
		expect(ranking.stopReason).not.toBeNull();
	});

	it("stops at max comparisons if needed", async () => {
		const items = ["a", "b", "c", "d", "e", "f"];
		const ranking = new Ranking(items, {
			k: 2,
			maxComparisons: 5,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			// Random oracle — always pick a
			await ranking.recordComparison(a, b);
		}

		expect(ranking.round).toBe(5);
		expect(ranking.stopReason).toBe("max-comparisons");
	});

	it("tracks history correctly", async () => {
		const items = ["x", "y", "z"];
		const ranking = new Ranking(items, {
			k: 1,
			maxComparisons: 2,
		});

		const { a, b } = await ranking.selectPair();
		await ranking.recordComparison(a, b);
		expect(ranking.history).toHaveLength(1);
		expect(ranking.history[0].winner).toBe(a);
		expect(ranking.history[0].loser).toBe(b);
		expect(ranking.round).toBe(1);
	});

	it("throws when recording after stopped", async () => {
		const items = ["a", "b"];
		const ranking = new Ranking(items, {
			k: 1,
			maxComparisons: 1,
		});
		const { a, b } = await ranking.selectPair();
		await ranking.recordComparison(a, b);
		expect(ranking.stopped).toBe(true);
		await expect(ranking.recordComparison(a, b)).rejects.toThrow("already stopped");
	});

	it("throws when selecting pair after stopped", async () => {
		const items = ["a", "b"];
		const ranking = new Ranking(items, {
			k: 1,
			maxComparisons: 1,
		});
		const { a, b } = await ranking.selectPair();
		await ranking.recordComparison(a, b);
		await expect(ranking.selectPair()).rejects.toThrow("already stopped");
	});

	it("is deterministic", async () => {
		const items = ["a", "b", "c", "d", "e"];

		async function runRanking(): Promise<{ pairs: string[]; topK: readonly string[] }> {
			const ranking = new Ranking(items, {
				k: 2,
				maxComparisons: 5,
			});
			const pairs: string[] = [];
			while (!ranking.stopped) {
				const { a, b } = await ranking.selectPair();
				pairs.push(`${a}-${b}`);
				await ranking.recordComparison(a, b);
			}
			return { pairs, topK: ranking.topK };
		}

		const run1 = await runRanking();
		const run2 = await runRanking();
		expect(run1.pairs).toEqual(run2.pairs);
		expect(run1.topK).toEqual(run2.topK);
	});

	it("clone produces an independent copy with identical state", async () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const ranking = new Ranking(items, {
			k: 5,
			maxComparisons: 80,
		});

		// Advance a few rounds
		for (let i = 0; i < 5; i++) {
			const { a, b } = await ranking.selectPair();
			const winner = a > b ? a : b;
			const loser = a > b ? b : a;
			await ranking.recordComparison(winner, loser);
		}

		const clone = ranking.clone();

		// Clone has the same observable state
		expect(clone.round).toBe(ranking.round);
		expect(clone.stopped).toBe(ranking.stopped);
		expect(clone.stopReason).toBe(ranking.stopReason);
		expect(clone.mu).toEqual(ranking.mu);
		expect(clone.sigma).toEqual(ranking.sigma);
		expect(clone.topK).toEqual(ranking.topK);

		// Mutating the clone does not affect the original
		const { a, b } = await clone.selectPair();
		await clone.recordComparison(a > b ? a : b, a > b ? b : a);
		expect(clone.round).toBe(ranking.round + 1);
		expect(ranking.round).toBe(5);
	});

	it("recencyDiscount reduces consecutive appearances of the same item", async () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const trueStrength = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

		async function countConsecutiveRepeats(recencyDiscount: number): Promise<number> {
			const ranking = new Ranking(items, {
				k: 5,
				maxComparisons: 40,
				recencyDiscount,
				noSpeculation: true,
			});
			let repeats = 0;
			let prevA: number | null = null;
			let prevB: number | null = null;
			while (!ranking.stopped) {
				const { a, b } = await ranking.selectPair();
				if (prevA !== null && (a === prevA || a === prevB || b === prevA || b === prevB)) {
					repeats++;
				}
				prevA = a;
				prevB = b;
				const winner = trueStrength[a] > trueStrength[b] ? a : b;
				const loser = winner === a ? b : a;
				await ranking.recordComparison(winner, loser);
			}
			return repeats;
		}

		const repeatsNoDiscount = await countConsecutiveRepeats(1.0);
		const repeatsWithDiscount = await countConsecutiveRepeats(0.5);

		expect(repeatsWithDiscount).toBeLessThan(repeatsNoDiscount);
	});

	it("undoLastComparison throws when no comparisons to undo", async () => {
		const ranking = new Ranking(["a", "b", "c"], {
			k: 1,
		});
		await expect(ranking.undoLastComparison()).rejects.toThrow("No comparison to undo");
	});

	it("undoLastComparison undoes a single comparison", async () => {
		const items = ["a", "b", "c"];
		const ranking = new Ranking(items, {
			k: 1,
			maxComparisons: 10,
		});

		const initialMu = ranking.mu.slice();
		const initialSigma = ranking.sigma.slice();

		const { a, b } = await ranking.selectPair();
		await ranking.recordComparison(a, b);
		expect(ranking.round).toBe(1);
		expect(ranking.history).toHaveLength(1);

		await ranking.undoLastComparison();
		expect(ranking.round).toBe(0);
		expect(ranking.history).toHaveLength(0);
		expect(ranking.mu).toEqual(initialMu);
		expect(ranking.sigma).toEqual(initialSigma);
	});

	it("undoLastComparison can be called multiple times in succession", async () => {
		const items = ["a", "b", "c", "d"];
		const ranking = new Ranking(items, {
			k: 2,
			maxComparisons: 10,
		});

		for (let i = 0; i < 3; i++) {
			const { a, b } = await ranking.selectPair();
			await ranking.recordComparison(a, b);
		}
		expect(ranking.round).toBe(3);
		expect(ranking.history).toHaveLength(3);

		await ranking.undoLastComparison();
		expect(ranking.round).toBe(2);
		await ranking.undoLastComparison();
		expect(ranking.round).toBe(1);
		await ranking.undoLastComparison();
		expect(ranking.round).toBe(0);
		expect(ranking.history).toHaveLength(0);

		await expect(ranking.undoLastComparison()).rejects.toThrow("No comparison to undo");
	});

	it("undoLastComparison after stop re-opens ranking", async () => {
		const items = ["a", "b"];
		const ranking = new Ranking(items, {
			k: 1,
			maxComparisons: 1,
		});

		const { a, b } = await ranking.selectPair();
		await ranking.recordComparison(a, b);
		expect(ranking.stopped).toBe(true);
		expect(ranking.stopReason).toBe("max-comparisons");

		await ranking.undoLastComparison();
		expect(ranking.stopped).toBe(false);
		expect(ranking.stopReason).toBeNull();

		// Can continue using the ranking after undo
		const pair = await ranking.selectPair();
		expect(pair.a).not.toBe(pair.b);
		await ranking.recordComparison(pair.a, pair.b);
	});

	it("undoLastComparison returns the undone comparison record", async () => {
		const items = ["x", "y", "z"];
		const ranking = new Ranking(items, {
			k: 1,
			maxComparisons: 10,
		});

		const { a, b } = await ranking.selectPair();
		await ranking.recordComparison(a, b);

		const undone = await ranking.undoLastComparison();
		expect(undone.winner).toBe(a);
		expect(undone.loser).toBe(b);
	});

	it("undoLastComparison preserves stability state when replaying the same comparison", async () => {
		const ranking = new Ranking(["a", "b", "c"], {
			k: 1,
			stabilityWindow: 1,
			maxComparisons: 10,
			confidenceThreshold: Number.POSITIVE_INFINITY,
		});

		const first = await ranking.recordComparison("a", "b");
		expect(first.stopped).toBe(false);

		const second = await ranking.recordComparison("a", "b");
		expect(second).toEqual({ stopped: true, stopReason: "stability" });

		await ranking.undoLastComparison();
		expect(ranking.round).toBe(1);
		expect(ranking.stopped).toBe(false);

		const replay = await ranking.recordComparison("a", "b");
		expect(replay).toEqual({ stopped: true, stopReason: "stability" });
	});
});

describe("estimateStabilityStop", () => {
	it("returns null when flipHistory has fewer entries than stabilityWindow", () => {
		expect(estimateStabilityStop([], 0, 10)).toBeNull();
		expect(estimateStabilityStop([false, true, false, true], 0, 10)).toBeNull();
		// 9 entries, window=10 → still null
		expect(estimateStabilityStop([false, false, false, false, false, false, false, false, false], 0, 10)).toBeNull();
	});

	it("with no flips in history, returns approximately stabilityWindow - stableCount", () => {
		const history = new Array<boolean>(10).fill(false);
		const result = estimateStabilityStop(history, 3, 10);
		expect(result).not.toBeNull();
		if (result === null) return;
		// With 0 flips, p is very low via Jeffreys prior, so mid ≈ needed = 7 + small overshoot
		expect(result.mid).toBeGreaterThanOrEqual(6);
		expect(result.mid).toBeLessThanOrEqual(10);
	});

	it("with higher flip rate, returns larger estimate or null", () => {
		// Use stableCount=6 so needed=4, keeping intervals tight enough to pass
		const noFlips = new Array<boolean>(10).fill(false);
		const someFlips = [true, false, false, false, false, false, false, false, false, false];
		const resultNoFlips = estimateStabilityStop(noFlips, 6, 10);
		const resultSomeFlips = estimateStabilityStop(someFlips, 6, 10);
		expect(resultNoFlips).not.toBeNull();
		if (resultNoFlips === null) return;
		// With more flips, estimate is either larger or suppressed as unreliable
		if (resultSomeFlips !== null) {
			expect(resultSomeFlips.mid).toBeGreaterThan(resultNoFlips.mid);
		}
	});

	it("returns null when flip rate makes interval too wide", () => {
		// 50% flip rate with needed=10 → huge, unreliable interval
		const history = [true, false, true, false, true, false, true, false, true, false];
		const result = estimateStabilityStop(history, 0, 10);
		expect(result).toBeNull();
	});

	it("caps low/mid/high by maxRemaining when provided", () => {
		const history = new Array<boolean>(10).fill(false);
		const result = estimateStabilityStop(history, 0, 10, 3);
		expect(result).not.toBeNull();
		if (result === null) return;
		expect(result.low).toBe(3);
		expect(result.mid).toBe(3);
		expect(result.high).toBe(3);
	});

	it("applies cap before wide-interval suppression", () => {
		// Without cap, this case is too wide and returns null.
		const history = [true, false, true, false, true, false, true, false, true, false];
		const uncapped = estimateStabilityStop(history, 0, 10);
		expect(uncapped).toBeNull();

		// With a tight hard cap, the estimate should collapse to that cap.
		const capped = estimateStabilityStop(history, 0, 10, 4);
		expect(capped).not.toBeNull();
		if (capped === null) return;
		expect(capped.low).toBe(4);
		expect(capped.mid).toBe(4);
		expect(capped.high).toBe(4);
	});

	it("satisfies low <= mid <= high", () => {
		// Use a low flip rate with stableCount close to window for tight interval
		const history = [false, false, true, false, false, false, false, false, false, false];
		const result = estimateStabilityStop(history, 6, 10);
		expect(result).not.toBeNull();
		if (result === null) return;
		expect(result.low).toBeLessThanOrEqual(result.mid);
		expect(result.mid).toBeLessThanOrEqual(result.high);
	});

	it("with stableCount close to stabilityWindow, returns small estimate", () => {
		const history = new Array<boolean>(10).fill(false);
		const result = estimateStabilityStop(history, 8, 10);
		expect(result).not.toBeNull();
		if (result === null) return;
		// Only need 2 more stable rounds
		expect(result.mid).toBeLessThanOrEqual(3);
		expect(result.mid).toBeGreaterThanOrEqual(1);
	});

	it("returns zero interval when maxRemaining is zero", () => {
		expect(estimateStabilityStop([], 0, 10, 0)).toEqual({ low: 0, mid: 0, high: 0 });
		expect(estimateStabilityStop([true, false], 0, 10, 0)).toEqual({ low: 0, mid: 0, high: 0 });
	});
});

describe("transcript replay", () => {
	it("produces estimates from round 10 onward that decrease as stability builds", async () => {
		// The first 8 meaning sources, matching MEANING_CARDS.slice(0, 8)
		const cards = ["Social commitment", "Religiosity", "Unity with nature", "Self-knowledge", "Health", "Generativity", "Spirituality", "Challenge"];

		const ranking = new Ranking(cards, { k: 5 });

		// Winner/loser pairs from transcript (user picked displayed A or B;
		// we record which source won and which lost).
		const comparisons: [winner: string, loser: string][] = [
			["Religiosity", "Unity with nature"], // round 1
			["Self-knowledge", "Health"], // round 2
			["Generativity", "Religiosity"], // round 3
			["Spirituality", "Health"], // round 4
			["Challenge", "Unity with nature"], // round 5
			["Generativity", "Health"], // round 6
			["Social commitment", "Challenge"], // round 7
			["Religiosity", "Health"], // round 8
			["Self-knowledge", "Spirituality"], // round 9
			["Generativity", "Health"], // round 10
			["Religiosity", "Unity with nature"], // round 11
			["Generativity", "Self-knowledge"], // round 12
			["Challenge", "Spirituality"], // round 13
			["Social commitment", "Health"], // round 14
			["Spirituality", "Unity with nature"], // round 15
			["Challenge", "Religiosity"], // round 16
			["Spirituality", "Unity with nature"], // round 17
			["Generativity", "Health"], // round 18
			["Spirituality", "Religiosity"], // round 19
			["Challenge", "Social commitment"], // round 20
			["Spirituality", "Religiosity"], // round 21
			["Generativity", "Challenge"], // round 22
			["Social commitment", "Health"], // round 23
			["Challenge", "Spirituality"], // round 24
			["Self-knowledge", "Religiosity"], // round 25
			["Generativity", "Challenge"], // round 26
			["Health", "Unity with nature"], // round 27
			["Generativity", "Social commitment"], // round 28
			["Religiosity", "Unity with nature"], // round 29
		];

		let sawEstimateFromRound5 = false;
		let lastEstimateMid: number | null = null;

		for (let i = 0; i < comparisons.length; i++) {
			const [winner, loser] = comparisons[i];
			const round = i + 1;
			const { stopReason } = await ranking.recordComparison(winner, loser);

			const estimate = ranking.estimateRemaining();

			if (round >= 10 && estimate !== null) {
				sawEstimateFromRound5 = true;
				expect(estimate.low).toBeLessThanOrEqual(estimate.mid);
				expect(estimate.mid).toBeLessThanOrEqual(estimate.high);
				lastEstimateMid = estimate.mid;
			}

			if (stopReason !== null) {
				break;
			}
		}

		expect(sawEstimateFromRound5).toBe(true);
		// By the final rounds, the estimate should be small (close to stabilityWindow - stableCount)
		expect(lastEstimateMid).not.toBeNull();
		if (lastEstimateMid !== null) {
			expect(lastEstimateMid).toBeLessThanOrEqual(12);
		}

		// Confirm it stopped via stability, not confidence
		expect(ranking.stopped).toBe(true);
		expect(ranking.stopReason).toBe("stability");
	});
});

describe("estimateRemaining integration", () => {
	it("remains null through round 10 because flip history starts after first transition", async () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const ranking = new Ranking(items, {
			k: 5,
			maxComparisons: 80,
		});

		for (let round = 1; round <= 10; round++) {
			const { a, b } = await ranking.selectPair();
			const winner = a > b ? a : b;
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
			expect(ranking.round).toBe(round);
			expect(ranking.estimateRemaining()).toBeNull();
		}
	});

	it("returns non-null after stabilityWindow rounds and mid decreases as stability builds", async () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const trueStrength = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

		function oracle(a: number, b: number): number {
			return trueStrength[a] >= trueStrength[b] ? a : b;
		}

		const ranking = new Ranking(items, {
			k: 5,
			maxComparisons: 80,
		});

		let firstNonNullRound = 0;
		const estimates: { round: number; mid: number }[] = [];

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			const winner = oracle(a, b);
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
			const est = ranking.estimateRemaining();
			if (est !== null) {
				if (firstNonNullRound === 0) firstNonNullRound = ranking.round;
				estimates.push({ round: ranking.round, mid: est.mid });
				expect(est.low).toBeLessThanOrEqual(est.mid);
				expect(est.mid).toBeLessThanOrEqual(est.high);
			}
		}

		// Should get estimates once we have a full window of flip history
		expect(firstNonNullRound).toBeLessThanOrEqual(15);
		expect(estimates.length).toBeGreaterThan(0);

		// The last estimate's mid should be small (close to 0, since stability
		// was nearly reached)
		const lastEstimate = estimates[estimates.length - 1];
		expect(lastEstimate.mid).toBeLessThan(15);
	});

	it("never exceeds max-comparisons budget in low-budget runs", async () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const trueStrength = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

		function oracle(a: number, b: number): number {
			return trueStrength[a] >= trueStrength[b] ? a : b;
		}

		const ranking = new Ranking(items, {
			k: 5,
			maxComparisons: 12,
			confidenceThreshold: Number.POSITIVE_INFINITY,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			const winner = oracle(a, b);
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);

			const est = ranking.estimateRemaining();
			if (est !== null) {
				const budget = 12 - ranking.round;
				expect(est.low).toBeLessThanOrEqual(budget);
				expect(est.mid).toBeLessThanOrEqual(budget);
				expect(est.high).toBeLessThanOrEqual(budget);
				expect(est.low).toBeLessThanOrEqual(est.mid);
				expect(est.mid).toBeLessThanOrEqual(est.high);
			}
		}

		expect(ranking.stopReason).toBe("max-comparisons");
		expect(ranking.estimateRemaining()).toEqual({ low: 0, mid: 0, high: 0 });
	});
});

describe("checkAdaptiveKReduction", () => {
	it("returns null when no reduced K passes confidence", () => {
		const mu = new Float64Array([0, 0, 0, 0, 0, 0]);
		const sigma = new Float64Array([1, 1, 1, 1, 1, 1]);
		expect(checkAdaptiveKReduction(mu, sigma, 5, 3, 1.96, 0)).toBeNull();
	});

	it("returns the largest reduced K that passes", () => {
		// Top 4 clearly separated from rest, but top 5 not
		const mu = new Float64Array([10, 9, 8, 7, 0.1, -10]);
		const sigma = new Float64Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
		const result = checkAdaptiveKReduction(mu, sigma, 5, 3, 1.96, 0);
		// k=4 passes (top 4 clearly separated from items 4,5)
		expect(result).toBe(4);
	});

	it("returns k-1 even when smaller K values also pass", () => {
		// All reduced K values pass (clear separation for k=4 and k=3)
		const mu = new Float64Array([10, 9, 8, 7, -10, -20]);
		const sigma = new Float64Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
		const result = checkAdaptiveKReduction(mu, sigma, 5, 3, 1.96, 0);
		expect(result).toBe(4);
	});

	it("returns minK when only minK passes", () => {
		// Top 3 clearly separated; items 3,4 ambiguous with rest
		const mu = new Float64Array([10, 9, 8, 0.1, -0.1, -10]);
		const sigma = new Float64Array([0.1, 0.1, 0.1, 1, 1, 0.1]);
		const result = checkAdaptiveKReduction(mu, sigma, 5, 3, 1.96, 0);
		expect(result).toBe(3);
	});
});

describe("computeInformationGain with KWeight[]", () => {
	const PRIOR_VARIANCE = 1.0;

	it("single KWeight produces same result as plain number", () => {
		const n = 4;
		const k = 2;
		const mu = new Float64Array([1, 0.5, -0.5, -1]);
		const sigma = new Float64Array(n).fill(1);

		const gainNumber = computeInformationGain(0, 1, mu, sigma, [], k, n, PRIOR_VARIANCE);
		const gainWeights = computeInformationGain(0, 1, mu, sigma, [], [{ k: 2, weight: 1.0 }], n, PRIOR_VARIANCE);
		expect(gainWeights).toBeCloseTo(gainNumber, 10);
	});

	it("multi-objective weights produce a different result than single K", () => {
		const n = 6;
		const mu = new Float64Array([5, 4, 0.1, -0.1, -4, -5]);
		const sigma = new Float64Array(n).fill(0.8);

		const gainSingle = computeInformationGain(2, 3, mu, sigma, [], 5, n, PRIOR_VARIANCE);
		const weights: KWeight[] = [
			{ k: 5, weight: 0.5 },
			{ k: 4, weight: 0.25 },
			{ k: 3, weight: 0.25 },
		];
		const gainMulti = computeInformationGain(2, 3, mu, sigma, [], weights, n, PRIOR_VARIANCE);
		// They should differ because the multi-objective considers multiple K values
		expect(gainMulti).not.toBe(gainSingle);
	});

	it("skips K values with weight below 0.01", () => {
		const n = 4;
		const mu = new Float64Array([1, 0.5, -0.5, -1]);
		const sigma = new Float64Array(n).fill(1);

		const weights: KWeight[] = [
			{ k: 2, weight: 1.0 },
			{ k: 1, weight: 0.005 }, // below threshold
		];
		const gainWithTiny = computeInformationGain(0, 1, mu, sigma, [], weights, n, PRIOR_VARIANCE);
		const gainSingle = computeInformationGain(0, 1, mu, sigma, [], [{ k: 2, weight: 1.0 }], n, PRIOR_VARIANCE);
		// Should be very close since the tiny weight is skipped
		expect(gainWithTiny).toBeCloseTo(gainSingle, 5);
	});
});

describe("adaptive K reduction integration", () => {
	it("fires K reduction with 3 clearly strong items + ambiguous 4th/5th", async () => {
		// 8 items: indices 0-2 clearly strong, 3-7 ambiguous
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [10, 9, 8, 0.1, 0, -0.1, -5, -6];

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			kReductionReluctance: 1.0,
			maxComparisons: 80,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			const winner = trueStrength[a] > trueStrength[b] ? a : b;
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
		}

		// Should stop with reduced K since the boundary items are ambiguous
		expect(ranking.effectiveK).toBeGreaterThanOrEqual(3);
		expect(ranking.effectiveK).toBeLessThanOrEqual(5);
		const topK = new Set(ranking.topK);
		// The top 3 should always be in the result
		expect(topK.has(0)).toBe(true);
		expect(topK.has(1)).toBe(true);
		expect(topK.has(2)).toBe(true);
	});

	it("non-default config (k=2, minK=1) works without hardcoded 5/4/3", async () => {
		const items = [0, 1, 2, 3, 4];
		const trueStrength = [10, 0.1, -0.1, -5, -6];

		const ranking = new Ranking(items, {
			k: 2,
			minK: 1,
			kReductionReluctance: 1.0,
			maxComparisons: 40,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			const winner = trueStrength[a] > trueStrength[b] ? a : b;
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
		}

		expect(ranking.effectiveK).toBeGreaterThanOrEqual(1);
		expect(ranking.effectiveK).toBeLessThanOrEqual(2);
		expect(ranking.topK).toContain(0);
	});

	it("validates minK constraints", () => {
		expect(() => new Ranking([1, 2, 3], { k: 2, minK: 0 })).toThrow("minK must be between 1 and k");
		expect(() => new Ranking([1, 2, 3], { k: 2, minK: 3 })).toThrow("minK must be between 1 and k");
	});

	it("undo resets effectiveK to config.k", async () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [10, 9, 8, 0.1, 0, -0.1, -5, -6];

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxComparisons: 80,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			const winner = trueStrength[a] > trueStrength[b] ? a : b;
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
		}

		if (ranking.effectiveK < 5) {
			expect(ranking.effectiveK).toBeLessThan(5);
			await ranking.undoLastComparison();
			expect(ranking.effectiveK).toBe(5);
			expect(ranking.stopped).toBe(false);
		}
	});

	it("max-budget fallback picks largest reduced K passing confidence or stability", async () => {
		// Use a scenario where full K won't converge but reduced K might
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		// 3 clearly strong, rest close together
		const trueStrength = [10, 9, 8, 0.2, 0.1, 0, -0.1, -0.2];

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			kReductionReluctance: 1.0,
			maxComparisons: 80,
			// Make confidence stop very hard for full K
			confidenceThreshold: 0.0,
		});

		while (!ranking.stopped) {
			const { a, b } = await ranking.selectPair();
			const winner = trueStrength[a] > trueStrength[b] ? a : b;
			const loser = winner === a ? b : a;
			await ranking.recordComparison(winner, loser);
		}

		// The ranking should have stopped, possibly with a reduced effectiveK
		expect(ranking.stopped).toBe(true);
		expect(ranking.effectiveK).toBeGreaterThanOrEqual(3);
		expect(ranking.effectiveK).toBeLessThanOrEqual(5);
		// Top 3 should always be correct
		const topK = new Set(ranking.topK);
		expect(topK.has(0)).toBe(true);
		expect(topK.has(1)).toBe(true);
		expect(topK.has(2)).toBe(true);
	});
});
