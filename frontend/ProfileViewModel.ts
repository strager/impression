import { ref } from "vue";

import type { CardProfile, QuestionProfile } from "../shared/profile-types.ts";
import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { MEANING_EXPRESSIONS } from "../shared/meaning-expressions.ts";
import { capture } from "./analytics.ts";
import { fetchSynthesis } from "./api.ts";
import { loadChosenCardIds, loadExamineData, lookupCachedSynthesis, saveCachedSynthesis } from "./store.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
const descriptionTextById = new Map(MEANING_EXPRESSIONS.map((d) => [d.id, d.text]));
const questionOrder = new Map(EXAMINE_QUESTIONS.map((q, i) => [q.id, i]));

export class ProfileViewModel {
	private readonly profileId: string;

	private readonly _cards = ref<CardProfile[]>([]);
	private readonly _loading = ref(true);
	private _loadingPromise: Promise<void> | null = null;

	constructor(profileId: string) {
		this.profileId = profileId;
	}

	get cards(): CardProfile[] {
		return this._cards.value;
	}

	get loading(): boolean {
		return this._loading.value;
	}

	get whenReady(): Promise<void> {
		return this._loadingPromise ?? Promise.resolve();
	}

	async retrySynthesis(cardId: string): Promise<void> {
		const entry = this._cards.value.find((r) => r.card.id === cardId);
		if (entry === undefined) return;

		const exploreData = loadExamineData(this.profileId) ?? {};
		if (!(cardId in exploreData)) return;

		const entries = exploreData[cardId].entries;
		const freeformNote = exploreData[cardId].freeformNote;
		const selectedIds = exploreData[cardId].descriptionSelections;

		const answered = entries.filter((e) => e.submitted && e.userAnswer.trim() !== "" && questionOrder.has(e.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
		if (answered.length === 0) return;

		const questionsForApi = answered.map((e) => ({ questionId: e.questionId, answer: e.userAnswer }));
		const fingerprintParts = answered.map((e) => e.userAnswer);
		if (freeformNote !== "") {
			fingerprintParts.push(freeformNote);
		}
		const fingerprint = fingerprintParts.join("\x00");

		entry.synthesisError = false;
		this._cards.value = [...this._cards.value];

		try {
			const result = await fetchSynthesis({
				cardId,
				questions: questionsForApi,
				...(selectedIds.length > 0 ? { selectedDescriptions: selectedIds } : {}),
				...(freeformNote !== "" ? { freeformNote } : {}),
			});
			entry.synthesis = result.synthesis;
			saveCachedSynthesis({ profileId: this.profileId, cardId, fingerprint, synthesis: result.synthesis });
		} catch {
			entry.synthesisError = true;
		}
		this._cards.value = [...this._cards.value];
	}

	initialize(): "ready" | "no-data" {
		const cardIds = loadChosenCardIds(this.profileId);
		if (cardIds === null) {
			return "no-data";
		}

		const exploreData = loadExamineData(this.profileId) ?? {};

		const cards: CardProfile[] = [];
		const fetchTasks: Promise<void>[] = [];

		for (const cardId of cardIds) {
			const card = cardsById.get(cardId);
			if (card === undefined) continue;

			const hasCardData = cardId in exploreData;
			const entries = hasCardData ? exploreData[cardId].entries : [];
			const answersByQuestionId = new Map(entries.map((e) => [e.questionId, e.userAnswer]));
			const questions: QuestionProfile[] = [];

			for (const question of EXAMINE_QUESTIONS) {
				const answer = answersByQuestionId.get(question.id) ?? "";

				questions.push({
					topic: question.topic,
					question: question.questionFirstPerson,
					answer,
				});
			}

			const freeformNote = hasCardData ? exploreData[cardId].freeformNote : "";

			const selectedIds = hasCardData ? exploreData[cardId].descriptionSelections : [];
			const selectedDescriptions = selectedIds.map((id) => descriptionTextById.get(id)).filter((text): text is string => text !== undefined);

			// Build fingerprint for synthesis cache lookup (same algorithm as ExamineReflectViewModel)
			const answered = entries.filter((e) => e.submitted && e.userAnswer.trim() !== "" && questionOrder.has(e.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
			const fingerprintParts = answered.map((e) => e.userAnswer);
			if (freeformNote !== "") {
				fingerprintParts.push(freeformNote);
			}
			const fingerprint = fingerprintParts.join("\x00");

			const cachedSynthesis = lookupCachedSynthesis({ profileId: this.profileId, cardId, fingerprint });

			const needsFetch = cachedSynthesis === null && answered.length > 0;
			const cardProfile: CardProfile = { card, questions, selectedDescriptions, freeformNote, synthesis: cachedSynthesis ?? "", synthesisLoading: needsFetch };
			cards.push(cardProfile);

			// If no cached synthesis and there are answered questions, fetch from API
			if (needsFetch) {
				const questionsForApi = answered.map((e) => ({ questionId: e.questionId, answer: e.userAnswer }));
				fetchTasks.push(
					fetchSynthesis({
						cardId,
						questions: questionsForApi,
						...(selectedIds.length > 0 ? { selectedDescriptions: selectedIds } : {}),
						...(freeformNote !== "" ? { freeformNote } : {}),
					})
						.then((result) => {
							cardProfile.synthesis = result.synthesis;
							saveCachedSynthesis({ profileId: this.profileId, cardId, fingerprint, synthesis: result.synthesis });
						})
						.catch(() => {
							cardProfile.synthesisError = true;
						}),
				);
			}
		}

		this._cards.value = cards;

		if (fetchTasks.length > 0) {
			this._loadingPromise = Promise.allSettled(fetchTasks).then(() => {
				for (const r of cards) {
					r.synthesisLoading = false;
				}
				this._cards.value = [...cards];
				this._loading.value = false;
			});
		} else {
			this._loading.value = false;
		}

		capture("profile_viewed", { session_id: this.profileId });
		return "ready";
	}
}
