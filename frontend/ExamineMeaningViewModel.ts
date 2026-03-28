import { ref } from "vue";

import { fetchReflectOnAnswer, fetchInferredAnswers } from "./api.ts";
import type { ReflectOnAnswerResponse } from "./api.ts";
import { capture } from "./analytics.ts";
import type { ExamineEntry } from "./store.ts";
import { isCardFullyExamined, isExaminePhaseComplete, loadExamineData, requestStoragePersistence, saveExamineData, selectNextQuestion } from "./store.ts";
import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import type { MeaningCard } from "../shared/meaning-cards.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { MEANING_DESCRIPTIONS } from "../shared/meaning-descriptions.ts";

const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

const EXAMINE_PHASE_TRACK_KEY_PREFIX = "somecam-examine-phase-complete";

export class ExamineMeaningViewModel {
	private readonly profileId: string;
	private readonly cardId: string;

	private readonly _card = ref<MeaningCard | undefined>(undefined);
	private readonly _entries = ref<ExamineEntry[]>([]);
	private readonly _inferring = ref(false);
	private readonly _awaitingReflection = ref(false);
	private readonly _pendingInferResult = ref<Map<string, string> | null>(null);
	private readonly _freeformNote = ref("");
	private readonly _selectedDescriptionIds = ref<Set<string>>(new Set());
	private readonly _descriptionsConfirmed = ref(false);
	private readonly _questionStartTimeMs = ref(performance.now());
	private readonly _submittedAnswerSnapshots = ref<Map<string, string>>(new Map());
	private readonly _editedAfterSubmit = ref<Set<string>>(new Set());
	private readonly _manualReflectLoading = ref<Set<string>>(new Set());
	private readonly _manualReflectResult = ref<Map<string, ReflectOnAnswerResponse>>(new Map());

	constructor(profileId: string, cardId: string) {
		this.profileId = profileId;
		this.cardId = cardId;
	}

	// --- Public getters ---

	get card(): MeaningCard | undefined {
		return this._card.value;
	}

	get entries(): ExamineEntry[] {
		return this._entries.value;
	}

	get inferring(): boolean {
		return this._inferring.value;
	}

	get awaitingReflection(): boolean {
		return this._awaitingReflection.value;
	}

	get freeformNote(): string {
		return this._freeformNote.value;
	}

	set freeformNote(value: string) {
		this._freeformNote.value = value;
	}

	get selectedDescriptionIds(): Set<string> {
		return this._selectedDescriptionIds.value;
	}

	get descriptionsConfirmed(): boolean {
		return this._descriptionsConfirmed.value;
	}

	get manualReflectLoading(): Set<string> {
		return this._manualReflectLoading.value;
	}

	get manualReflectResult(): Map<string, ReflectOnAnswerResponse> {
		return this._manualReflectResult.value;
	}

	// --- Computed getters ---

	get activeIndex(): number {
		const idx = this._entries.value.findIndex((e) => !e.submitted);
		return idx === -1 ? this._entries.value.length : idx;
	}

	get editingEntryIndex(): number {
		const lastIdx = this._entries.value.length - 1;
		if (lastIdx < 0) return -1;
		const last = this._entries.value[lastIdx];
		if (!last.submitted) return lastIdx;
		if (last.guardrailText !== "" && !last.submittedAfterGuardrail) return lastIdx;
		if (last.thoughtBubbleText !== "" && !last.thoughtBubbleAcknowledged) return lastIdx;
		return -1;
	}

	get allAnswered(): boolean {
		return isCardFullyExamined(this._entries.value);
	}

	get submittedCount(): number {
		return this._entries.value.filter((e) => e.submitted).length;
	}

	get cardDescriptions(): (typeof MEANING_DESCRIPTIONS)[number][] {
		return MEANING_DESCRIPTIONS.filter((d) => d.meaningId === this.cardId);
	}

	// --- Public methods ---

	initialize(): "ready" | "no-data" {
		const foundCard = cardsById.get(this.cardId);
		if (foundCard === undefined) {
			return "no-data";
		}

		try {
			const data = loadExamineData(this.profileId) ?? {};
			if (!(this.cardId in data) || data[this.cardId].entries.length === 0) {
				if (!(this.cardId in data)) {
					data[this.cardId] = { entries: [], freeformNote: "", descriptionSelections: [] };
				}
				const allQuestionIds = EXAMINE_QUESTIONS.map((q) => q.id);
				const questionId = selectNextQuestion(allQuestionIds, []);
				data[this.cardId].entries.push({
					questionId,
					userAnswer: "",
					prefilledAnswer: "",
					submitted: false,
					guardrailText: "",
					submittedAfterGuardrail: false,
					thoughtBubbleText: "",
					thoughtBubbleAcknowledged: false,
					autoFilledPending: false,
				});
				saveExamineData(this.profileId, data);
			}
			const cardData = data[this.cardId];

			this._card.value = foundCard;
			this._entries.value = cardData.entries;
			this._freeformNote.value = cardData.freeformNote;
			if (cardData.descriptionSelections.length > 0) {
				this._selectedDescriptionIds.value = new Set(cardData.descriptionSelections);
				this._descriptionsConfirmed.value = true;
			}
			this._submittedAnswerSnapshots.value = new Map(this._entries.value.filter((entry) => entry.submitted).map((entry) => [entry.questionId, entry.userAnswer]));

			const lastEntry = this._entries.value[this._entries.value.length - 1];
			if (lastEntry.submitted) {
				if (lastEntry.guardrailText !== "" && !lastEntry.submittedAfterGuardrail) {
					this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [lastEntry.questionId, { type: "guardrail", message: lastEntry.guardrailText }]]);
					return "ready";
				}
				if (lastEntry.thoughtBubbleText !== "" && !lastEntry.thoughtBubbleAcknowledged) {
					this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [lastEntry.questionId, { type: "thought_bubble", message: lastEntry.thoughtBubbleText }]]);
					return "ready";
				}
				if (this._entries.value.length < EXAMINE_QUESTIONS.length) {
					void this.inferAndAdvance();
				}
			} else {
				const idx = this.activeIndex;
				if (idx < this._entries.value.length) {
					this.markQuestionStartNow();
				}
			}

			return "ready";
		} catch {
			return "no-data";
		}
	}

	async submitAnswer(): Promise<void> {
		if (this._awaitingReflection.value) return;

		if (this.hasBlockingReflection()) {
			const lastIdx = this._entries.value.length - 1;
			if (lastIdx < 0) return;
			const entry = this._entries.value[lastIdx];
			const wasGuardrail = entry.guardrailText !== "" && !entry.submittedAfterGuardrail;
			const wasEdited = this._editedAfterSubmit.value.has(entry.questionId);

			this.acceptReflection();
			this.persistEntries();

			const mrNext = new Map(this._manualReflectResult.value);
			mrNext.delete(entry.questionId);
			this._manualReflectResult.value = mrNext;

			if (wasGuardrail && wasEdited) {
				this._manualReflectLoading.value = new Set([...this._manualReflectLoading.value, entry.questionId]);
				this._awaitingReflection.value = true;
				let secondResult: ReflectOnAnswerResponse | null = null;
				try {
					secondResult = await fetchReflectOnAnswer({
						cardId: this.cardId,
						questionId: entry.questionId,
						answer: entry.userAnswer,
						suppressGuardrail: true,
					});
				} catch {
					// fail open
				} finally {
					this._awaitingReflection.value = false;
					const loadingNext = new Set(this._manualReflectLoading.value);
					loadingNext.delete(entry.questionId);
					this._manualReflectLoading.value = loadingNext;
				}

				if (secondResult !== null && secondResult.type === "thought_bubble" && secondResult.message !== "") {
					entry.thoughtBubbleText = secondResult.message;
					entry.thoughtBubbleAcknowledged = false;
					this.persistEntries();
					this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [entry.questionId, { type: "thought_bubble", message: secondResult.message }]]);
					capture("thought_bubble_shown", {
						session_id: this.profileId,
						card_id: this.cardId,
						question_id: entry.questionId,
					});
					return;
				}
			}

			this.applyInferAndAdvance(this._pendingInferResult.value ?? new Map<string, string>(), this.remainingQuestionIds());
			this._pendingInferResult.value = null;

			return;
		}

		const idx = this.activeIndex;
		if (idx >= this._entries.value.length) return;

		const answerText = this._entries.value[idx].userAnswer.trim();
		if (answerText === "") return;

		const questionId = this._entries.value[idx].questionId;
		const source = this.answerSource(this._entries.value[idx], answerText);
		capture("question_answered", {
			session_id: this.profileId,
			card_id: this.cardId,
			question_id: questionId,
			answer_length: answerText.length,
			time_spent_ms: Math.round(performance.now() - this._questionStartTimeMs.value),
			source,
		});
		if (source === "inferred-accepted") {
			capture("inferred_answer_accepted", {
				session_id: this.profileId,
				card_id: this.cardId,
				question_id: questionId,
			});
		} else if (source === "inferred-edited") {
			capture("inferred_answer_edited", {
				session_id: this.profileId,
				card_id: this.cardId,
				question_id: questionId,
			});
		}

		this._entries.value[idx].userAnswer = answerText;
		this._entries.value[idx].submitted = true;
		this._entries.value[idx].autoFilledPending = false;
		this.trackSubmittedSnapshot(questionId, answerText);
		this.persistEntries();

		requestStoragePersistence(this.profileId);

		const remaining = this.remainingQuestionIds();

		const questions = [...this._entries.value.filter((e) => e.submitted).map((e) => ({ questionId: e.questionId, answer: e.userAnswer })), ...remaining.map((qId) => ({ questionId: qId, answer: "" }))];

		const inferPromise =
			remaining.length > 0
				? fetchInferredAnswers({ cardId: this.cardId, questions })
						.then((r) => new Map(r.inferredAnswers.map((ia) => [ia.questionId, ia.answer])))
						.catch(() => new Map<string, string>())
				: Promise.resolve(new Map<string, string>());

		this._inferring.value = remaining.length > 0;

		this._manualReflectLoading.value = new Set([...this._manualReflectLoading.value, questionId]);
		this._awaitingReflection.value = true;
		const reflectResult = await fetchReflectOnAnswer({
			cardId: this.cardId,
			questionId,
			answer: answerText,
		})
			.catch((): ReflectOnAnswerResponse => ({ type: "none", message: "" }))
			.finally(() => {
				this._awaitingReflection.value = false;
				const loadingNext = new Set(this._manualReflectLoading.value);
				loadingNext.delete(questionId);
				this._manualReflectLoading.value = loadingNext;
			});
		capture("reflect_on_answer_triggered", {
			session_id: this.profileId,
			card_id: this.cardId,
			question_id: questionId,
			result_type: reflectResult.type,
			is_second_call: false,
		});

		if (reflectResult.type === "guardrail" && reflectResult.message !== "") {
			this._inferring.value = false;
			this._pendingInferResult.value = null;
			this._entries.value[idx].guardrailText = reflectResult.message;
			this.persistEntries();
			capture("guardrail_shown", {
				session_id: this.profileId,
				card_id: this.cardId,
				question_id: questionId,
			});
			this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [questionId, { type: "guardrail", message: reflectResult.message }]]);
			void inferPromise.then((result) => {
				this._pendingInferResult.value = result;
			});
			return;
		}

		if (reflectResult.type === "thought_bubble" && reflectResult.message !== "") {
			this._inferring.value = false;
			this._pendingInferResult.value = null;
			this._entries.value[idx].thoughtBubbleText = reflectResult.message;
			this._entries.value[idx].thoughtBubbleAcknowledged = false;
			this.persistEntries();
			capture("thought_bubble_shown", {
				session_id: this.profileId,
				card_id: this.cardId,
				question_id: questionId,
			});
			this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [questionId, { type: "thought_bubble", message: reflectResult.message }]]);
			void inferPromise.then((result) => {
				this._pendingInferResult.value = result;
			});
			return;
		}

		const inferResult = await inferPromise;
		this._inferring.value = false;

		this.applyInferAndAdvance(inferResult, remaining);
	}

	onActiveEntryInput(entry: ExamineEntry): void {
		const snapshot = this._submittedAnswerSnapshots.value.get(entry.questionId);
		if (snapshot !== undefined && snapshot !== entry.userAnswer) {
			this._editedAfterSubmit.value.add(entry.questionId);
		}
	}

	acceptAutoFill(entry: ExamineEntry): void {
		entry.userAnswer = entry.prefilledAnswer;
		entry.autoFilledPending = false;
		this.persistEntries();
	}

	clearAutoFill(entry: ExamineEntry): void {
		entry.userAnswer = "";
		entry.autoFilledPending = false;
		this.persistEntries();
	}

	onAnsweredEntryInput(entry: ExamineEntry): void {
		const snapshot = this._submittedAnswerSnapshots.value.get(entry.questionId);
		if (snapshot !== undefined && snapshot !== entry.userAnswer) {
			this._editedAfterSubmit.value.add(entry.questionId);
		}
	}

	onAnsweredEntryBlur(entry: ExamineEntry): void {
		this.persistEntries();
		if (!this._editedAfterSubmit.value.has(entry.questionId)) {
			return;
		}
		capture("answer_edited_after_submit", {
			session_id: this.profileId,
			card_id: this.cardId,
			question_id: entry.questionId,
			answer_length: entry.userAnswer.trim().length,
		});
		this.trackSubmittedSnapshot(entry.questionId, entry.userAnswer);
	}

	async reflectOnEntry(questionId: string): Promise<void> {
		if (this._manualReflectLoading.value.has(questionId)) return;

		const entry = this._entries.value.find((e) => e.questionId === questionId);
		if (entry === undefined) return;

		if (entry.userAnswer.trim() === "") {
			this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [questionId, { type: "guardrail", message: "Please write something first" }]]);
			return;
		}

		this._manualReflectLoading.value = new Set([...this._manualReflectLoading.value, questionId]);
		const next = new Map(this._manualReflectResult.value);
		next.delete(questionId);
		this._manualReflectResult.value = next;

		let result: ReflectOnAnswerResponse;
		try {
			result = await fetchReflectOnAnswer({
				cardId: this.cardId,
				questionId,
				answer: entry.userAnswer,
			});
		} catch {
			result = { type: "none", message: "" };
		}

		this._manualReflectResult.value = new Map([...this._manualReflectResult.value, [questionId, result]]);

		const loadingNext = new Set(this._manualReflectLoading.value);
		loadingNext.delete(questionId);
		this._manualReflectLoading.value = loadingNext;

		capture("manual_reflect", {
			session_id: this.profileId,
			card_id: this.cardId,
			question_id: questionId,
			result_type: result.type,
		});
	}

	toggleDescription(id: string): void {
		if (this._selectedDescriptionIds.value.has(id)) {
			this._selectedDescriptionIds.value.delete(id);
		} else {
			this._selectedDescriptionIds.value.add(id);
		}
		this._selectedDescriptionIds.value = new Set(this._selectedDescriptionIds.value);
		if (this._descriptionsConfirmed.value) {
			this.persistDescriptions();
		}
	}

	confirmDescriptions(): void {
		this._descriptionsConfirmed.value = true;
		this.persistDescriptions();
	}

	persistEntries(): void {
		const data = loadExamineData(this.profileId);
		if (data === null) return;
		data[this.cardId] = { ...data[this.cardId], entries: this._entries.value };
		saveExamineData(this.profileId, data);
	}

	persistFreeform(): void {
		const data = loadExamineData(this.profileId);
		if (data === null) return;
		data[this.cardId] = { ...data[this.cardId], freeformNote: this._freeformNote.value };
		saveExamineData(this.profileId, data);
	}

	onFreeformBlur(): void {
		this.persistFreeform();
	}

	finishExamining(): void {
		if (this.hasBlockingReflection()) {
			this.acceptReflection();
			const lastIdx = this._entries.value.length - 1;
			if (lastIdx >= 0) {
				const mrNext = new Map(this._manualReflectResult.value);
				mrNext.delete(this._entries.value[lastIdx].questionId);
				this._manualReflectResult.value = mrNext;
			}
		}
		this.persistEntries();
		this.persistFreeform();
		this.persistDescriptions();
		const noteLength = this._freeformNote.value.trim().length;
		if (noteLength > 0) {
			capture("freeform_notes_added", {
				session_id: this.profileId,
				card_id: this.cardId,
				note_length: noteLength,
			});
		}
		const answeredCount = this._entries.value.filter((entry) => entry.submitted).length;
		capture("card_examination_finished", {
			session_id: this.profileId,
			card_id: this.cardId,
			answered_count: answeredCount,
			total_questions: EXAMINE_QUESTIONS.length,
			completed_all_questions: answeredCount === EXAMINE_QUESTIONS.length,
		});
		this.maybeTrackExaminePhaseCompleted();
	}

	// --- Private helpers ---

	private answerSource(entry: ExamineEntry, answer: string): "original" | "inferred-accepted" | "inferred-edited" {
		if (entry.prefilledAnswer === "") {
			return "original";
		}
		return answer === entry.prefilledAnswer ? "inferred-accepted" : "inferred-edited";
	}

	private trackSubmittedSnapshot(questionId: string, answer: string): void {
		this._submittedAnswerSnapshots.value.set(questionId, answer);
		this._editedAfterSubmit.value.delete(questionId);
	}

	private markQuestionStartNow(): void {
		this._questionStartTimeMs.value = performance.now();
	}

	private hasBlockingReflection(): boolean {
		const lastIdx = this._entries.value.length - 1;
		if (lastIdx < 0) return false;
		const last = this._entries.value[lastIdx];
		if (!last.submitted) return false;
		return (last.guardrailText !== "" && !last.submittedAfterGuardrail) || (last.thoughtBubbleText !== "" && !last.thoughtBubbleAcknowledged);
	}

	private acceptReflection(): void {
		const lastIdx = this._entries.value.length - 1;
		if (lastIdx < 0 || !this._entries.value[lastIdx].submitted) return;
		const entry = this._entries.value[lastIdx];
		entry.userAnswer = entry.userAnswer.trim();
		if (entry.guardrailText !== "" && !entry.submittedAfterGuardrail) {
			entry.submittedAfterGuardrail = true;
			this.trackSubmittedSnapshot(entry.questionId, entry.userAnswer);
			capture("answer_submitted_after_guardrail", {
				session_id: this.profileId,
				card_id: this.cardId,
				question_id: entry.questionId,
			});
		}
		if (entry.thoughtBubbleText !== "" && !entry.thoughtBubbleAcknowledged) {
			entry.thoughtBubbleAcknowledged = true;
		}
	}

	private answeredQuestionIds(): Set<string> {
		return new Set(this._entries.value.filter((e) => e.submitted).map((e) => e.questionId));
	}

	private remainingQuestionIds(): string[] {
		const answered = this.answeredQuestionIds();
		const inEntries = new Set(this._entries.value.map((e) => e.questionId));
		return EXAMINE_QUESTIONS.filter((q) => !answered.has(q.id) && !inEntries.has(q.id)).map((q) => q.id);
	}

	private applyInferAndAdvance(inferredMap: Map<string, string>, remaining: string[]): void {
		if (remaining.length === 0) {
			return;
		}

		const nextQuestionId = selectNextQuestion(remaining, [...inferredMap.keys()]);
		const nextPrefill = inferredMap.get(nextQuestionId) ?? "";

		// Trailing "\n" reserves space for the autofill chip in the textarea's bottom-right corner.
		this._entries.value.push({
			questionId: nextQuestionId,
			userAnswer: nextPrefill !== "" ? nextPrefill + "\n" : "",
			prefilledAnswer: nextPrefill,
			submitted: false,
			guardrailText: "",
			submittedAfterGuardrail: false,
			thoughtBubbleText: "",
			thoughtBubbleAcknowledged: false,
			autoFilledPending: nextPrefill !== "",
		});
		this.persistEntries();
		this.markQuestionStartNow();
	}

	private async inferAndAdvance(): Promise<void> {
		const remaining = this.remainingQuestionIds();
		if (remaining.length === 0) {
			return;
		}

		const questions = [...this._entries.value.filter((e) => e.submitted).map((e) => ({ questionId: e.questionId, answer: e.userAnswer })), ...remaining.map((qId) => ({ questionId: qId, answer: "" }))];

		this._inferring.value = true;
		let inferredMap = new Map<string, string>();
		try {
			const result = await fetchInferredAnswers({ cardId: this.cardId, questions });
			inferredMap = new Map(result.inferredAnswers.map((ia) => [ia.questionId, ia.answer]));
		} catch {
			// graceful degradation: no pre-fills
		} finally {
			this._inferring.value = false;
		}

		this.applyInferAndAdvance(inferredMap, remaining);
	}

	private persistDescriptions(): void {
		const data = loadExamineData(this.profileId);
		if (data === null) return;
		data[this.cardId] = { ...data[this.cardId], descriptionSelections: [...this._selectedDescriptionIds.value] };
		saveExamineData(this.profileId, data);
	}

	private maybeTrackExaminePhaseCompleted(): void {
		const trackedKey = `${EXAMINE_PHASE_TRACK_KEY_PREFIX}:${this.profileId}`;
		if (sessionStorage.getItem(trackedKey) === "1") {
			return;
		}

		if (!isExaminePhaseComplete(this.profileId)) {
			return;
		}

		capture("examine_phase_completed", { session_id: this.profileId });
		sessionStorage.setItem(trackedKey, "1");
	}
}
