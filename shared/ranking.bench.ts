import { bench, describe } from "vitest";

import { makeXorshift, Ranking } from "./ranking.ts";

/**
 * Advance a ranking using a noisy oracle. The stronger item wins most of
 * the time, but occasionally the weaker item wins (upset). This prevents
 * the algorithm from converging too quickly, letting us reach late-game
 * states with production config.
 */
function advanceRanking(ranking: Ranking<number>, rounds: number, rng: ReturnType<typeof makeXorshift>): void {
	for (let i = 0; i < rounds && !ranking.stopped; i++) {
		const { items: task } = ranking.selectTask();
		const strengths = task.map((x) => x);
		const bestIdx = strengths.indexOf(Math.max(...strengths));
		const worstIdx = strengths.indexOf(Math.min(...strengths));
		let best = task[bestIdx];
		let worst = task[worstIdx];
		// ~20% chance the oracle gives wrong answers
		if (rng.next() < 0.2) {
			[best, worst] = [worst, best];
		}
		ranking.recordTask(best, worst);
	}
}

// Build snapshots at early, mid, and late game states from a single run.
// Each bench iteration clones the snapshot and runs one step, so the
// timing reflects exactly one selectTask + recordTask at that state.

const items = Array.from({ length: 12 }, (_, i) => i);
const oracleRng = makeXorshift(99);
const ranking = new Ranking(items, {
	k: 5,
	m: 3,
	seed: 99,
});

advanceRanking(ranking, 10, oracleRng);
const mid = ranking.clone();

describe("Ranking single step (12 items, k=5, m=3)", () => {
	bench(`mid game (round ${mid.round.toString()})`, () => {
		const r = mid.clone();
		const { items: task } = r.selectTask();
		const strengths = task.map((x) => x);
		const bestIdx = strengths.indexOf(Math.max(...strengths));
		const worstIdx = strengths.indexOf(Math.min(...strengths));
		r.recordTask(task[bestIdx], task[worstIdx]);
	});
});
