import { ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { capture } from "./analytics.ts";
import { hashStrings } from "./deterministic-hash.ts";
import type { SummaryEntry, FreeformSummary } from "./ExploreViewModel.ts";
import { fetchOrGetCachedSummary, isCardFullyExplored, isExplorePhaseComplete, loadChosenCardIds, loadExploreData } from "./store.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));

const WARM_PHRASES = ["Here's what you reflected on", "A look at what came up for you", "Your reflections, distilled", "What emerged from your exploration", "A snapshot of your thoughts"];

export class ExploreCompleteViewModel {
	private readonly sessionId: string;
	private readonly cardId: string;

	private readonly _card = ref<MeaningCard | undefined>(undefined);
	private readonly _chosenCardIds = ref<string[]>([]);
	private readonly _summaryEntries = ref<SummaryEntry[]>([]);
	private readonly _freeformSummary = ref<FreeformSummary | null>(null);
	private readonly _allComplete = ref(false);
	private readonly _exploredCount = ref(0);
	private _loadingPromise: Promise<void> | null = null;

	constructor(sessionId: string, cardId: string) {
		this.sessionId = sessionId;
		this.cardId = cardId;
	}

	get card(): MeaningCard | undefined {
		return this._card.value;
	}

	get chosenCardIds(): string[] {
		return this._chosenCardIds.value;
	}

	get summaryEntries(): SummaryEntry[] {
		return this._summaryEntries.value;
	}

	get freeformSummary(): FreeformSummary | null {
		return this._freeformSummary.value;
	}

	get allComplete(): boolean {
		return this._allComplete.value;
	}

	get exploredCount(): number {
		return this._exploredCount.value;
	}

	get totalCount(): number {
		return this._chosenCardIds.value.length;
	}

	get warmPhrase(): string {
		return WARM_PHRASES[hashStrings(this.sessionId, this.cardId) % WARM_PHRASES.length];
	}

	get isLoading(): boolean {
		return this._summaryEntries.value.some((e) => e.loading) || (this._freeformSummary.value?.loading ?? false);
	}

	get whenReady(): Promise<void> {
		return this._loadingPromise ?? Promise.resolve();
	}

	initialize(): "ready" | "no-data" {
		const foundCard = cardsById.get(this.cardId);
		if (foundCard === undefined) {
			return "no-data";
		}

		const chosenCardIds = loadChosenCardIds(this.sessionId);
		if (chosenCardIds === null) {
			return "no-data";
		}

		const exploreData = loadExploreData(this.sessionId);
		if (exploreData === null) {
			return "no-data";
		}

		if (!(this.cardId in exploreData)) {
			return "no-data";
		}

		const cardData = exploreData[this.cardId];
		if (!isCardFullyExplored(cardData.entries)) {
			return "no-data";
		}

		this._card.value = foundCard;
		this._chosenCardIds.value = chosenCardIds;

		let explored = 0;
		for (const id of chosenCardIds) {
			if (!(id in exploreData)) continue;
			if (isCardFullyExplored(exploreData[id].entries)) {
				explored++;
			}
		}
		this._exploredCount.value = explored;

		this._allComplete.value = isExplorePhaseComplete(this.sessionId);

		const questionOrder = new Map(EXPLORE_QUESTIONS.map((q, i) => [q.id, i]));
		const answered = cardData.entries
			.filter((e) => e.submitted && e.userAnswer.trim() !== "")
			.map((e) => ({ entry: e, question: questionsById.get(e.questionId) }))
			.filter((v): v is { entry: (typeof cardData.entries)[number]; question: (typeof EXPLORE_QUESTIONS)[number] } => v.question !== undefined)
			.sort((a, b) => (questionOrder.get(a.entry.questionId) ?? 0) - (questionOrder.get(b.entry.questionId) ?? 0));

		const summaryRows: SummaryEntry[] = answered.map((v) => ({
			questionId: v.entry.questionId,
			topic: v.question.topic,
			summary: "",
			loading: false,
			error: "",
			unanswered: false,
		}));
		this._summaryEntries.value = summaryRows;

		const promises: Promise<void>[] = [];
		for (const v of answered) {
			promises.push(this.loadSummary(v.entry.questionId, v.entry.userAnswer));
		}

		if (cardData.freeformNote !== "") {
			const freeformEntry: FreeformSummary = { summary: "", loading: false, error: "" };
			this._freeformSummary.value = freeformEntry;
			promises.push(this.loadFreeformSummary(cardData.freeformNote, freeformEntry));
		}

		if (promises.length > 0) {
			this._loadingPromise = Promise.all(promises).then(() => undefined);
		}

		capture("explore_complete_viewed", {
			session_id: this.sessionId,
			card_id: this.cardId,
			explored_count: explored,
			total_count: chosenCardIds.length,
			all_complete: this._allComplete.value,
		});

		return "ready";
	}

	private async loadSummary(questionId: string, answer: string): Promise<void> {
		const entry = this._summaryEntries.value.find((e) => e.questionId === questionId);
		if (entry === undefined) return;

		entry.loading = true;
		try {
			entry.summary = await fetchOrGetCachedSummary({ sessionId: this.sessionId, cardId: this.cardId, answer, questionId });
		} catch (error) {
			entry.error = error instanceof Error ? error.message : "Failed to load summary.";
		} finally {
			entry.loading = false;
		}
	}

	private async loadFreeformSummary(noteText: string, entry: FreeformSummary): Promise<void> {
		entry.loading = true;
		try {
			entry.summary = await fetchOrGetCachedSummary({ sessionId: this.sessionId, cardId: this.cardId, answer: noteText });
		} catch (error) {
			entry.error = error instanceof Error ? error.message : "Failed to load summary.";
		} finally {
			entry.loading = false;
		}
	}
}
