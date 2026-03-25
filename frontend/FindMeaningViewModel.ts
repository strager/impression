import { ref } from "vue";

import type { MeaningCard, SwipeDirection } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { capture } from "./analytics.ts";
import type { SwipeRecord } from "./store.ts";
import { loadSwipeProgress, needsPrioritization, saveChosenCardIds, saveRanking, selectCandidateCards, saveSwipeProgress } from "./store.ts";

function shuffle<T>(array: readonly T[]): T[] {
	const result = [...array];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

export class FindMeaningViewModel {
	private readonly sessionId: string;
	private readonly _shuffledCards = ref<MeaningCard[]>([]);
	private readonly _currentIndex = ref(0);
	private readonly _swipeHistory = ref<SwipeRecord[]>([]);
	private readonly _cardShownAtMs = ref(performance.now());
	private readonly _phaseStartedAtMs = ref(performance.now());

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	get currentCard(): MeaningCard | null {
		return this._shuffledCards.value[this._currentIndex.value] ?? null;
	}

	get nextCard(): MeaningCard | null {
		return this._shuffledCards.value[this._currentIndex.value + 1] ?? null;
	}

	get totalCards(): number {
		return this._shuffledCards.value.length;
	}

	get currentIndex(): number {
		return this._currentIndex.value;
	}

	get progressPercent(): number {
		return this.totalCards > 0 ? Math.round((this._currentIndex.value / this.totalCards) * 100) : 0;
	}

	get isComplete(): boolean {
		return this._currentIndex.value >= this.totalCards;
	}

	get canUndo(): boolean {
		return this._swipeHistory.value.length > 0;
	}

	get agreedCards(): MeaningCard[] {
		const ids = new Set(this._swipeHistory.value.filter((r) => r.direction === "agree").map((r) => r.cardId));
		return MEANING_CARDS.filter((c) => ids.has(c.id));
	}

	get unsureCards(): MeaningCard[] {
		const ids = new Set(this._swipeHistory.value.filter((r) => r.direction === "unsure").map((r) => r.cardId));
		return MEANING_CARDS.filter((c) => ids.has(c.id));
	}

	get requiresPrioritization(): boolean {
		return needsPrioritization(this.sessionId);
	}

	initialize(): void {
		this._phaseStartedAtMs.value = performance.now();
		const saved = loadSwipeProgress(this.sessionId);
		if (saved !== null) {
			const cards = saved.shuffledCardIds.map((id) => cardsById.get(id)).filter((c): c is MeaningCard => c !== undefined);
			if (cards.length > 0) {
				this._shuffledCards.value = cards;
				this._swipeHistory.value = saved.swipeHistory;
				this._currentIndex.value = saved.swipeHistory.length;
				this._cardShownAtMs.value = performance.now();
				return;
			}
		}
		this._shuffledCards.value = shuffle(MEANING_CARDS);
		this._cardShownAtMs.value = performance.now();
	}

	swipe(direction: SwipeDirection, method: "drag" | "button"): void {
		const card = this.currentCard;
		if (card === null) return;
		const now = performance.now();
		capture("card_swiped", {
			session_id: this.sessionId,
			method,
			time_on_card_ms: Math.round(now - this._cardShownAtMs.value),
		});
		this._swipeHistory.value.push({ cardId: card.id, direction });
		this._currentIndex.value++;
		this.saveProgress();
		this._cardShownAtMs.value = performance.now();
	}

	undo(): void {
		if (this._swipeHistory.value.length === 0) return;
		this._swipeHistory.value.pop();
		this._currentIndex.value = this._swipeHistory.value.length;
		capture("swipe_undone", { session_id: this.sessionId });
		this.saveProgress();
		this._cardShownAtMs.value = performance.now();
	}

	finalize(): void {
		const agreedCount = this._swipeHistory.value.filter((record) => record.direction === "agree").length;
		const disagreedCount = this._swipeHistory.value.filter((record) => record.direction === "disagree").length;
		const unsureCount = this._swipeHistory.value.filter((record) => record.direction === "unsure").length;
		capture("swiping_phase_completed", {
			session_id: this.sessionId,
			agreed_count: agreedCount,
			disagreed_count: disagreedCount,
			unsure_count: unsureCount,
			total_time_ms: Math.round(performance.now() - this._phaseStartedAtMs.value),
		});

		const cardIdsToConsider = selectCandidateCards(this.sessionId);

		if (needsPrioritization(this.sessionId)) {
			saveRanking(this.sessionId, { cardIds: cardIdsToConsider, comparisons: [], complete: false });
		} else {
			saveChosenCardIds(this.sessionId, cardIdsToConsider);
		}
	}

	private saveProgress(): void {
		saveSwipeProgress(this.sessionId, {
			shuffledCardIds: this._shuffledCards.value.map((c) => c.id),
			swipeHistory: this._swipeHistory.value,
		});
	}
}
