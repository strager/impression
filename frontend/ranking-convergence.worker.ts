// Web Worker for ranking convergence tests.
// Each message is a single runTest() job; the worker posts back the result.

import { makeXorshift } from "../shared/ranking-math.ts";
import { Ranking } from "../shared/ranking.ts";
import { range } from "./ranking-convergence-protocol.ts";
import type { OracleSpec, RunResult, WorkerRequest, WorkerResponse } from "./ranking-convergence-protocol.ts";

// ---------------------------------------------------------------------------
// Oracle reconstruction from serializable specs (length-2 task sets)
// ---------------------------------------------------------------------------

type OracleFn = (task: number[], trueStrength: number[], round: number) => { best: number; worst: number };

function buildOracle(spec: OracleSpec): OracleFn {
	switch (spec.type) {
		case "perfect":
			return (task, trueStrength) => {
				const strengths = task.map((i) => trueStrength[i]);
				const bestIdx = strengths.indexOf(Math.max(...strengths));
				const worstIdx = strengths.indexOf(Math.min(...strengths));
				return { best: task[bestIdx], worst: task[worstIdx] };
			};

		case "noisy": {
			const confidentSet = new Set(spec.confidentItems);
			const noiseRng = makeXorshift(spec.noiseSeed);
			return (task, trueStrength) => {
				const strengths = task.map((i) => {
					if (confidentSet.has(i)) return trueStrength[i];
					return trueStrength[i] + (noiseRng.next() - 0.5) * spec.noiseRange;
				});
				const bestIdx = strengths.indexOf(Math.max(...strengths));
				const worstIdx = strengths.indexOf(Math.min(...strengths));
				return { best: task[bestIdx], worst: task[worstIdx] };
			};
		}

		case "random-bottom": {
			const confidentSet = new Set(spec.confidentItems);
			const noiseRng = makeXorshift(spec.noiseSeed);
			return (task, trueStrength) => {
				const strengths = task.map((i) => {
					if (confidentSet.has(i)) return trueStrength[i];
					return noiseRng.next() * spec.randomMax;
				});
				const bestIdx = strengths.indexOf(Math.max(...strengths));
				const worstIdx = strengths.indexOf(Math.min(...strengths));
				return { best: task[bestIdx], worst: task[worstIdx] };
			};
		}

		case "mushy": {
			const confidentSet = new Set(spec.confidentItems);
			return (task, trueStr) => {
				const noiseRng = makeXorshift(55 + task[0] * 1000 + task.length);
				const strengths = task.map((i) => {
					if (confidentSet.has(i)) return trueStr[i];
					return 2 + noiseRng.next() * (spec.n - 4);
				});
				const bestIdx = strengths.indexOf(Math.max(...strengths));
				const worstIdx = strengths.indexOf(Math.min(...strengths));
				return { best: task[bestIdx], worst: task[worstIdx] };
			};
		}

		case "reversal":
			return (task, _trueStrength, round) => {
				const current = round < spec.reversalRound ? spec.strengthsBefore : spec.strengthsAfter;
				const strengths = task.map((i) => current[i]);
				const bestIdx = strengths.indexOf(Math.max(...strengths));
				const worstIdx = strengths.indexOf(Math.min(...strengths));
				return { best: task[bestIdx], worst: task[worstIdx] };
			};
	}
}

// ---------------------------------------------------------------------------
// Run a single test
// ---------------------------------------------------------------------------

function runTest(req: WorkerRequest): RunResult {
	const items = range(req.n);
	const oracle = buildOracle(req.oracleSpec);
	const ranking = new Ranking(items, {
		k: req.config.k,
		seed: req.seed,
		...(req.config.kMin !== undefined ? { kMin: req.config.kMin } : {}),
		...(req.maxTasks !== undefined ? { maxTasks: req.maxTasks } : {}),
		...(req.minTasks !== undefined ? { minTasks: req.minTasks } : {}),
		...(req.epsilon !== undefined ? { epsilon: req.epsilon } : {}),
	});
	const estimatedMidPerRound: (number | null)[] = [];
	while (!ranking.stopped) {
		const { items: pair } = ranking.selectTask();
		const { best, worst } = oracle(pair, req.trueStrength, ranking.round);
		ranking.recordTask(best, worst);
		estimatedMidPerRound.push(ranking.estimateRemaining());
	}
	const topK = new Set(ranking.topK);
	const eK = ranking.effectiveK;
	const perfectExpected = req.expectedTopK.slice(0, Math.min(req.config.k, req.expectedTopK.length));
	const perfectCorrect = perfectExpected.every((x) => topK.has(x)) && eK === perfectExpected.length;
	const goodEnoughExpected = req.expectedTopK.slice(0, Math.min(eK, req.expectedTopK.length));
	const goodEnoughCorrect = goodEnoughExpected.every((x) => topK.has(x));
	const correctness = perfectCorrect ? "perfect" : goodEnoughCorrect ? "good-enough" : "incorrect";
	return {
		round: ranking.round,
		stop: ranking.stopReason ?? "?",
		eK,
		correctness,
		maxTasks: ranking.maxTasks,
		estimatedMidPerRound,
	};
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const req = e.data;
	const result = runTest(req);
	const response: WorkerResponse = { jobId: req.jobId, result };
	self.postMessage(response);
};
