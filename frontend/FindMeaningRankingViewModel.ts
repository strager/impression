import { ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import type { RemainingEstimate } from "../shared/ranking.ts";
import { Ranking } from "../shared/ranking.ts";
import { capture } from "./analytics.ts";
import { loadRanking, loadSwipeProgress, needsPrioritization, saveChosenCardIds, saveRanking, selectCandidateCards } from "./store.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

export class FindMeaningRankingViewModel {
	private readonly sessionId: string;
	private readonly _currentPair = ref<[MeaningCard, MeaningCard] | null>(null);
	private ranking: Ranking<string> | null = null;
	private cardIds: string[] = [];
	private _phaseStartedAtMs = 0;
	private _pairShownAtMs = 0;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	get isComplete(): boolean {
		return this.ranking?.stopped === true;
	}

	get topK(): readonly MeaningCard[] {
		if (this.ranking === null) return [];
		return this.ranking.topK.map((id) => cardsById.get(id)).filter((c): c is MeaningCard => c !== undefined);
	}

	get currentPair(): [MeaningCard, MeaningCard] | null {
		return this._currentPair.value;
	}

	get round(): number {
		return this.ranking?.round ?? 0;
	}

	get canUndo(): boolean {
		return this.ranking !== null && this.ranking.round > 0;
	}

	get estimatedRemaining(): RemainingEstimate {
		return this.ranking?.estimateRemaining() ?? null;
	}

	async initialize(): Promise<"ready" | "no-data" | "skip"> {
		this._phaseStartedAtMs = performance.now();
		const saved = loadRanking(this.sessionId);
		let resolvedCardIds: string[];

		if (saved !== null) {
			resolvedCardIds = saved.cardIds;
		} else {
			const progress = loadSwipeProgress(this.sessionId);
			if (progress === null || progress.swipeHistory.length < progress.shuffledCardIds.length) {
				return "no-data";
			}
			resolvedCardIds = selectCandidateCards(this.sessionId);
		}

		if (resolvedCardIds.length === 0) {
			return "no-data";
		}

		this.cardIds = resolvedCardIds;

		if (!needsPrioritization(this.sessionId)) {
			saveChosenCardIds(this.sessionId, resolvedCardIds);
			return "skip";
		}

		const resumedFromRound = saved?.comparisons.length ?? 0;
		this.ranking = new Ranking(resolvedCardIds, { k: 5 });

		if (saved !== null) {
			for (const comp of saved.comparisons) {
				if (this.ranking.stopped) break;
				await this.ranking.recordComparison(comp.winner, comp.loser);
			}
		}

		if (!this.ranking.stopped) {
			await this.showNextPair();
		}

		capture("ranking_entered", {
			session_id: this.sessionId,
			card_count: resolvedCardIds.length,
			resumed_from_round: resumedFromRound,
		});

		return "ready";
	}

	async choose(index: 0 | 1): Promise<void> {
		if (this.ranking === null || this.ranking.stopped) {
			throw new Error("Cannot choose: ranking is null or stopped");
		}
		const pair = this._currentPair.value;
		if (pair === null) {
			throw new Error("Cannot choose: no current pair");
		}

		const winner = pair[index];
		const loser = pair[1 - index];
		const now = performance.now();
		const timeOnPairMs = Math.round(now - this._pairShownAtMs);

		const result = await this.ranking.recordComparison(winner.id, loser.id);

		if (result.stopped) {
			this.saveProgress(true);
		} else {
			await this.showNextPair();
			this.saveProgress(false);
		}

		const est = this.ranking.estimateRemaining();
		capture("ranking_comparison_made", {
			session_id: this.sessionId,
			time_on_pair_ms: timeOnPairMs,
			comparisons_so_far: this.ranking.round,
			estimated_remaining: est !== null ? Math.ceil(est.mid) : -1,
		});
	}

	async undo(): Promise<string> {
		if (this.ranking === null || this.ranking.round === 0) {
			throw new Error("Cannot undo: no comparisons to undo");
		}
		const undone = await this.ranking.undoLastComparison();
		await this.showNextPair();
		this.saveProgress(false);

		capture("ranking_undone", { session_id: this.sessionId });
		return undone.winner;
	}

	finalize(): void {
		if (this.ranking === null) {
			throw new Error("Cannot finalize: ranking is null");
		}
		const chosenIds = this.ranking.topK;
		saveChosenCardIds(this.sessionId, [...chosenIds]);

		capture("ranking_completed", {
			session_id: this.sessionId,
			comparisons_made: this.ranking.round,
			stop_reason: this.ranking.stopReason ?? "unknown",
			total_time_ms: Math.round(performance.now() - this._phaseStartedAtMs),
			chosen_count: chosenIds.length,
		});
	}

	private saveProgress(complete: boolean): void {
		if (this.ranking === null) {
			throw new Error("Cannot save progress: ranking is null");
		}
		saveRanking(this.sessionId, {
			cardIds: this.cardIds,
			comparisons: this.ranking.history.map((c) => ({ winner: c.winner, loser: c.loser })),
			complete,
		});
	}

	private async showNextPair(): Promise<void> {
		if (this.ranking === null) {
			throw new Error("Cannot show next pair: ranking is null");
		}
		const { a, b } = await this.ranking.selectPair();
		const cardA = cardsById.get(a);
		const cardB = cardsById.get(b);
		if (cardA === undefined || cardB === undefined) {
			throw new Error("Card not found for ranking pair");
		}
		this._currentPair.value = [cardA, cardB];
		this._pairShownAtMs = performance.now();
	}
}
