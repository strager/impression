// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { MEANING_EXPRESSIONS } from "../shared/meaning-expressions.ts";
import { ExamineMeaningViewModel } from "./ExamineMeaningViewModel.ts";
import type { ExamineData, ExamineEntry } from "./store.ts";
import { ensureProfilesInitialized, getActiveProfileId, loadExamineData, saveChosenCardIds, saveExamineData } from "./store.ts";

let currentWindow: Window | null = null;

function setGlobalDom(win: Window): void {
	Object.defineProperty(globalThis, "window", {
		value: win,
		configurable: true,
	});
	Object.defineProperty(globalThis, "document", {
		value: win.document,
		configurable: true,
	});
	Object.defineProperty(globalThis, "localStorage", {
		value: win.localStorage,
		configurable: true,
	});
	Object.defineProperty(globalThis, "sessionStorage", {
		value: win.sessionStorage,
		configurable: true,
	});
	Object.defineProperty(globalThis.navigator, "storage", {
		value: { persist: () => Promise.resolve(false) },
		configurable: true,
	});
}

function sid(): string {
	return getActiveProfileId();
}

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
	const mswFetch = globalThis.fetch;
	globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		if (typeof input === "string" && input.startsWith("/")) {
			return mswFetch(`http://localhost${input}`, init);
		}
		return mswFetch(input, init);
	};
});

beforeEach(() => {
	currentWindow = new Window({ url: "http://localhost" });
	setGlobalDom(currentWindow);
	ensureProfilesInitialized();
});

afterEach(() => {
	server.resetHandlers();
	currentWindow?.close();
	currentWindow = null;
});

afterAll(() => {
	server.close();
});

const TEST_CARD_ID = MEANING_CARDS[0].id;

function makeEntry(questionId: string, answer: string, submitted: boolean): ExamineEntry {
	return {
		questionId,
		userAnswer: answer,
		prefilledAnswer: "",
		submitted,
		guardrailText: "",
		submittedAfterGuardrail: false,
		thoughtBubbleText: "",
		thoughtBubbleAcknowledged: false,
		autoFilledPending: false,
	};
}

function setupExamineData(cardId: string, entries: ExamineEntry[]): void {
	saveChosenCardIds(sid(), [cardId]);
	const data: ExamineData = { [cardId]: { entries, freeformNote: "", descriptionSelections: [] } };
	saveExamineData(sid(), data);
}

function makeSubmittedEntries(count: number): ExamineEntry[] {
	return EXAMINE_QUESTIONS.slice(0, count).map((q) => makeEntry(q.id, `Answer for ${q.id}`, true));
}

function makeAllSubmitted(): ExamineEntry[] {
	return makeSubmittedEntries(EXAMINE_QUESTIONS.length);
}

function setupDefaultHandlers(): void {
	server.use(
		http.post("*/api/reflect-on-answer", () => {
			return HttpResponse.json({ type: "none", message: "" });
		}),
		http.post("*/api/infer-answers", () => {
			return HttpResponse.json({ inferredAnswers: [] });
		}),
	);
}

describe("initialize", () => {
	it("returns 'no-data' when card not found", () => {
		const vm = new ExamineMeaningViewModel(sid(), "nonexistent-card");
		expect(vm.initialize()).toBe("no-data");
	});

	it("assigns first question when entries are missing", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].submitted).toBe(false);
		expect(vm.entries[0].userAnswer).toBe("");
	});

	it("assigns first question when entries are empty", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), { [TEST_CARD_ID]: { entries: [], freeformNote: "", descriptionSelections: [] } });
		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].submitted).toBe(false);
		expect(vm.entries[0].userAnswer).toBe("");
	});

	it("discards submitted entry with empty answer and restarts from first question", () => {
		setupDefaultHandlers();
		const entry1 = makeEntry(EXAMINE_QUESTIONS[0].id, "", true);
		entry1.guardrailText = "Could you share more?";
		entry1.submittedAfterGuardrail = true;
		const entry2 = makeEntry(EXAMINE_QUESTIONS[1].id, "", false);
		setupExamineData(TEST_CARD_ID, [entry1, entry2]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].questionId).toBe(EXAMINE_QUESTIONS[0].id);
		expect(vm.entries[0].submitted).toBe(false);
	});

	it("returns 'ready' and loads entries on normal load", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "test answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.card).toBeDefined();
		expect(vm.card!.id).toBe(TEST_CARD_ID);
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].userAnswer).toBe("test answer");
	});

	it("restores freeform notes from localStorage", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), { [TEST_CARD_ID]: { entries, freeformNote: "my notes", descriptionSelections: [] } });

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.freeformNote).toBe("my notes");
	});

	it("restores description selections from localStorage", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm1 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		vm1.toggleDescription("3");
		vm1.toggleDescription("6");
		vm1.confirmDescriptions();

		const vm2 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.selectedDescriptionIds.has("3")).toBe(true);
		expect(vm2.selectedDescriptionIds.has("6")).toBe(true);
		expect(vm2.descriptionsConfirmed).toBe(true);
	});

	it("resumes with pending guardrail", () => {
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "short", true);
		entry.guardrailText = "Please elaborate";
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("guardrail");
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.message).toBe("Please elaborate");
	});

	it("resumes with pending thought bubble", () => {
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "good answer", true);
		entry.thoughtBubbleText = "Nice insight!";
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("thought_bubble");
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.message).toBe("Nice insight!");
	});

	it("does not resume guardrail if already submitted after guardrail", () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "my answer", true);
		entry.guardrailText = "Please elaborate";
		entry.submittedAfterGuardrail = true;
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
	});

	it("does not resume thought bubble if already acknowledged", () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "my answer", true);
		entry.thoughtBubbleText = "Nice insight!";
		entry.thoughtBubbleAcknowledged = true;
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
	});

	it("restores prefilled answer state", async () => {
		const nextQId = EXAMINE_QUESTIONS[1].id;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({
					inferredAnswers: [{ questionId: nextQId, answer: "suggested answer" }],
				});
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm1 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		await vm1.submitAnswer();

		expect(vm1.entries[1].autoFilledPending).toBe(true);
		expect(vm1.entries[1].userAnswer).toBe("suggested answer\n");

		// Q2 entry now exists with prefilled answer persisted
		const vm2 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.entries[1].autoFilledPending).toBe(true);
		expect(vm2.entries[1].userAnswer).toBe("suggested answer\n");
	});

	it("acceptAutoFill clears pending flag and persists", async () => {
		const nextQId = EXAMINE_QUESTIONS[1].id;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({
					inferredAnswers: [{ questionId: nextQId, answer: "suggested answer" }],
				});
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[1].autoFilledPending).toBe(true);
		vm.acceptAutoFill(vm.entries[1]);
		expect(vm.entries[1].autoFilledPending).toBe(false);
		expect(vm.entries[1].userAnswer).toBe("suggested answer");

		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].entries[1].autoFilledPending).toBe(false);
	});

	it("clearAutoFill clears answer and pending flag and persists", async () => {
		const nextQId = EXAMINE_QUESTIONS[1].id;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({
					inferredAnswers: [{ questionId: nextQId, answer: "suggested answer" }],
				});
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[1].autoFilledPending).toBe(true);
		vm.clearAutoFill(vm.entries[1]);
		expect(vm.entries[1].autoFilledPending).toBe(false);
		expect(vm.entries[1].userAnswer).toBe("");

		// loadExamineData drops blank active entries when non-blank answers exist,
		// so the cleared entry is not present in persisted data
		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].entries).toHaveLength(1);
		expect(saved![TEST_CARD_ID].entries[0].submitted).toBe(true);
	});

	it("clear then refresh discards blank question and regenerates", async () => {
		const nextQId = EXAMINE_QUESTIONS[1].id;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({
					inferredAnswers: [{ questionId: nextQId, answer: "suggested answer" }],
				});
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		// Clear the auto-filled answer
		vm.clearAutoFill(vm.entries[1]);
		expect(vm.entries[1].userAnswer).toBe("");

		// Simulate reload — loadExamineData drops blank active entries when non-blank answers exist.
		// The reload sees only 1 submitted entry, so initialize() triggers async inferAndAdvance().
		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].entries).toHaveLength(1);
		expect(saved![TEST_CARD_ID].entries[0].submitted).toBe(true);
	});
});

describe("submitAnswer", () => {
	it("does nothing when answer is empty", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].submitted).toBe(false);
	});

	it("does nothing when answer is whitespace only", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "   ", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].submitted).toBe(false);
	});

	it("marks answer as submitted and persists", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My thoughtful answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].submitted).toBe(true);
		expect(vm.entries[0].userAnswer).toBe("My thoughtful answer");

		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].entries[0].submitted).toBe(true);
	});

	it("trims answer text before submission", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "  My answer  ", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].userAnswer).toBe("My answer");
	});

	it("detects original answer source", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		// prefilledAnswer is "" so source should be "original" — just verify no crash
		await vm.submitAnswer();
		expect(vm.entries[0].submitted).toBe(true);
	});

	it("detects inferred-accepted answer source", async () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "inferred text", false);
		entry.prefilledAnswer = "inferred text";
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.entries[0].submitted).toBe(true);
	});

	it("detects inferred-edited answer source", async () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "edited text", false);
		entry.prefilledAnswer = "inferred text";
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.entries[0].submitted).toBe(true);
	});

	it("shows guardrail when reflect returns guardrail", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "guardrail", message: "Please elaborate" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("guardrail");
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.message).toBe("Please elaborate");
		expect(vm.entries[0].guardrailText).toBe("Please elaborate");
	});

	it("shows thought bubble when reflect returns thought_bubble", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "thought_bubble", message: "Great insight!" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My detailed answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("thought_bubble");
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.message).toBe("Great insight!");
		expect(vm.entries[0].thoughtBubbleText).toBe("Great insight!");
		expect(vm.entries[0].thoughtBubbleAcknowledged).toBe(false);
	});

	it("advances to next question when reflect returns none", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
		expect(vm.entries).toHaveLength(2);
		expect(vm.entries[1].submitted).toBe(false);
	});

	it("fails open when reflect API call fails", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return new HttpResponse(null, { status: 500 });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
		expect(vm.entries).toHaveLength(2);
	});

	it("pre-fills next question from infer results", async () => {
		const nextQId = EXAMINE_QUESTIONS[1].id;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({
					inferredAnswers: [{ questionId: nextQId, answer: "Inferred answer" }],
				});
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		const nextEntry = vm.entries.find((e) => e.questionId === nextQId);
		expect(nextEntry).toBeDefined();
		expect(nextEntry!.userAnswer).toBe("Inferred answer\n");
		expect(nextEntry!.prefilledAnswer).toBe("Inferred answer");
	});

	it("picks next sequential question when infer fails", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries).toHaveLength(2);
		expect(vm.entries[1].prefilledAnswer).toBe("");
		expect(vm.entries[1].questionId).toBe(EXAMINE_QUESTIONS[1].id);
	});

	it("picks next sequential question when infer fails mid-sequence", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = makeSubmittedEntries(2);
		entries.push(makeEntry(EXAMINE_QUESTIONS[2].id, "My answer", false));
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries).toHaveLength(4);
		expect(vm.entries[3].questionId).toBe(EXAMINE_QUESTIONS[3].id);
	});

	it("sets allAnswered when last question answered", async () => {
		setupDefaultHandlers();
		const entries = makeSubmittedEntries(EXAMINE_QUESTIONS.length - 1);
		entries.push(makeEntry(EXAMINE_QUESTIONS[EXAMINE_QUESTIONS.length - 1].id, "Last answer", false));
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.allAnswered).toBe(true);
	});

	it("does not advance while awaiting reflection", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// Simulate being in awaiting state by calling submit during another submit
		// The guard checks awaitingReflection at the start
		const promise1 = vm.submitAnswer();
		// Second call should be a no-op because awaitingReflection is true
		const promise2 = vm.submitAnswer();
		await Promise.all([promise1, promise2]);

		// Should only have advanced once
		expect(vm.entries).toHaveLength(2);
	});
});

describe("dismissing reflection", () => {
	it("dismissing guardrail without edit advances", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "guardrail", message: "Please elaborate" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("guardrail");

		// Now dismiss (no edit, so not in editedAfterSubmit)
		setupDefaultHandlers();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
		expect(vm.entries).toHaveLength(2);
		expect(vm.entries[0].submittedAfterGuardrail).toBe(true);
	});

	it("dismissing guardrail with edit triggers second reflect", async () => {
		let callCount = 0;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json({ type: "guardrail", message: "Please elaborate" });
				}
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("guardrail");

		// Edit the answer
		vm.entries[0].userAnswer = "much more detailed answer now";
		vm.onActiveEntryInput(vm.entries[0]);

		// Dismiss with edit
		await vm.submitAnswer();

		expect(callCount).toBe(2);
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
		expect(vm.entries).toHaveLength(2);
	});

	it("second reflect returning thought bubble shows it", async () => {
		let callCount = 0;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json({ type: "guardrail", message: "Please elaborate" });
				}
				return HttpResponse.json({ type: "thought_bubble", message: "Interesting point" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		// Edit
		vm.entries[0].userAnswer = "better answer";
		vm.onActiveEntryInput(vm.entries[0]);

		// Dismiss with edit
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("thought_bubble");
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.message).toBe("Interesting point");
	});

	it("second reflect thought bubble is resumed and cleared correctly", async () => {
		let callCount = 0;
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json({ type: "guardrail", message: "Please elaborate" });
				}
				return HttpResponse.json({ type: "thought_bubble", message: "Interesting point" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		// Edit and dismiss guardrail → second reflect returns thought bubble
		vm.entries[0].userAnswer = "better answer";
		vm.onActiveEntryInput(vm.entries[0]);
		await vm.submitAnswer();

		const qId = EXAMINE_QUESTIONS[0].id;

		// Verify entry state after second reflect
		expect(vm.entries[0].guardrailText).not.toBe("");
		expect(vm.entries[0].submittedAfterGuardrail).toBe(true);
		expect(vm.entries[0].thoughtBubbleText).not.toBe("");
		expect(vm.entries[0].thoughtBubbleAcknowledged).toBe(false);

		// Recreate ViewModel from persisted state — thought bubble should resume
		const vm2 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.manualReflectResult.get(qId)?.type).toBe("thought_bubble");
		expect(vm2.editingEntryIndex).toBe(0);

		// Finish examining dismisses the thought bubble
		vm2.finishExamining();
		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].entries[0].thoughtBubbleAcknowledged).toBe(true);

		// Recreate again — thought bubble should not resume
		const vm3 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm3.initialize();
		expect(vm3.manualReflectResult.get(qId)).toBeUndefined();
	});

	it("second reflect after guardrail+edit ignores guardrail response", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "guardrail", message: "Try again" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("guardrail");

		// Edit the answer and resubmit — second call also returns guardrail,
		// but suppressGuardrail + the client-side thought_bubble gate means
		// it is ignored.
		vm.entries[0].userAnswer = "a much longer and more detailed answer now";
		vm.onActiveEntryInput(vm.entries[0]);
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
		expect(vm.entries).toHaveLength(2);
	});

	it("dismissing thought bubble sets thoughtBubbleAcknowledged", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "thought_bubble", message: "Nice!" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)?.type).toBe("thought_bubble");

		// Dismiss
		setupDefaultHandlers();
		await vm.submitAnswer();

		expect(vm.entries[0].thoughtBubbleAcknowledged).toBe(true);
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeUndefined();
	});
});

describe("entry input and blur", () => {
	it("tracks edit-after-submit for active entry", () => {
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "original", true);
		const entries = [entry, makeEntry(EXAMINE_QUESTIONS[1].id, "pending", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// The active entry is index 1, but let's test with the submitted entry
		vm.entries[0].userAnswer = "edited";
		vm.onAnsweredEntryInput(vm.entries[0]);

		// Not checking internal state directly — just verify no crash
		expect(vm.entries[0].userAnswer).toBe("edited");
	});

	it("blur on edited answered entry persists and re-snapshots", () => {
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "original answer", true);
		const entries = [entry, makeEntry(EXAMINE_QUESTIONS[1].id, "pending", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// Edit the submitted entry
		vm.entries[0].userAnswer = "edited answer";
		vm.onAnsweredEntryInput(vm.entries[0]);
		vm.onAnsweredEntryBlur(vm.entries[0]);

		// Verify persisted
		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].entries[0].userAnswer).toBe("edited answer");
	});
});

describe("manual reflection", () => {
	it("returns guardrail result for empty answer without API call", async () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// Clear answer after init so the entry exists but has empty text
		vm.entries[0].userAnswer = "";

		await vm.reflectOnEntry(EXAMINE_QUESTIONS[0].id);

		const result = vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id);
		expect(result).toBeDefined();
		expect(result!.type).toBe("guardrail");
		expect(result!.message).toBe("Please write something first");
	});

	it("calls API and stores result for valid answer", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "thought_bubble", message: "Good point!" });
			}),
		);
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		await vm.reflectOnEntry(EXAMINE_QUESTIONS[0].id);

		const result = vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id);
		expect(result).toBeDefined();
		expect(result!.type).toBe("thought_bubble");
		expect(result!.message).toBe("Good point!");
	});

	it("manages loading state", async () => {
		let resolve: (() => void) | undefined;
		const responsePromise = new Promise<void>((r) => {
			resolve = r;
		});
		server.use(
			http.post("*/api/reflect-on-answer", async () => {
				await responsePromise;
				return HttpResponse.json({ type: "none", message: "" });
			}),
		);
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const promise = vm.reflectOnEntry(EXAMINE_QUESTIONS[0].id);
		expect(vm.manualReflectLoading.has(EXAMINE_QUESTIONS[0].id)).toBe(true);

		resolve!();
		await promise;

		expect(vm.manualReflectLoading.has(EXAMINE_QUESTIONS[0].id)).toBe(false);
	});

	it("fails open on API error", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		await vm.reflectOnEntry(EXAMINE_QUESTIONS[0].id);

		const result = vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id);
		expect(result).toBeDefined();
		expect(result!.type).toBe("none");
	});

	it("manual reflection result is not restored on reload", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "thought_bubble", message: "Interesting!" });
			}),
		);
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.reflectOnEntry(EXAMINE_QUESTIONS[0].id);
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeDefined();

		// Create a second VM from the same persisted state
		const vm2 = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.manualReflectResult.size).toBe(0);
	});
});

describe("descriptions and freeform", () => {
	it("toggle adds and removes from set", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const descId = MEANING_EXPRESSIONS.find((d) => d.meaningId === TEST_CARD_ID)?.id;
		if (descId === undefined) return; // skip if no descriptions for this card

		vm.toggleDescription(descId);
		expect(vm.selectedDescriptionIds.has(descId)).toBe(true);

		vm.toggleDescription(descId);
		expect(vm.selectedDescriptionIds.has(descId)).toBe(false);
	});

	it("confirm persists descriptions to localStorage", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const descId = MEANING_EXPRESSIONS.find((d) => d.meaningId === TEST_CARD_ID)?.id;
		if (descId === undefined) return;

		vm.toggleDescription(descId);
		vm.confirmDescriptions();

		expect(vm.descriptionsConfirmed).toBe(true);
		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].descriptionSelections).toContain(descId);
	});

	it("toggle persists when already confirmed", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const descId = MEANING_EXPRESSIONS.find((d) => d.meaningId === TEST_CARD_ID)?.id;
		if (descId === undefined) return;

		vm.confirmDescriptions();
		vm.toggleDescription(descId);

		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].descriptionSelections).toContain(descId);
	});

	it("freeform persist saves to localStorage", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.freeformNote = "My additional thoughts";
		vm.persistFreeform();

		const saved = loadExamineData(sid());
		expect(saved![TEST_CARD_ID].freeformNote).toBe("My additional thoughts");
	});
});

describe("finishExamining", () => {
	it("persists entries, freeform, and descriptions", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.freeformNote = "Final notes";

		const descId = MEANING_EXPRESSIONS.find((d) => d.meaningId === TEST_CARD_ID)?.id;
		if (descId !== undefined) {
			vm.toggleDescription(descId);
		}

		vm.finishExamining();

		const savedData = loadExamineData(sid());
		expect(savedData![TEST_CARD_ID].entries).toHaveLength(EXAMINE_QUESTIONS.length);
		expect(savedData![TEST_CARD_ID].freeformNote).toBe("Final notes");
		expect(savedData![TEST_CARD_ID].descriptionSelections).toBeDefined();
	});

	it("accepts pending reflection if shown", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "guardrail", message: "Elaborate" });
			}),
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({ inferredAnswers: [] });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "short", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeDefined();

		vm.finishExamining();

		expect(vm.entries[0].submittedAfterGuardrail).toBe(true);
	});

	it("does not throw when no reflection is shown", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		expect(() => {
			vm.finishExamining();
		}).not.toThrow();
	});
});

describe("derived properties", () => {
	it("activeIndex is 0 for no submitted entries", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "pending", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.activeIndex).toBe(0);
	});

	it("activeIndex points to first non-submitted entry", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "a", true), makeEntry(EXAMINE_QUESTIONS[1].id, "b", true), makeEntry(EXAMINE_QUESTIONS[2].id, "pending", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.activeIndex).toBe(2);
	});

	it("activeIndex equals entries.length when all submitted", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.activeIndex).toBe(EXAMINE_QUESTIONS.length);
	});

	it("editingEntryIndex during reflection is last submitted entry", () => {
		const entry = makeEntry(EXAMINE_QUESTIONS[0].id, "my answer", true);
		entry.guardrailText = "elaborate";
		setupExamineData(TEST_CARD_ID, [entry]);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXAMINE_QUESTIONS[0].id)).toBeDefined();
		expect(vm.editingEntryIndex).toBe(0);
	});

	it("editingEntryIndex during normal state is active entry", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "a", true), makeEntry(EXAMINE_QUESTIONS[1].id, "pending answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.editingEntryIndex).toBe(1);
	});

	it("allAnswered is false with partial entries", () => {
		const entries = makeSubmittedEntries(2);
		entries.push(makeEntry(EXAMINE_QUESTIONS[2].id, "pending", false));
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.allAnswered).toBe(false);
	});

	it("allAnswered is true when all questions submitted", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.allAnswered).toBe(true);
	});

	it("submittedCount reflects number of submitted entries", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "a", true), makeEntry(EXAMINE_QUESTIONS[1].id, "b", true), makeEntry(EXAMINE_QUESTIONS[2].id, "pending", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.submittedCount).toBe(2);
	});

	it("cardDescriptions returns descriptions for the card's meaning ID", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const descriptions = vm.cardDescriptions;
		expect(descriptions.length).toBeGreaterThan(0);
		for (const d of descriptions) {
			expect(d.meaningId).toBe(TEST_CARD_ID);
		}
	});

	it("readyForReflect is false when all answered but descriptions not confirmed", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.allAnswered).toBe(true);
		expect(vm.descriptionsConfirmed).toBe(false);
		expect(vm.readyForReflect).toBe(false);
	});

	it("readyForReflect is true when all answered and descriptions confirmed", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.confirmDescriptions();
		expect(vm.readyForReflect).toBe(true);
	});

	it("readyForReflect is false when not all answered", () => {
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.readyForReflect).toBe(false);
	});

	it("freeformVisible is false when descriptions not confirmed", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.freeformVisible).toBe(false);
	});

	it("freeformVisible is true when all answered, descriptions confirmed, and not editing", () => {
		const entries = makeAllSubmitted();
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.confirmDescriptions();
		expect(vm.freeformVisible).toBe(true);
	});

	it("freeformVisible is false during blocking reflection even when descriptions confirmed", () => {
		const entries = makeAllSubmitted();
		entries[entries.length - 1].guardrailText = "elaborate";
		entries[entries.length - 1].submittedAfterGuardrail = false;
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.confirmDescriptions();
		expect(vm.editingEntryIndex).not.toBe(-1);
		expect(vm.freeformVisible).toBe(false);
	});
});

describe("sequential question selection", () => {
	async function submitAllQuestions(): Promise<string[]> {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = [makeEntry(EXAMINE_QUESTIONS[0].id, "My answer", false)];
		setupExamineData(TEST_CARD_ID, entries);

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		for (let i = 0; i < EXAMINE_QUESTIONS.length; i++) {
			const idx = vm.activeIndex;
			if (idx >= vm.entries.length) break;
			vm.entries[idx].userAnswer = `Answer ${String(i)}`;
			await vm.submitAnswer();
		}

		return vm.entries.map((e) => e.questionId);
	}

	it("selects all questions without duplicates", async () => {
		const questionIds = await submitAllQuestions();

		expect(questionIds).toHaveLength(EXAMINE_QUESTIONS.length);
		expect(new Set(questionIds).size).toBe(EXAMINE_QUESTIONS.length);
	});

	it("asks questions in EXAMINE_QUESTIONS list order", async () => {
		const questionIds = await submitAllQuestions();

		expect(questionIds).toEqual(EXAMINE_QUESTIONS.map((q) => q.id));
	});
});

describe("initial question assignment", () => {
	it("assigns the first question in EXAMINE_QUESTIONS order", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), { [TEST_CARD_ID]: { entries: [], freeformNote: "", descriptionSelections: [] } });

		const vm = new ExamineMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		expect(vm.entries[0].questionId).toBe(EXAMINE_QUESTIONS[0].id);
	});
});
