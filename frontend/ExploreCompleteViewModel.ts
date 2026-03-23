import { ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { capture } from "./analytics.ts";
import { hashStrings } from "./deterministic-hash.ts";
import { fetchSynthesis } from "./api.ts";
import { hasVisitedExploreComplete, isCardFullyExplored, isExplorePhaseComplete, loadChosenCardIds, loadExploreData, lookupCachedSynthesis, markExploreCompleteVisited, saveCachedSynthesis } from "./store.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

const WARM_PHRASES = ["Here's what you reflected on", "A look at what came up for you", "Your reflections, distilled", "What emerged from your exploration", "A snapshot of your thoughts"];

export class ExploreCompleteViewModel {
	private readonly sessionId: string;
	private readonly cardId: string;

	private readonly _card = ref<MeaningCard | undefined>(undefined);
	private readonly _chosenCardIds = ref<string[]>([]);
	private readonly _synthesis = ref("");
	private readonly _synthesisLoading = ref(false);
	private readonly _synthesisError = ref("");
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

	get synthesis(): string {
		return this._synthesis.value;
	}

	get synthesisLoading(): boolean {
		return this._synthesisLoading.value;
	}

	get synthesisError(): string {
		return this._synthesisError.value;
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

	get hasBeenVisited(): boolean {
		return hasVisitedExploreComplete(this.sessionId, this.cardId);
	}

	get isLoading(): boolean {
		return this._synthesisLoading.value;
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
		const answered = cardData.entries.filter((e) => e.submitted && e.userAnswer.trim() !== "" && questionOrder.has(e.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));

		const questions = answered.map((e) => ({ questionId: e.questionId, answer: e.userAnswer }));
		const fingerprintParts = answered.map((e) => e.userAnswer);
		if (cardData.freeformNote !== "") {
			fingerprintParts.push(cardData.freeformNote);
		}
		const fingerprint = fingerprintParts.join("\x00");

		this._loadingPromise = this.loadSynthesis(questions, cardData.freeformNote, cardData.statementSelections, fingerprint);

		capture("explore_complete_viewed", {
			session_id: this.sessionId,
			card_id: this.cardId,
			explored_count: explored,
			total_count: chosenCardIds.length,
			all_complete: this._allComplete.value,
		});

		return "ready";
	}

	retrySynthesis(): void {
		const exploreData = loadExploreData(this.sessionId);
		if (exploreData === null || !(this.cardId in exploreData)) return;
		const cardData = exploreData[this.cardId];

		const questionOrder = new Map(EXPLORE_QUESTIONS.map((q, i) => [q.id, i]));
		const answered = cardData.entries.filter((e) => e.submitted && e.userAnswer.trim() !== "" && questionOrder.has(e.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
		const questions = answered.map((e) => ({ questionId: e.questionId, answer: e.userAnswer }));
		const fingerprintParts = answered.map((e) => e.userAnswer);
		if (cardData.freeformNote !== "") {
			fingerprintParts.push(cardData.freeformNote);
		}
		const fingerprint = fingerprintParts.join("\x00");

		this._synthesisError.value = "";
		this._loadingPromise = this.loadSynthesis(questions, cardData.freeformNote, cardData.statementSelections, fingerprint);
	}

	onAnimationComplete(): void {
		markExploreCompleteVisited(this.sessionId, this.cardId);
	}

	private async loadSynthesis(questions: { questionId: string; answer: string }[], freeformNote: string, selectedStatements: string[], fingerprint: string): Promise<void> {
		const cached = lookupCachedSynthesis({ sessionId: this.sessionId, cardId: this.cardId, fingerprint });
		if (cached !== null) {
			this._synthesis.value = cached;
			return;
		}

		this._synthesisLoading.value = true;
		try {
			const result = await fetchSynthesis({
				cardId: this.cardId,
				questions,
				...(selectedStatements.length > 0 ? { selectedStatements } : {}),
				...(freeformNote !== "" ? { freeformNote } : {}),
			});
			this._synthesis.value = result.synthesis;
			saveCachedSynthesis({ sessionId: this.sessionId, cardId: this.cardId, fingerprint, synthesis: result.synthesis });
		} catch (error) {
			this._synthesisError.value = error instanceof Error ? error.message : "Failed to load synthesis.";
		} finally {
			this._synthesisLoading.value = false;
		}
	}
}
