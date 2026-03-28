import { ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import { capture } from "./analytics.ts";
import { fetchSynthesis } from "./api.ts";
import { isCardFullyExamined, loadChosenCardIds, loadExamineData, lookupCachedSynthesis, saveCachedSynthesis, saveExamineData } from "./store.ts";
import type { CardExamineData } from "./store.ts";

export function parseBullets(text: string): string[] | null {
	const bullets = text
		.split("\n")
		.filter((l) => l.trimStart().startsWith("- "))
		.map((l) => l.trimStart().slice(2).trim())
		.filter((l) => l !== "");
	return bullets.length > 0 ? bullets : null;
}

interface CardSynthesisState {
	text: string;
	loading: boolean;
	error: string;
}

const questionsById = new Map(EXAMINE_QUESTIONS.map((q) => [q.id, q]));

export class ExamineViewModel {
	private readonly profileId: string;
	private readonly _chosenCards = ref<MeaningCard[]>([]);
	private readonly _cardAnswerCounts = ref<Record<string, number>>({});
	private readonly _cardSynthesis = ref<Partial<Record<string, CardSynthesisState>>>({});
	private _loadingPromise: Promise<void> | null = null;

	constructor(profileId: string) {
		this.profileId = profileId;
	}

	get chosenCards(): MeaningCard[] {
		return this._chosenCards.value;
	}

	get cardAnswerCounts(): Record<string, number> {
		return this._cardAnswerCounts.value;
	}

	get cardSynthesis(): Partial<Record<string, CardSynthesisState>> {
		return this._cardSynthesis.value;
	}

	get totalQuestions(): number {
		return this._chosenCards.value.length * EXAMINE_QUESTIONS.length;
	}

	get totalAnswered(): number {
		return Object.values(this._cardAnswerCounts.value).reduce((sum, n) => sum + n, 0);
	}

	get overallPercent(): number {
		return this.totalQuestions === 0 ? 0 : Math.round((this.totalAnswered / this.totalQuestions) * 100);
	}

	get allComplete(): boolean {
		return this.totalQuestions > 0 && this.totalAnswered >= this.totalQuestions;
	}

	get sortedCards(): MeaningCard[] {
		return [...this._chosenCards.value].sort((a, b) => {
			const aComplete = this.cardStatus(a.id) === "complete" ? 1 : 0;
			const bComplete = this.cardStatus(b.id) === "complete" ? 1 : 0;
			return aComplete - bComplete;
		});
	}

	get whenReady(): Promise<void> {
		return this._loadingPromise ?? Promise.resolve();
	}

	cardStatus(cardId: string): "untouched" | "partial" | "complete" {
		const examineData = loadExamineData(this.profileId);
		if (examineData !== null && cardId in examineData && isCardFullyExamined(examineData[cardId].entries)) {
			return "complete";
		}
		const count = this._cardAnswerCounts.value[cardId] ?? 0;
		if (count === 0) return "untouched";
		return "partial";
	}

	onExamineCard(cardId: string): void {
		const answered = this._cardAnswerCounts.value[cardId] ?? 0;
		capture("card_examination_started", {
			session_id: this.profileId,
			card_id: cardId,
			question_number: Math.min(answered + 1, EXAMINE_QUESTIONS.length),
		});
	}

	onEditSelection(): void {
		capture("reconsider_clicked", { session_id: this.profileId });
	}

	onOpenProfile(source: string): void {
		capture("profile_opened", {
			session_id: this.profileId,
			source,
		});
	}

	initialize(): "ready" | "no-data" {
		try {
			const cardIds = loadChosenCardIds(this.profileId);
			if (cardIds === null) {
				return "no-data";
			}
			const chosenSet = new Set(cardIds);
			this._chosenCards.value = MEANING_CARDS.filter((c) => chosenSet.has(c.id));

			let examineData = loadExamineData(this.profileId);
			if (examineData === null) {
				examineData = {};
				saveExamineData(this.profileId, examineData);
			}
			const promises: Promise<void>[] = [];

			for (const [cardId, cardData] of Object.entries(examineData)) {
				const entries = cardData.entries;
				const answered = entries.filter((e) => e.userAnswer !== "" && !e.autoFilledPending);
				this._cardAnswerCounts.value[cardId] = answered.length;
				if (answered.length === 0) continue;

				promises.push(this.loadCardSynthesis(cardId, cardData));
			}

			if (promises.length > 0) {
				this._loadingPromise = Promise.all(promises).then(() => undefined);
			}
			capture("examine_overview_visited", { session_id: this.profileId });
			return "ready";
		} catch {
			return "no-data";
		}
	}

	retrySynthesis(cardId: string): void {
		const examineData = loadExamineData(this.profileId);
		if (examineData === null || !(cardId in examineData)) return;
		this._loadingPromise = this.loadCardSynthesis(cardId, examineData[cardId]);
	}

	private async loadCardSynthesis(cardId: string, cardData: CardExamineData): Promise<void> {
		const questionOrder = new Map(EXAMINE_QUESTIONS.map((q, i) => [q.id, i]));
		const answered = cardData.entries.filter((e) => e.submitted && e.userAnswer.trim() !== "" && questionsById.has(e.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));

		if (answered.length === 0) return;

		const questions = answered.map((e) => ({ questionId: e.questionId, answer: e.userAnswer }));
		const fingerprintParts = answered.map((e) => e.userAnswer);
		if (cardData.freeformNote !== "") {
			fingerprintParts.push(cardData.freeformNote);
		}
		const fingerprint = fingerprintParts.join("\x00");

		this._cardSynthesis.value[cardId] = { text: "", loading: true, error: "" };

		const cached = lookupCachedSynthesis({ profileId: this.profileId, cardId, fingerprint, short: true });
		if (cached !== null) {
			this._cardSynthesis.value[cardId] = { text: cached, loading: false, error: "" };
			return;
		}

		try {
			const result = await fetchSynthesis({
				cardId,
				questions,
				...(cardData.descriptionSelections.length > 0 ? { selectedDescriptions: cardData.descriptionSelections } : {}),
				...(cardData.freeformNote !== "" ? { freeformNote: cardData.freeformNote } : {}),
				short: true,
			});
			this._cardSynthesis.value[cardId] = { text: result.synthesis, loading: false, error: "" };
			saveCachedSynthesis({ profileId: this.profileId, cardId, fingerprint, synthesis: result.synthesis, short: true });
		} catch (error) {
			this._cardSynthesis.value[cardId] = { text: "", loading: false, error: error instanceof Error ? error.message : "Failed to load synthesis." };
		}
	}
}
