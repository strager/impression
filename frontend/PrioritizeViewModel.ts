import { type ShallowRef, ref, shallowRef, triggerRef } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import type { RankingConfig, RemainingEstimate, StopReason, TaskRecord } from "../shared/ranking.ts";
import { Ranking, makeXorshift } from "../shared/ranking.ts";
import { capture } from "./analytics.ts";
import type { MaxDiffComparison } from "./store.ts";
import { loadRanking, loadSwipeProgress, needsPrioritization, saveChosenCardIds, saveRanking, selectCandidateCards } from "./store.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

export class IdentifyRankingViewModel {
	private readonly profileId: string;
	private readonly _currentTask = ref<MeaningCard[] | null>(null);
	// You should manually trigger this ref when calling mutating methods of
	// Ranking.
	private readonly _ranking: ShallowRef<Ranking<string> | null> = shallowRef(null);
	private _allComparisons: MaxDiffComparison[] = [];
	private _cardIds: string[] = [];
	private _phaseStartedAtMs = 0;
	private _taskShownAtMs = 0;

	constructor(profileId: string) {
		this.profileId = profileId;
	}

	get isComplete(): boolean {
		return this._ranking.value?.stopped === true;
	}

	get topK(): readonly MeaningCard[] {
		if (this._ranking.value === null) return [];
		return this._ranking.value.topK.map((id) => cardsById.get(id)).filter((c): c is MeaningCard => c !== undefined);
	}

	get topKDisplayOrder(): readonly MeaningCard[] {
		const ids = new Set(this.topK.map((c) => c.id));
		return MEANING_CARDS.filter((c) => ids.has(c.id));
	}

	get currentTask(): MeaningCard[] | null {
		return this._currentTask.value;
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

	get pendingRedo(): { bestId: string; worstId: string } | null {
		const round = this._ranking.value?.round ?? 0;
		if (round >= this._allComparisons.length) return null;
		const entry = this._allComparisons[round];
		return { bestId: entry.best, worstId: entry.worst };
	}

	get cardIds(): readonly string[] {
		// _cardIds is a plain field; reading _ranking.value first ties this getter
		// to the ShallowRef so Vue computeds re-run once initialize() populates both.
		if (this._ranking.value === null) return [];
		return this._cardIds;
	}

	get history(): readonly TaskRecord<string>[] {
		return this._ranking.value?.history ?? [];
	}

	get debugState(): {
		mu: Float64Array;
		sigma: Float64Array;
		exposures: readonly number[];
		config: RankingConfig;
		round: number;
	} | null {
		return this._ranking.value?.debugState() ?? null;
	}

	get stopReason(): StopReason | null {
		return this._ranking.value?.stopReason ?? null;
	}

	get effectiveK(): number | null {
		return this._ranking.value?.effectiveK ?? null;
	}

	initialize(): "ready" | "no-data" | "skip" {
		this._phaseStartedAtMs = performance.now();
		const saved = loadRanking(this.profileId);
		let resolvedCardIds: string[];

		if (saved !== null) {
			resolvedCardIds = saved.cardIds;
		} else {
			const progress = loadSwipeProgress(this.profileId);
			if (progress === null || progress.swipeHistory.length < progress.shuffledCardIds.length) {
				return "no-data";
			}
			resolvedCardIds = selectCandidateCards(this.profileId);
		}

		if (resolvedCardIds.length === 0) {
			return "no-data";
		}

		this._cardIds = resolvedCardIds;

		if (!needsPrioritization(this.profileId)) {
			saveChosenCardIds(this.profileId, resolvedCardIds);
			return "skip";
		}

		this._ranking.value = new Ranking(resolvedCardIds, { k: 5, seed: 42 });

		if (saved !== null) {
			this._allComparisons = saved.comparisons.map((c) => ({ set: [...c.set], best: c.best, worst: c.worst }));
			const activeRound = saved.activeRound ?? saved.comparisons.length;
			for (let i = 0; i < activeRound; i++) {
				if (this._ranking.value.stopped) break;
				const comp = saved.comparisons[i];
				this._ranking.value.recordTask(comp.best, comp.worst, comp.set);
			}
		}

		const resumedFromRound = this._ranking.value.round;

		if (!this._ranking.value.stopped) {
			this.showNextTask();
		}

		triggerRef(this._ranking);

		capture("prioritize_entered", {
			session_id: this.profileId,
			card_count: resolvedCardIds.length,
			resumed_from_round: resumedFromRound,
		});

		return "ready";
	}

	choose(bestIndex: number, worstIndex: number): void {
		if (this._ranking.value === null || this._ranking.value.stopped) {
			throw new Error("Cannot choose: ranking is null or stopped");
		}
		const task = this._currentTask.value;
		if (task === null) {
			throw new Error("Cannot choose: no current task");
		}

		const best = task[bestIndex];
		const worst = task[worstIndex];
		const now = performance.now();
		const timeOnTaskMs = Math.round(now - this._taskShownAtMs);

		const cursor = this._ranking.value.round;
		const result = this._ranking.value.recordTask(best.id, worst.id);

		const lastHistory = this._ranking.value.history.at(-1);
		if (lastHistory === undefined) {
			throw new Error("No history after recordTask");
		}
		const newComp: MaxDiffComparison = { set: [...lastHistory.set], best: lastHistory.best, worst: lastHistory.worst };
		if (cursor < this._allComparisons.length) {
			const existing = this._allComparisons[cursor];
			if (existing.best !== newComp.best || existing.worst !== newComp.worst) {
				this._allComparisons.length = cursor;
				this._allComparisons.push(newComp);
			}
		} else {
			this._allComparisons.push(newComp);
		}

		if (result.stopped) {
			this.saveProgress(true);
		} else {
			this.showNextTask();
			this.saveProgress(false);
		}

		triggerRef(this._ranking);

		const est = this._ranking.value.estimateRemaining();
		capture("prioritize_comparison_made", {
			session_id: this.profileId,
			time_on_pair_ms: timeOnTaskMs,
			comparisons_so_far: this._ranking.value.round,
			estimated_remaining: est !== null ? Math.ceil(est) : -1,
		});
	}

	undo(): { bestId: string; worstId: string } {
		if (this._ranking.value === null || this._ranking.value.round === 0) {
			throw new Error("Cannot undo: no tasks to undo");
		}
		const undone = this._allComparisons[this._ranking.value.round - 1];
		const bestId = undone.best;
		const worstId = undone.worst;
		this._ranking.value.undoLastTask();
		this.showNextTask();
		triggerRef(this._ranking);
		this.saveProgress(false);

		capture("prioritize_undone", { session_id: this.profileId });
		return { bestId, worstId };
	}

	finalize(): void {
		if (this._ranking.value === null) {
			throw new Error("Cannot finalize: ranking is null");
		}
		const chosenIds = this._ranking.value.topK;
		saveChosenCardIds(this.profileId, [...chosenIds]);

		capture("prioritize_completed", {
			session_id: this.profileId,
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
		saveRanking(this.profileId, {
			cardIds: this._cardIds,
			comparisons: this._allComparisons.map((c) => ({ set: [...c.set], best: c.best, worst: c.worst })),
			activeRound: this._ranking.value.round < this._allComparisons.length ? this._ranking.value.round : undefined,
			complete,
		});
	}

	private showNextTask(): void {
		if (this._ranking.value === null) {
			throw new Error("Cannot show next task: ranking is null");
		}
		const { items } = this._ranking.value.selectTask();
		const cards = items.map((id) => cardsById.get(id)).filter((c): c is MeaningCard => c !== undefined);
		if (cards.length !== items.length) {
			throw new Error("Card not found for ranking task");
		}
		// Shuffle display order so cards don't appear in a predictable pattern
		const rng = makeXorshift(42);
		for (let i = cards.length - 1; i > 0; i--) {
			const j = Math.floor(rng.next() * (i + 1));
			[cards[i], cards[j]] = [cards[j], cards[i]];
		}
		this._currentTask.value = cards;
		this._taskShownAtMs = performance.now();
	}
}
