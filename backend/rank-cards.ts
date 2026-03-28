import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { type MeaningCard, MEANING_CARDS } from "../shared/meaning-cards.ts";
import { Ranking } from "../shared/ranking.ts";

async function main(): Promise<void> {
	const rl = readline.createInterface({ input: stdin, output: stdout });

	const cards = MEANING_CARDS.slice(0, 8);
	const ranking = new Ranking<MeaningCard>(cards, { seed: 42 });

	console.log("=== Impression Card Ranking (MaxDiff) ===");
	console.log(`Ranking ${String(cards.length)} cards to find your top ${String(ranking.effectiveK)}.\n`);
	console.log("For each set of 3 cards, choose which matters MOST and LEAST.\n");

	while (!ranking.stopped) {
		const { items: task } = ranking.selectTask();

		console.log(`--- Task ${String(ranking.round + 1)} ---`);
		task.forEach((card, i) => {
			console.log(`  ${String(i + 1)}: [${card.source}] "${card.description}"`);
		});

		let best: MeaningCard | null = null;
		while (best === null) {
			const answer = await rl.question(`  Which matters MOST? (1-${String(task.length)}): `);
			const idx = parseInt(answer.trim(), 10) - 1;
			if (idx >= 0 && idx < task.length) {
				best = task[idx];
			} else {
				console.log(`  Please enter a number between 1 and ${String(task.length)}.`);
			}
		}

		const remaining = task.filter((c) => c !== best);
		let worst: MeaningCard | null = null;
		while (worst === null) {
			console.log("  Remaining:");
			remaining.forEach((card, i) => {
				console.log(`    ${String(i + 1)}: [${card.source}] "${card.description}"`);
			});
			const answer = await rl.question(`  Which matters LEAST? (1-${String(remaining.length)}): `);
			const idx = parseInt(answer.trim(), 10) - 1;
			if (idx >= 0 && idx < remaining.length) {
				worst = remaining[idx];
			} else {
				console.log(`  Please enter a number between 1 and ${String(remaining.length)}.`);
			}
		}

		const { stopReason } = ranking.recordTask(best, worst);

		// Show progress
		console.log(`  Tasks so far: ${String(ranking.round)}`);
		console.log(`  Current top ${String(ranking.topK.length)}: ${ranking.topK.map((c: MeaningCard) => c.source).join(", ")}`);

		const est = ranking.estimateRemaining();
		if (est !== null) {
			console.log(`  Estimated remaining: ~${String(Math.ceil(est))}`);
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
	process.exit();
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
