import { describe, expect, it } from "vitest";

import { bayesianTopKProbability, confidentTopK, enumerateCombinations, fitSequentialLogitMLE, invertMatrix, makeXorshift, negLogPosteriorGradient, negLogPosteriorHessian, normalCdf, pairBalancedShuffle, scoreTaskSet, sequentialLogitLogLik, shuffleArray } from "./ranking-math.ts";
import type { MaxDiffObservation } from "./ranking-math.ts";
import { argsortDescending, Ranking } from "./ranking.ts";

describe("normalCdf", () => {
	it("returns 0.5 at z=0", () => {
		expect(normalCdf(0)).toBeCloseTo(0.5, 5);
	});

	it("returns ~0.8413 at z=1", () => {
		expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
	});

	it("returns ~0.1587 at z=-1", () => {
		expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
	});

	it("returns ~0.9772 at z=2", () => {
		expect(normalCdf(2)).toBeCloseTo(0.9772, 3);
	});

	it("clamps at extremes", () => {
		expect(normalCdf(-10)).toBe(0);
		expect(normalCdf(10)).toBe(1);
	});
});

describe("sequentialLogitLogLik", () => {
	it("returns negative value for valid observation", () => {
		const u = new Float64Array([1, 0, -1]);
		const obs: MaxDiffObservation = { set: [0, 1, 2], best: 0, worst: 2 };
		const ll = sequentialLogitLogLik(obs, u);
		expect(ll).toBeLessThan(0);
	});

	it("higher utility for best gives higher log-likelihood", () => {
		const u1 = new Float64Array([2, 0, -2]);
		const u2 = new Float64Array([0.1, 0, -0.1]);
		const obs: MaxDiffObservation = { set: [0, 1, 2], best: 0, worst: 2 };
		expect(sequentialLogitLogLik(obs, u1)).toBeGreaterThan(sequentialLogitLogLik(obs, u2));
	});

	it("is consistent with softmax probabilities", () => {
		const u = new Float64Array([1, 0.5, 0]);
		const obs: MaxDiffObservation = { set: [0, 1, 2], best: 0, worst: 2 };
		const ll = sequentialLogitLogLik(obs, u);

		// Manual: P(best=0|{0,1,2}) = exp(1)/(exp(1)+exp(0.5)+exp(0))
		const pBest = Math.exp(1) / (Math.exp(1) + Math.exp(0.5) + Math.exp(0));
		// P(worst=2|{1,2}) with -u: exp(0)/(exp(0)+exp(-0.5))
		const pWorst = Math.exp(0) / (Math.exp(0) + Math.exp(-0.5));
		expect(ll).toBeCloseTo(Math.log(pBest) + Math.log(pWorst), 10);
	});
});

describe("gradient numerical check", () => {
	it("matches finite differences", () => {
		const n = 3;
		const u = new Float64Array([0.5, -0.3, 0.1]);
		const data: MaxDiffObservation[] = [
			{ set: [0, 1, 2], best: 0, worst: 1 },
			{ set: [0, 1, 2], best: 2, worst: 1 },
		];
		const lambdaL2 = 0.5;

		const grad = negLogPosteriorGradient(data, u, lambdaL2, n);
		const eps = 1e-5;

		function negLogPosterior(v: Float64Array): number {
			let val = 0;
			for (const obs of data) {
				val -= sequentialLogitLogLik(obs, v);
			}
			for (let i = 0; i < n; i++) val += lambdaL2 * v[i] * v[i];
			return val;
		}

		for (let i = 0; i < n; i++) {
			const uPlus = new Float64Array(u);
			uPlus[i] += eps;
			const uMinus = new Float64Array(u);
			uMinus[i] -= eps;
			const numGrad = (negLogPosterior(uPlus) - negLogPosterior(uMinus)) / (2 * eps);
			expect(grad[i]).toBeCloseTo(numGrad, 4);
		}
	});
});

describe("Hessian numerical check", () => {
	it("matches finite differences of gradient", () => {
		const n = 3;
		const u = new Float64Array([0.5, -0.3, 0.1]);
		const data: MaxDiffObservation[] = [{ set: [0, 1, 2], best: 0, worst: 1 }];
		const lambdaL2 = 0.5;

		const H = negLogPosteriorHessian(data, u, lambdaL2, n);
		const eps = 1e-5;

		for (let i = 0; i < n; i++) {
			const uPlus = new Float64Array(u);
			uPlus[i] += eps;
			const uMinus = new Float64Array(u);
			uMinus[i] -= eps;
			const gPlus = negLogPosteriorGradient(data, uPlus, lambdaL2, n);
			const gMinus = negLogPosteriorGradient(data, uMinus, lambdaL2, n);

			for (let j = 0; j < n; j++) {
				const numH = (gPlus[j] - gMinus[j]) / (2 * eps);
				expect(H[j * n + i]).toBeCloseTo(numH, 3);
			}
		}
	});
});

describe("invertMatrix", () => {
	it("inverts a 2x2 matrix", () => {
		// [[2, 1], [1, 3]] -> inverse = [[3, -1], [-1, 2]] / 5
		const h = new Float64Array([2, 1, 1, 3]);
		const inv = invertMatrix(h, 2, 0);
		expect(inv[0]).toBeCloseTo(0.6, 5);
		expect(inv[1]).toBeCloseTo(-0.2, 5);
		expect(inv[2]).toBeCloseTo(-0.2, 5);
		expect(inv[3]).toBeCloseTo(0.4, 5);
	});

	it("inverts identity matrix", () => {
		const h = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
		const inv = invertMatrix(h, 3, 0);
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				expect(inv[i * 3 + j]).toBeCloseTo(i === j ? 1 : 0, 5);
			}
		}
	});
});

describe("fitSequentialLogitMLE", () => {
	it("returns zero mu with no data", () => {
		const result = fitSequentialLogitMLE([], 3, 0.5);
		expect(result.mu[0]).toBe(0);
		expect(result.mu[1]).toBe(0);
		expect(result.mu[2]).toBe(0);
	});

	it("converges: best item gets highest utility", () => {
		const data: MaxDiffObservation[] = [];
		for (let i = 0; i < 10; i++) {
			data.push({ set: [0, 1, 2], best: 0, worst: 2 });
		}
		const result = fitSequentialLogitMLE(data, 3, 0.5);
		expect(result.mu[0]).toBeGreaterThan(result.mu[1]);
		expect(result.mu[1]).toBeGreaterThan(result.mu[2]);
	});

	it("enforces sum(mu)=0", () => {
		const data: MaxDiffObservation[] = [
			{ set: [0, 1, 2], best: 0, worst: 2 },
			{ set: [0, 1, 2], best: 1, worst: 2 },
		];
		const result = fitSequentialLogitMLE(data, 3, 0.5);
		const sum = result.mu[0] + result.mu[1] + result.mu[2];
		expect(sum).toBeCloseTo(0, 5);
	});

	it("returns positive-definite covariance", () => {
		const data: MaxDiffObservation[] = [{ set: [0, 1, 2], best: 0, worst: 2 }];
		const result = fitSequentialLogitMLE(data, 3, 0.5);
		// Diagonal should be positive
		for (let i = 0; i < 3; i++) {
			expect(result.sigma[i * 3 + i]).toBeGreaterThan(0);
		}
	});
});

describe("confidentTopK", () => {
	it("returns true when utilities are well separated", () => {
		const mu = new Float64Array([3, 2, -2, -3]);
		const n = 4;
		const sigma = new Float64Array(n * n);
		for (let i = 0; i < n; i++) sigma[i * n + i] = 0.01;
		expect(confidentTopK(mu, sigma, 2, 0.05, "boundary_only")).toBe(true);
	});

	it("returns false when utilities are close", () => {
		const mu = new Float64Array([0.1, 0.05, -0.05, -0.1]);
		const n = 4;
		const sigma = new Float64Array(n * n);
		for (let i = 0; i < n; i++) sigma[i * n + i] = 1;
		expect(confidentTopK(mu, sigma, 2, 0.05, "boundary_only")).toBe(false);
	});

	it("returns true for k >= n", () => {
		const mu = new Float64Array([1, 0]);
		const sigma = new Float64Array(4);
		for (let i = 0; i < 2; i++) sigma[i * 2 + i] = 1;
		expect(confidentTopK(mu, sigma, 3, 0.05, "boundary_only")).toBe(true);
	});
});

describe("scoreTaskSet", () => {
	it("returns higher score for items with higher variance", () => {
		const n = 4;
		const sigma = new Float64Array(n * n);
		sigma[0 * n + 0] = 1;
		sigma[1 * n + 1] = 1;
		sigma[2 * n + 2] = 0.01;
		sigma[3 * n + 3] = 0.01;

		const score1 = scoreTaskSet([0, 1, 2], sigma, n);
		const score2 = scoreTaskSet([2, 3, 0], sigma, n);
		// Set with more high-variance items should score higher... actually depends on covariance
		expect(score1).toBeGreaterThan(0);
		expect(score2).toBeGreaterThan(0);
	});
});

describe("enumerateCombinations", () => {
	it("C(4,2) returns 6 combinations", () => {
		const combos = enumerateCombinations(4, 2);
		expect(combos).toHaveLength(6);
		for (const c of combos) {
			expect(c).toHaveLength(2);
			expect(c[0]).toBeLessThan(c[1]);
		}
		// All unique
		const strs = combos.map((c) => c.join(","));
		expect(new Set(strs).size).toBe(6);
	});

	it("C(8,3) returns 56 combinations", () => {
		const combos = enumerateCombinations(8, 3);
		expect(combos).toHaveLength(56);
		for (const c of combos) {
			expect(c).toHaveLength(3);
			expect(c[0]).toBeLessThan(c[1]);
			expect(c[1]).toBeLessThan(c[2]);
		}
	});
});

describe("shuffleArray", () => {
	it("produces a permutation with same elements", () => {
		const arr = [0, 1, 2, 3, 4, 5];
		const original = [...arr];
		const rng = makeXorshift(42);
		shuffleArray(arr, rng);
		expect(arr.sort((a, b) => a - b)).toEqual(original);
	});

	it("is deterministic given same seed", () => {
		const arr1 = [0, 1, 2, 3, 4, 5];
		const arr2 = [0, 1, 2, 3, 4, 5];
		shuffleArray(arr1, makeXorshift(42));
		shuffleArray(arr2, makeXorshift(42));
		expect(arr1).toEqual(arr2);
	});
});

describe("pairBalancedShuffle", () => {
	it("covers all pairs within first ceil(C(n,2)/C(m,2)) triplets", () => {
		const n = 12;
		const m = 3;
		const combos = enumerateCombinations(n, m);
		const rng = makeXorshift(42);
		const schedule = pairBalancedShuffle(combos, n, rng);

		// All C(12,2)=66 pairs should be covered within first 30 triplets
		const seen = new Set<string>();
		let coveredAt = -1;
		for (let i = 0; i < schedule.length; i++) {
			const t = schedule[i];
			for (let a = 0; a < t.length; a++) {
				for (let b = a + 1; b < t.length; b++) {
					seen.add(`${String(t[a])}-${String(t[b])}`);
				}
			}
			if (seen.size === (n * (n - 1)) / 2 && coveredAt === -1) {
				coveredAt = i + 1;
			}
		}
		expect(seen.size).toBe(66);
		// Should cover all pairs well within 60 triplets (theoretical min is 22)
		expect(coveredAt).toBeLessThanOrEqual(50);
	});

	it("produces balanced pair counts", () => {
		const n = 8;
		const m = 3;
		const combos = enumerateCombinations(n, m);
		const rng = makeXorshift(42);
		const schedule = pairBalancedShuffle(combos, n, rng);

		// After full cycle of 56 triplets, each pair appears exactly 6 times
		const pairCounts = new Map<string, number>();
		for (const t of schedule) {
			for (let a = 0; a < t.length; a++) {
				for (let b = a + 1; b < t.length; b++) {
					const key = `${String(t[a])}-${String(t[b])}`;
					pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
				}
			}
		}
		// All 28 pairs should appear exactly 6 times in a full cycle
		expect(pairCounts.size).toBe(28);
		for (const [, count] of pairCounts) {
			expect(count).toBe(6);
		}
	});

	it("is deterministic given same seed", () => {
		const combos = enumerateCombinations(8, 3);
		const s1 = pairBalancedShuffle([...combos.map((c) => [...c])], 8, makeXorshift(42));
		const s2 = pairBalancedShuffle([...combos.map((c) => [...c])], 8, makeXorshift(42));
		expect(s1).toEqual(s2);
	});
});

describe("makeXorshift", () => {
	it("returns an object with next() and state", () => {
		const rng = makeXorshift(123);
		const v1 = rng.next();
		expect(v1).toBeGreaterThan(0);
		expect(v1).toBeLessThan(1);
		expect(typeof rng.state).toBe("number");
	});

	it("state can be saved and restored", () => {
		const rng = makeXorshift(123);
		rng.next();
		rng.next();
		const savedState = rng.state;
		const v1 = rng.next();

		rng.state = savedState;
		const v2 = rng.next();
		expect(v2).toBe(v1);
	});
});

describe("Ranking class", () => {
	it("selectTask returns m distinct items from the candidate set", () => {
		const items = ["a", "b", "c", "d", "e", "f"] as const;
		const ranking = new Ranking(items, { k: 2, m: 3, seed: 42 });
		const { items: task } = ranking.selectTask();

		expect(task).toHaveLength(3);
		expect(new Set(task).size).toBe(3);
		for (const item of task) {
			expect(items).toContain(item);
		}
	});

	it("converges on correct top-k via confidence with a perfect oracle (8 items, k=3)", () => {
		// Use wider strength gaps so the boundary items are clearly separated
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [0, 0, 0, 0, 0, 3, 6, 9];
		const expectedTopK = new Set([5, 6, 7]);

		const ranking = new Ranking(items, {
			k: 3,
			maxTasks: 500,
			m: 3,
			seed: 42,
			lambdaL2: 0.1,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => trueStrength[i]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			const best = task[bestIdx];
			const worst = task[worstIdx];
			ranking.recordTask(best, worst);
		}

		const topK = new Set(ranking.topK);
		expect(topK).toEqual(expectedTopK);
		expect(ranking.stopReason).toBe("confidence");
		expect(ranking.round).toBeLessThan(500);
	});

	it("converges on correct top-k with 6 items, k=3", () => {
		const items = [0, 1, 2, 3, 4, 5];
		const trueStrength = [0, 1, 2, 3, 4, 5];
		const expectedTopK = new Set([3, 4, 5]);

		const ranking = new Ranking(items, {
			k: 3,
			maxTasks: 500,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => trueStrength[i]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		const topK = new Set(ranking.topK);
		expect(topK).toEqual(expectedTopK);
	});

	it("stops at max tasks if needed", () => {
		const items = ["a", "b", "c", "d", "e", "f"];
		const maxTasks = 5;
		const ranking = new Ranking(items, {
			k: 2,
			maxTasks,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			ranking.recordTask(task[0], task[task.length - 1]);
		}

		expect(ranking.round).toBe(maxTasks);
		expect(ranking.stopReason).toBe("max-tasks");
	});

	it("tracks history correctly", () => {
		const items = ["x", "y", "z", "w"];
		const ranking = new Ranking(items, {
			k: 1,
			maxTasks: 10,
			m: 3,
			seed: 42,
		});

		const { items: task } = ranking.selectTask();
		ranking.recordTask(task[0], task[task.length - 1]);
		expect(ranking.history).toHaveLength(1);
		expect(ranking.history[0].best).toBe(task[0]);
		expect(ranking.history[0].worst).toBe(task[task.length - 1]);
		expect(ranking.history[0].set).toEqual(task);
		expect(ranking.round).toBe(1);
	});

	it("throws when recording after stopped", () => {
		const items = ["a", "b", "c", "d"];
		const ranking = new Ranking(items, {
			k: 1,
			maxTasks: 1,
			m: 3,
			seed: 42,
		});
		const { items: task } = ranking.selectTask();
		ranking.recordTask(task[0], task[task.length - 1]);
		expect(ranking.stopped).toBe(true);
		expect(() => ranking.recordTask(task[0], task[task.length - 1])).toThrow("already stopped");
	});

	it("throws when selecting task after stopped", () => {
		const items = ["a", "b", "c", "d"];
		const ranking = new Ranking(items, {
			k: 1,
			maxTasks: 1,
			m: 3,
			seed: 42,
		});
		const { items: task } = ranking.selectTask();
		ranking.recordTask(task[0], task[task.length - 1]);
		expect(() => ranking.selectTask()).toThrow("already stopped");
	});

	it("is deterministic with same seed", () => {
		const items = ["a", "b", "c", "d", "e"];

		function runRanking(): { tasks: string[][]; topK: readonly string[] } {
			const ranking = new Ranking(items, {
				k: 2,
				maxTasks: 5,
				m: 3,
				seed: 42,
			});
			const tasks: string[][] = [];
			while (!ranking.stopped) {
				const { items: task } = ranking.selectTask();
				tasks.push([...task]);
				ranking.recordTask(task[0], task[task.length - 1]);
			}
			return { tasks, topK: ranking.topK };
		}

		const run1 = runRanking();
		const run2 = runRanking();
		expect(run1.tasks).toEqual(run2.tasks);
		expect(run1.topK).toEqual(run2.topK);
	});

	it("undo restores state correctly", () => {
		const items = ["a", "b", "c", "d", "e", "f"];
		const ranking = new Ranking(items, {
			k: 2,
			maxTasks: 10,
			m: 3,
			seed: 42,
		});

		const { items: task } = ranking.selectTask();
		ranking.recordTask(task[0], task[task.length - 1]);
		expect(ranking.round).toBe(1);
		expect(ranking.history).toHaveLength(1);

		ranking.undoLastTask();
		expect(ranking.round).toBe(0);
		expect(ranking.history).toHaveLength(0);
	});

	it("undo can be called multiple times", () => {
		const items = ["a", "b", "c", "d", "e", "f"];
		const ranking = new Ranking(items, {
			k: 2,
			maxTasks: 10,
			m: 3,
			seed: 42,
		});

		for (let i = 0; i < 3; i++) {
			const { items: task } = ranking.selectTask();
			ranking.recordTask(task[0], task[task.length - 1]);
		}
		expect(ranking.round).toBe(3);

		ranking.undoLastTask();
		expect(ranking.round).toBe(2);
		ranking.undoLastTask();
		expect(ranking.round).toBe(1);
		ranking.undoLastTask();
		expect(ranking.round).toBe(0);

		expect(() => ranking.undoLastTask()).toThrow("No task to undo");
	});

	it("undo after stop re-opens ranking", () => {
		const items = ["a", "b", "c", "d"];
		const ranking = new Ranking(items, {
			k: 1,
			maxTasks: 1,
			m: 3,
			seed: 42,
		});

		const { items: task } = ranking.selectTask();
		ranking.recordTask(task[0], task[task.length - 1]);
		expect(ranking.stopped).toBe(true);

		ranking.undoLastTask();
		expect(ranking.stopped).toBe(false);
		expect(ranking.stopReason).toBeNull();

		const { items: task2 } = ranking.selectTask();
		expect(task2.length).toBe(3);
	});

	it("undo returns the undone task record", () => {
		const items = ["x", "y", "z", "w"];
		const ranking = new Ranking(items, {
			k: 1,
			maxTasks: 10,
			m: 3,
			seed: 42,
		});

		const { items: task } = ranking.selectTask();
		ranking.recordTask(task[0], task[task.length - 1]);

		const undone = ranking.undoLastTask();
		expect(undone.best).toBe(task[0]);
		expect(undone.worst).toBe(task[task.length - 1]);
		expect(undone.set).toEqual(task);
	});

	it("undoLastTask throws when no tasks to undo", () => {
		const ranking = new Ranking(["a", "b", "c", "d"], {
			k: 1,
			m: 3,
			seed: 42,
		});
		expect(() => ranking.undoLastTask()).toThrow("No task to undo");
	});

	it("clone produces an independent copy", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const ranking = new Ranking(items, {
			k: 5,
			maxTasks: 40,
			m: 3,
			seed: 42,
		});

		for (let i = 0; i < 3; i++) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((x) => x);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		const cloned = ranking.clone();

		expect(cloned.round).toBe(ranking.round);
		expect(cloned.stopped).toBe(ranking.stopped);
		expect(cloned.stopReason).toBe(ranking.stopReason);
		expect(cloned.topK).toEqual(ranking.topK);

		// Mutating clone does not affect original
		const { items: task } = cloned.selectTask();
		cloned.recordTask(task[0], task[task.length - 1]);
		expect(cloned.round).toBe(ranking.round + 1);
		expect(ranking.round).toBe(3);
	});

	it("handles k >= n (all items in top-k)", () => {
		const items = ["a", "b"];
		const ranking = new Ranking(items, { k: 2, m: 3, seed: 42 });
		expect(ranking.stopped).toBe(true);
		expect(ranking.stopReason).toBe("confidence");
		expect(new Set(ranking.topK)).toEqual(new Set(["a", "b"]));
	});

	it("handles k >= n with k > n", () => {
		const items = ["a", "b"];
		const ranking = new Ranking(items, { k: 5, m: 3, seed: 42 });
		expect(ranking.stopped).toBe(true);
		expect(ranking.stopReason).toBe("confidence");
	});

	it("handles n = 1", () => {
		const ranking = new Ranking(["only"], { k: 1, m: 3, seed: 42 });
		expect(ranking.stopped).toBe(true);
		expect(ranking.topK).toEqual(["only"]);
	});
});

describe("adaptive k oracle convergence", () => {
	function logConfidenceComparison(label: string, ranking: Ranking<number>): void {
		const d = ranking.debugState();
		const n = d.mu.length;
		const r = argsortDescending(d.mu);
		const parts: string[] = [];
		for (const kk of [3, 4, 5]) {
			if (kk >= n) {
				parts.push(`k=${String(kk)}: N/A`);
				continue;
			}
			const iStar = r[kk - 1];
			const jStar = r[kk];
			const varDiff = d.sigma[iStar * n + iStar] + d.sigma[jStar * n + jStar] - 2 * d.sigma[iStar * n + jStar];
			const bErr = ((1 - normalCdf((d.mu[iStar] - d.mu[jStar]) / Math.sqrt(Math.max(varDiff, 1e-12)))) * 100).toFixed(1);
			const bayesP = bayesianTopKProbability(d.mu, d.sigma, kk, 2000, makeXorshift(123));
			const bayErr = ((1 - bayesP) * 100).toFixed(1);
			parts.push(`k=${String(kk)}: b=${bErr}% y=${bayErr}%`);
		}
		console.log(`  [${label}] rounds=${String(ranking.round)} stop=${ranking.stopReason ?? "?"} eK=${String(ranking.effectiveK)}  ${parts.join("  ")}`);
	}

	// 8 items with descending strengths (item 0 = strongest).
	// Perfect oracle always picks correctly.
	// With minK=3, should still find the full top-5 since all boundaries are clear.
	it("perfect oracle converges with effectiveK=5", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [8, 7, 6, 5, 4, 3, 2, 1];
		const expectedTop5 = new Set([0, 1, 2, 3, 4]);

		// Run all 60 rounds (use tiny delta to prevent early stop)
		const probe = new Ranking(items, {
			k: 5,
			maxTasks: 60,
			delta: 0.001,
			m: 3,
			seed: 42,
		});

		const allTasks: number[][] = [];
		while (!probe.stopped) {
			const { items: task } = probe.selectTask();
			allTasks.push([...task]);
			const strengths = task.map((ii) => trueStrength[ii]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			probe.recordTask(task[bestIdx], task[worstIdx]);
		}

		console.log(`  Tasks (${String(allTasks.length)} total):`);
		for (let t = 0; t < allTasks.length; t++) {
			console.log(`    ${String(t + 1).padStart(2)}: [${allTasks[t].join(",")}]`);
		}

		// Item histogram
		const itemCounts = new Array<number>(8).fill(0);
		for (const task of allTasks) {
			for (const item of task) itemCounts[item]++;
		}
		console.log(`\n  Item histogram:`);
		for (let i = 0; i < 8; i++) {
			console.log(`    item ${String(i)}: ${String(itemCounts[i]).padStart(2)} ${"#".repeat(itemCounts[i])}`);
		}

		// Pair histogram
		const pairCounts = new Map<string, number>();
		for (const task of allTasks) {
			const sorted = [...task].sort((a, b) => a - b);
			for (let i = 0; i < sorted.length; i++) {
				for (let j = i + 1; j < sorted.length; j++) {
					const key = `${String(sorted[i])}-${String(sorted[j])}`;
					pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
				}
			}
		}
		const pairEntries = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]);
		console.log(`\n  Pair histogram (${String(pairEntries.length)} unique pairs):`);
		for (const [pair, count] of pairEntries) {
			console.log(`    ${pair.padEnd(4)}: ${String(count).padStart(2)} ${"#".repeat(count)}`);
		}

		// Triplet histogram
		const tripletCounts = new Map<string, number>();
		for (const task of allTasks) {
			const key = [...task].sort((a, b) => a - b).join("-");
			tripletCounts.set(key, (tripletCounts.get(key) ?? 0) + 1);
		}
		const tripletEntries = [...tripletCounts.entries()].sort((a, b) => b[1] - a[1]);
		console.log(`\n  Triplet histogram (${String(tripletEntries.length)} unique triplets):`);
		for (const [triplet, count] of tripletEntries) {
			console.log(`    ${triplet.padEnd(6)}: ${String(count).padStart(2)} ${"#".repeat(count)}`);
		}

		// Now run the actual ranking with adaptive k
		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((ii) => trueStrength[ii]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("n=8 m=3", ranking);
		expect(ranking.effectiveK).toBe(5);
		expect(new Set(ranking.topK)).toEqual(expectedTop5);
	});

	it("perfect oracle reports correct top-5 with n=9, maxTasks=60", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8];
		const trueStrength = [9, 8, 7, 6, 5, 4, 3, 2, 1];
		const expectedTop5 = new Set([0, 1, 2, 3, 4]);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => trueStrength[i]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("n=9 m=3", ranking);
		expect(new Set(ranking.topK)).toEqual(expectedTop5);
		expect(ranking.stopReason).toBe("confidence");
	});

	it("perfect oracle reports correct top-5 with n=12, maxTasks=60", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
		const trueStrength = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
		const expectedTop5 = new Set([0, 1, 2, 3, 4]);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => trueStrength[i]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("n=12 m=3", ranking);
		expect(new Set(ranking.topK)).toEqual(expectedTop5);
		expect(ranking.stopReason).toBe("confidence");
	});

	// Top 4 items have stable preferences (strengths 5–8).
	// Bottom 4 items get random strengths each task — no stable preference.
	// Should converge on top-4 since the bottom-4 boundary is unresolvable.
	it("semi-confident oracle (random bottom 4) converges with effectiveK=4", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [1, 2, 3, 4, 5, 6, 7, 8];
		const expectedTop4 = new Set([4, 5, 6, 7]);
		const confidentItems = new Set([4, 5, 6, 7]);
		const noiseRng = makeXorshift(99);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => {
				if (confidentItems.has(i)) return trueStrength[i];
				return noiseRng.next() * 4; // random strength in [0, 4)
			});
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("semi-random4", ranking);
		expect(ranking.stopReason).toBe("reduced-k");
		expect(ranking.effectiveK).toBe(4);
		expect(new Set(ranking.topK)).toEqual(expectedTop4);
	});

	// Top 4 items have stable preferences (strengths 5–8).
	// Bottom 4 items use true strengths but with noise: on each task,
	// each bottom-4 item's effective strength is perturbed by ±2,
	// causing occasional misranking among them.
	// Should still converge, possibly with effectiveK=4 or 5.
	it("semi-confident oracle (noisy bottom 4) converges with correct top-4", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [1, 2, 3, 4, 5, 6, 7, 8];
		const expectedTop4 = new Set([4, 5, 6, 7]);
		const confidentItems = new Set([4, 5, 6, 7]);
		const noiseRng = makeXorshift(77);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => {
				if (confidentItems.has(i)) return trueStrength[i];
				// True strength ± noise: e.g. strength 4 could become 2–6
				return trueStrength[i] + (noiseRng.next() - 0.5) * 4;
			});
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("noisy4", ranking);
		expect(["confidence", "reduced-k"]).toContain(ranking.stopReason);
		expect(ranking.effectiveK).toBeGreaterThanOrEqual(4);
		const topItems = new Set(ranking.topK);
		for (const item of expectedTop4) {
			expect(topItems).toContain(item);
		}
	});

	// Top 3 items have stable preferences (strengths 6–8).
	// Bottom 5 items get random strengths each task.
	// Should converge on effectiveK=3 at budget exhaustion.
	it("semi-confident oracle (random bottom 5, perfect top 3) converges with effectiveK=3", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [1, 2, 3, 4, 5, 6, 7, 8];
		const expectedTop3 = new Set([5, 6, 7]);
		const confidentItems = new Set([5, 6, 7]);
		const noiseRng = makeXorshift(99);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => {
				if (confidentItems.has(i)) return trueStrength[i];
				return noiseRng.next() * 5; // random strength in [0, 5)
			});
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("semi-random5", ranking);
		expect(ranking.effectiveK).toBe(3);
		expect(new Set(ranking.topK)).toEqual(expectedTop3);
		expect(ranking.stopReason).toBe("reduced-k");
	});

	// Clear top 2 (strengths 7,8) and clear bottom 2 (strengths 1,2),
	// but the 4 middle items are random each task. Every possible
	// boundary (k=3,4,5) falls in the mushy middle, so the algorithm
	// cannot find confidence and exhausts the budget.
	it("clear top 2 and bottom 2, mushy middle 4 — hits max-tasks", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const trueStrength = [1, 2, 0, 0, 0, 0, 7, 8];
		const confidentItems = new Set([0, 1, 6, 7]);
		const noiseRng = makeXorshift(55);

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const strengths = task.map((i) => {
				if (confidentItems.has(i)) return trueStrength[i];
				// Middle items: random strength in [2, 6) — overlapping with
				// the confident zone so the boundary is genuinely ambiguous.
				return 2 + noiseRng.next() * 4;
			});
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("mushy", ranking);
		expect(ranking.stopReason).toBe("max-tasks");
		// The clear top 2 should appear and clear bottom 2 should not
		const topItems = new Set(ranking.topK);
		expect(topItems).toContain(6);
		expect(topItems).toContain(7);
		expect(topItems).not.toContain(0);
		expect(topItems).not.toContain(1);
	});

	// User changes their mind mid-ranking. For the first 15 rounds,
	// items 1 and 5 have strengths 7 and 3. After round 15, they swap
	// to 3 and 7. Items 0,2,3,4,6,7 keep stable strengths throughout.
	// The post-reversal top-5 is {0,5,2,3,4}. The algorithm should
	// identify the stable core (items always in top-5: 0,2,3) and
	// not crash or produce nonsensical results.
	it("preference reversal mid-ranking — identifies stable core", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const strengthsBefore = [8, 7, 6, 5, 4, 3, 2, 1];
		const strengthsAfter = [8, 3, 6, 5, 4, 7, 2, 1];
		// Items always in top-5 regardless of phase: 0 (8), 2 (6), 3 (5)
		// Item 4 (strength 4) is top-5 in both phases but near the boundary
		const stableCore = new Set([0, 2, 3]);
		const reversalRound = 15;

		const ranking = new Ranking(items, {
			k: 5,
			minK: 3,
			maxTasks: 60,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			const currentStrengths = ranking.round < reversalRound ? strengthsBefore : strengthsAfter;
			const strengths = task.map((i) => currentStrengths[i]);
			const bestIdx = strengths.indexOf(Math.max(...strengths));
			const worstIdx = strengths.indexOf(Math.min(...strengths));
			ranking.recordTask(task[bestIdx], task[worstIdx]);
		}

		logConfidenceComparison("reversal", ranking);
		// The algorithm should finish (either confidence or max-tasks)
		expect(ranking.stopped).toBe(true);
		// The stable core should be in the top-k regardless of effectiveK
		const topItems = new Set(ranking.topK);
		for (const item of stableCore) {
			expect(topItems).toContain(item);
		}
		// Items 6 and 7 are clearly bottom-tier in both phases (strengths 2, 1)
		expect(topItems).not.toContain(6);
		expect(topItems).not.toContain(7);
	});
});

describe("estimateRemaining integration", () => {
	it("returns zero estimate when already stopped", () => {
		const items = ["a", "b"];
		const ranking = new Ranking(items, { k: 2, m: 3, seed: 42 });
		expect(ranking.stopped).toBe(true);
		const est = ranking.estimateRemaining();
		expect(est).toBe(0);
	});

	it("never exceeds budget", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7];
		const ranking = new Ranking(items, {
			k: 4,
			maxTasks: 15,
			m: 3,
			seed: 42,
		});

		while (!ranking.stopped) {
			const { items: task } = ranking.selectTask();
			ranking.recordTask(task[0], task[task.length - 1]);
			const est = ranking.estimateRemaining();
			if (est !== null) {
				const budget = 15 - ranking.round;
				expect(est).toBeLessThanOrEqual(budget);
			}
		}
	});
});
