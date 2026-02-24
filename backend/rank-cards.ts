import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { type MeaningCard, MEANING_CARDS } from "../shared/meaning-cards.ts";
import { argsortDescending, checkConfidenceStop, Ranking } from "../shared/ranking.ts";

async function main(): Promise<void> {
	const rl = readline.createInterface({ input: stdin, output: stdout });

	const cards = MEANING_CARDS.slice(0, 8);
	const ranking = new Ranking<MeaningCard>(cards);

	console.log("=== SoMeCaM Card Ranking ===");
	console.log(`Ranking ${String(cards.length)} cards to find your top ${String(ranking.effectiveK)}.\n`);
	console.log("For each pair, type A or B to choose which resonates more.\n");

	while (!ranking.stopped) {
		const { a, b } = await ranking.selectPair();

		console.log(`--- Round ${String(ranking.round + 1)} ---`);
		console.log(`  A: [${a.source}] "${a.description}"`);
		console.log(`  B: [${b.source}] "${b.description}"`);

		let choice: MeaningCard | null = null;
		while (choice === null) {
			const answer = await rl.question("  Your choice (A/B): ");
			const normalized = answer.trim().toUpperCase();
			if (normalized === "A") {
				choice = a;
			} else if (normalized === "B") {
				choice = b;
			} else {
				console.log('  Please enter "A" or "B".');
			}
		}

		const winner = choice;
		const loser = winner === a ? b : a;
		const { stopReason } = await ranking.recordComparison(winner, loser);

		// Show progress
		console.log(`  Comparisons so far: ${String(ranking.round)}`);
		console.log(`  Current top ${String(ranking.topK.length)}: ${ranking.topK.map((c: MeaningCard) => c.source).join(", ")}`);

		// Debug: adaptive K state
		const debug = ranking.debugState();
		const mu = debug.mu;
		const sigma = debug.sigma;
		const sorted = argsortDescending(mu);

		// Confidence gaps per K
		for (let dk = debug.config.k; dk >= debug.config.minK; dk--) {
			const topKSet = sorted.slice(0, dk);
			const restSet = sorted.slice(dk);
			if (restSet.length === 0) continue;
			let weakestLcb = Infinity;
			for (const idx of topKSet) {
				const lcb = mu[idx] - debug.config.z * sigma[idx];
				if (lcb < weakestLcb) weakestLcb = lcb;
			}
			let strongestUcb = -Infinity;
			for (const idx of restSet) {
				const ucb = mu[idx] + debug.config.z * sigma[idx];
				if (ucb > strongestUcb) strongestUcb = ucb;
			}
			const gap = weakestLcb - strongestUcb;
			const reducedZ = debug.config.z + debug.config.kReductionReluctance * (1 - debug.round / debug.config.maxComparisons);
			const passes = dk === debug.config.k ? checkConfidenceStop(mu, sigma, dk, debug.config.z, debug.config.confidenceThreshold) : checkConfidenceStop(mu, sigma, dk, reducedZ, debug.config.confidenceThreshold);
			console.log(`  [k=${String(dk)}] gap=${gap.toFixed(3)} z=${dk === debug.config.k ? debug.config.z.toFixed(2) : reducedZ.toFixed(2)} pass=${String(passes)}`);

			// Show top set for this K
			const topNames = sorted.slice(0, dk).map((idx) => cards[idx].source);
			console.log(`    top-${String(dk)}: ${topNames.join(", ")}`);
		}

		// Stability counts per K
		const current = debug.reducedKStability;
		const fullKStable = `k=${String(debug.config.k)}: ${String(debug.fullKStableCount)}`;
		const reducedStab = current.map((e) => `k=${String(e.k)}: ${String(e.stableCount)}`).join(", ");
		console.log(`  Stability: ${fullKStable}${reducedStab.length > 0 ? `, ${reducedStab}` : ""}`);

		// K-weights
		const kwStr = debug.kWeights.map((w) => `k=${String(w.k)}: ${w.weight.toFixed(2)}`).join(", ");
		console.log(`  K-weights: ${kwStr}`);

		const remaining = ranking.estimateRemaining();
		if (remaining !== null) {
			const lo = Math.ceil(remaining.low);
			const mid = Math.ceil(remaining.mid);
			const hi = Math.ceil(remaining.high);
			console.log(`  Estimated remaining: ~${String(mid)} (${String(lo)}-${String(hi)})`);
		}

		if (stopReason !== null) {
			console.log(`\n  Stopping: ${stopReason} (effectiveK=${String(ranking.effectiveK)})`);
		}
		console.log();
	}

	console.log(`=== Your Top ${String(ranking.topK.length)} Sources of Meaning ===\n`);
	ranking.topK.forEach((card: MeaningCard, i: number) => {
		console.log(`  ${String(i + 1)}. [${card.source}] "${card.description}"`);
	});
	console.log();

	rl.close();
}

main().catch((err: unknown) => {
	console.error(err);
	process.exitCode = 1;
});
