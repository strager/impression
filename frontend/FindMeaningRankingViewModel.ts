import { type ShallowRef, ref, shallowRef, triggerRef } from "vue";

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
	// You should manually trigger this ref when calling mutating methods of
	// Ranking.
	private readonly _ranking: ShallowRef<Ranking<string> | null> = shallowRef(null);
	private cardIds: string[] = [];
	private _phaseStartedAtMs = 0;
	private _pairShownAtMs = 0;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	get isComplete(): boolean {
		return this._ranking.value?.stopped === true;
	}

	get topK(): readonly MeaningCard[] {
		if (this._ranking.value === null) return [];
		return this._ranking.value.topK.map((id) => cardsById.get(id)).filter((c): c is MeaningCard => c !== undefined);
	}

	get currentPair(): [MeaningCard, MeaningCard] | null {
		return this._currentPair.value;
	}

	get round(): number {
		return this._ranking.value?.round ?? 0;
	}

	get canUndo(): boolean {
		return this._ranking.value !== null && this._ranking.value.round > 0;
	}

	get estimatedRemaining(): RemainingEstimate {
		return this._ranking.value?.estimateRemaining() ?? null;
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
		this._ranking.value = new Ranking(resolvedCardIds, { k: 5 });

		if (saved !== null) {
			for (const comp of saved.comparisons) {
				if (this._ranking.value.stopped) break;
				await this._ranking.value.recordComparison(comp.winner, comp.loser);
				triggerRef(this._ranking);
			}
		}

		if (!this._ranking.value.stopped) {
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
		if (this._ranking.value === null || this._ranking.value.stopped) {
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

		const result = await this._ranking.value.recordComparison(winner.id, loser.id);
		triggerRef(this._ranking);

		if (result.stopped) {
			this.saveProgress(true);
		} else {
			await this.showNextPair();
			this.saveProgress(false);
		}

		const est = this._ranking.value.estimateRemaining();
		capture("ranking_comparison_made", {
			session_id: this.sessionId,
			time_on_pair_ms: timeOnPairMs,
			comparisons_so_far: this._ranking.value.round,
			estimated_remaining: est !== null ? Math.ceil(est.mid) : -1,
		});
	}

	async undo(): Promise<string> {
		if (this._ranking.value === null || this._ranking.value.round === 0) {
			throw new Error("Cannot undo: no comparisons to undo");
		}
		const undone = await this._ranking.value.undoLastComparison();
		triggerRef(this._ranking);
		await this.showNextPair();
		this.saveProgress(false);

		capture("ranking_undone", { session_id: this.sessionId });
		return undone.winner;
	}

	finalize(): void {
		if (this._ranking.value === null) {
			throw new Error("Cannot finalize: ranking is null");
		}
		const chosenIds = this._ranking.value.topK;
		saveChosenCardIds(this.sessionId, [...chosenIds]);

		capture("ranking_completed", {
			session_id: this.sessionId,
			comparisons_made: this._ranking.value.round,
			stop_reason: this._ranking.value.stopReason ?? "unknown",
			total_time_ms: Math.round(performance.now() - this._phaseStartedAtMs),
			chosen_count: chosenIds.length,
			effective_k: this._ranking.value.effectiveK,
		});
	}

	private saveProgress(complete: boolean): void {
		if (this._ranking.value === null) {
			throw new Error("Cannot save progress: ranking is null");
		}
		saveRanking(this.sessionId, {
			cardIds: this.cardIds,
			comparisons: this._ranking.value.history.map((c) => ({ winner: c.winner, loser: c.loser })),
			complete,
		});
	}

	private async showNextPair(): Promise<void> {
		if (this._ranking.value === null) {
			throw new Error("Cannot show next pair: ranking is null");
		}
		const { a, b } = await this._ranking.value.selectPair();
		const cardA = cardsById.get(a);
		const cardB = cardsById.get(b);
		if (cardA === undefined || cardB === undefined) {
			throw new Error("Card not found for ranking pair");
		}
		this._currentPair.value = [cardA, cardB];
		this._pairShownAtMs = performance.now();
	}
}
