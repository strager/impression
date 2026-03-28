import { ref } from "vue";

import type { CardReport, QuestionReport } from "../shared/report-types.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { MEANING_DESCRIPTIONS } from "../shared/meaning-descriptions.ts";
import { capture } from "./analytics.ts";
import { fetchSynthesis } from "./api.ts";
import { loadChosenCardIds, loadExploreData, lookupCachedSynthesis, saveCachedSynthesis } from "./store.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
const descriptionTextById = new Map(MEANING_DESCRIPTIONS.map((d) => [d.id, d.text]));
const questionOrder = new Map(EXPLORE_QUESTIONS.map((q, i) => [q.id, i]));

export class ReportViewModel {
	private readonly sessionId: string;

	private readonly _reports = ref<CardReport[]>([]);
	private readonly _loading = ref(true);
	private _loadingPromise: Promise<void> | null = null;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	get reports(): CardReport[] {
		return this._reports.value;
	}

	get loading(): boolean {
		return this._loading.value;
	}

	get whenReady(): Promise<void> {
		return this._loadingPromise ?? Promise.resolve();
	}

	async retrySynthesis(cardId: string): Promise<void> {
		const report = this._reports.value.find((r) => r.card.id === cardId);
		if (report === undefined) return;

		const exploreData = loadExploreData(this.sessionId) ?? {};
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

		report.synthesisError = false;
		this._reports.value = [...this._reports.value];

		try {
			const result = await fetchSynthesis({
				cardId,
				questions: questionsForApi,
				...(selectedIds.length > 0 ? { selectedDescriptions: selectedIds } : {}),
				...(freeformNote !== "" ? { freeformNote } : {}),
			});
			report.synthesis = result.synthesis;
			saveCachedSynthesis({ sessionId: this.sessionId, cardId, fingerprint, synthesis: result.synthesis });
		} catch {
			report.synthesisError = true;
		}
		this._reports.value = [...this._reports.value];
	}

	initialize(): "ready" | "no-data" {
		const cardIds = loadChosenCardIds(this.sessionId);
		if (cardIds === null) {
			return "no-data";
		}

		const exploreData = loadExploreData(this.sessionId) ?? {};

		const reports: CardReport[] = [];
		const fetchTasks: Promise<void>[] = [];

		for (const cardId of cardIds) {
			const card = cardsById.get(cardId);
			if (card === undefined) continue;

			const hasCardData = cardId in exploreData;
			const entries = hasCardData ? exploreData[cardId].entries : [];
			const answersByQuestionId = new Map(entries.map((e) => [e.questionId, e.userAnswer]));
			const questions: QuestionReport[] = [];

			for (const question of EXPLORE_QUESTIONS) {
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

			// Build fingerprint for synthesis cache lookup (same algorithm as ExploreCompleteViewModel)
			const answered = entries.filter((e) => e.submitted && e.userAnswer.trim() !== "" && questionOrder.has(e.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
			const fingerprintParts = answered.map((e) => e.userAnswer);
			if (freeformNote !== "") {
				fingerprintParts.push(freeformNote);
			}
			const fingerprint = fingerprintParts.join("\x00");

			const cachedSynthesis = lookupCachedSynthesis({ sessionId: this.sessionId, cardId, fingerprint });

			const needsFetch = cachedSynthesis === null && answered.length > 0;
			const report: CardReport = { card, questions, selectedDescriptions, freeformNote, synthesis: cachedSynthesis ?? "", synthesisLoading: needsFetch };
			reports.push(report);

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
							report.synthesis = result.synthesis;
							saveCachedSynthesis({ sessionId: this.sessionId, cardId, fingerprint, synthesis: result.synthesis });
						})
						.catch(() => {
							report.synthesisError = true;
						}),
				);
			}
		}

		this._reports.value = reports;

		if (fetchTasks.length > 0) {
			this._loadingPromise = Promise.allSettled(fetchTasks).then(() => {
				for (const r of reports) {
					r.synthesisLoading = false;
				}
				this._reports.value = [...reports];
				this._loading.value = false;
			});
		} else {
			this._loading.value = false;
		}

		capture("report_viewed", { session_id: this.sessionId });
		return "ready";
	}
}
