import { ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { capture } from "./analytics.ts";
import type { ExploreEntry } from "./store.ts";
import { fetchOrGetCachedSummary, loadChosenCardIds, loadExploreData, saveExploreData } from "./store.ts";

export interface SummaryEntry {
	questionId: string;
	topic: string;
	summary: string;
	loading: boolean;
	error: string;
	unanswered: boolean;
}

export interface FreeformSummary {
	summary: string;
	loading: boolean;
	error: string;
}

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));

export class ExploreViewModel {
	private readonly sessionId: string;
	private readonly _chosenCards = ref<MeaningCard[]>([]);
	private readonly _cardAnswerCounts = ref<Record<string, number>>({});
	private readonly _cardSummaryEntries = ref<Partial<Record<string, SummaryEntry[]>>>({});
	private readonly _cardFreeformSummary = ref<Partial<Record<string, FreeformSummary>>>({});
	private _loadingPromise: Promise<void> | null = null;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	get chosenCards(): MeaningCard[] {
		return this._chosenCards.value;
	}

	get cardAnswerCounts(): Record<string, number> {
		return this._cardAnswerCounts.value;
	}

	get cardSummaryEntries(): Partial<Record<string, SummaryEntry[]>> {
		return this._cardSummaryEntries.value;
	}

	get cardFreeformSummary(): Partial<Record<string, FreeformSummary>> {
		return this._cardFreeformSummary.value;
	}

	get totalQuestions(): number {
		return this._chosenCards.value.length * EXPLORE_QUESTIONS.length;
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
		const count = this._cardAnswerCounts.value[cardId] ?? 0;
		if (count === 0) return "untouched";
		if (count >= EXPLORE_QUESTIONS.length) return "complete";
		return "partial";
	}

	onExploreCard(cardId: string): void {
		const answered = this._cardAnswerCounts.value[cardId] ?? 0;
		capture("card_exploration_started", {
			session_id: this.sessionId,
			card_id: cardId,
			question_number: Math.min(answered + 1, EXPLORE_QUESTIONS.length),
		});
	}

	onEditSelection(): void {
		capture("edit_selection_clicked", { session_id: this.sessionId });
	}

	onOpenReport(source: string): void {
		capture("report_opened", {
			session_id: this.sessionId,
			source,
		});
	}

	initialize(): "ready" | "no-data" {
		try {
			const cardIds = loadChosenCardIds(this.sessionId);
			if (cardIds === null) {
				return "no-data";
			}
			const chosenSet = new Set(cardIds);
			this._chosenCards.value = MEANING_CARDS.filter((c) => chosenSet.has(c.id));

			let exploreData = loadExploreData(this.sessionId);
			if (exploreData === null) {
				exploreData = {};
				saveExploreData(this.sessionId, exploreData);
			}
			const promises: Promise<void>[] = [];

			for (const [cardId, cardData] of Object.entries(exploreData)) {
				const entries = cardData.entries;
				const answered = entries.filter((e) => e.userAnswer !== "");
				this._cardAnswerCounts.value[cardId] = answered.length;
				if (answered.length === 0) continue;

				const card = cardsById.get(cardId);
				if (card === undefined) continue;

				const isPartial = answered.length < EXPLORE_QUESTIONS.length;
				const answeredIds = new Set(answered.map((e) => e.questionId));

				const questionOrder = new Map(EXPLORE_QUESTIONS.map((q, i) => [q.id, i]));
				const validEntries = answered
					.map((e) => ({ entry: e, question: questionsById.get(e.questionId) }))
					.filter((v): v is { entry: ExploreEntry; question: (typeof EXPLORE_QUESTIONS)[number] } => v.question !== undefined)
					.sort((a, b) => (questionOrder.get(a.entry.questionId) ?? 0) - (questionOrder.get(b.entry.questionId) ?? 0));

				const summaryRows: SummaryEntry[] = validEntries.map((v) => ({
					questionId: v.entry.questionId,
					topic: v.question.topic,
					summary: "",
					loading: false,
					error: "",
					unanswered: false,
				}));

				if (isPartial) {
					for (const q of EXPLORE_QUESTIONS) {
						if (!answeredIds.has(q.id)) {
							summaryRows.push({
								questionId: q.id,
								topic: q.topic,
								summary: "",
								loading: false,
								error: "",
								unanswered: true,
							});
						}
					}
				}

				this._cardSummaryEntries.value[cardId] = summaryRows;

				for (const v of validEntries) {
					promises.push(this.loadSummary(cardId, v.entry.questionId, v.entry.userAnswer));
				}
			}

			for (const [cardId, cardData] of Object.entries(exploreData)) {
				const noteText = cardData.freeformNote;
				if (noteText === "") continue;

				const freeformEntry: FreeformSummary = { summary: "", loading: false, error: "" };
				this._cardFreeformSummary.value[cardId] = freeformEntry;

				promises.push(this.loadFreeformSummary(cardId, noteText, freeformEntry));
			}

			if (promises.length > 0) {
				this._loadingPromise = Promise.all(promises).then(() => undefined);
			}
			capture("explore_overview_visited", { session_id: this.sessionId });
			return "ready";
		} catch {
			return "no-data";
		}
	}

	private async loadSummary(cardId: string, questionId: string, answer: string): Promise<void> {
		const entry = this._cardSummaryEntries.value[cardId]?.find((e) => e.questionId === questionId);
		if (entry === undefined) return;

		entry.loading = true;
		try {
			entry.summary = await fetchOrGetCachedSummary({ sessionId: this.sessionId, cardId, answer, questionId });
		} catch (error) {
			entry.error = error instanceof Error ? error.message : "Failed to load summary.";
		} finally {
			entry.loading = false;
		}
	}

	private async loadFreeformSummary(cardId: string, noteText: string, entry: FreeformSummary): Promise<void> {
		entry.loading = true;
		try {
			entry.summary = await fetchOrGetCachedSummary({ sessionId: this.sessionId, cardId, answer: noteText });
		} catch (error) {
			entry.error = error instanceof Error ? error.message : "Failed to load summary.";
		} finally {
			entry.loading = false;
		}
	}
}
