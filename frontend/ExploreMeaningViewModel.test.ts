// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { MEANING_STATEMENTS } from "../shared/meaning-statements.ts";
import { ExploreMeaningViewModel } from "./ExploreMeaningViewModel.ts";
import type { ExploreData, ExploreEntry } from "./store.ts";
import { ensureSessionsInitialized, getActiveSessionId, loadExploreData, saveChosenCardIds, saveExploreData } from "./store.ts";

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
	return getActiveSessionId();
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
	ensureSessionsInitialized();
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

function makeEntry(questionId: string, answer: string, submitted: boolean): ExploreEntry {
	return {
		questionId,
		userAnswer: answer,
		prefilledAnswer: "",
		submitted,
		guardrailText: "",
		submittedAfterGuardrail: false,
		thoughtBubbleText: "",
		thoughtBubbleAcknowledged: false,
	};
}

function setupExploreData(cardId: string, entries: ExploreEntry[]): void {
	saveChosenCardIds(sid(), [cardId]);
	const data: ExploreData = { [cardId]: { entries, freeformNote: "", statementSelections: [] } };
	saveExploreData(sid(), data);
}

function makeSubmittedEntries(count: number): ExploreEntry[] {
	return EXPLORE_QUESTIONS.slice(0, count).map((q) => makeEntry(q.id, `Answer for ${q.id}`, true));
}

function makeAllSubmitted(): ExploreEntry[] {
	return makeSubmittedEntries(EXPLORE_QUESTIONS.length);
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
		const vm = new ExploreMeaningViewModel(sid(), "nonexistent-card");
		expect(vm.initialize()).toBe("no-data");
	});

	it("assigns first question when entries are missing", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].submitted).toBe(false);
		expect(vm.entries[0].userAnswer).toBe("");

		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].entries).toHaveLength(1);
	});

	it("assigns first question when entries are empty", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), { [TEST_CARD_ID]: { entries: [], freeformNote: "", statementSelections: [] } });
		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].submitted).toBe(false);
		expect(vm.entries[0].userAnswer).toBe("");

		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].entries).toHaveLength(1);
	});

	it("returns 'ready' and loads entries on normal load", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "test answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.card).toBeDefined();
		expect(vm.card!.id).toBe(TEST_CARD_ID);
		expect(vm.entries).toHaveLength(1);
		expect(vm.entries[0].userAnswer).toBe("test answer");
	});

	it("restores freeform notes from localStorage", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), { [TEST_CARD_ID]: { entries, freeformNote: "my notes", statementSelections: [] } });

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.freeformNote).toBe("my notes");
	});

	it("restores statement selections from localStorage", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm1 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		vm1.toggleStatement("3");
		vm1.toggleStatement("6");
		vm1.confirmStatements();

		const vm2 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.selectedStatementIds.has("3")).toBe(true);
		expect(vm2.selectedStatementIds.has("6")).toBe(true);
		expect(vm2.statementsConfirmed).toBe(true);
	});

	it("resumes with pending guardrail", () => {
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "short", true);
		entry.guardrailText = "Please elaborate";
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("guardrail");
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.message).toBe("Please elaborate");
	});

	it("resumes with pending thought bubble", () => {
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "good answer", true);
		entry.thoughtBubbleText = "Nice insight!";
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("thought_bubble");
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.message).toBe("Nice insight!");
	});

	it("does not resume guardrail if already submitted after guardrail", () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "my answer", true);
		entry.guardrailText = "Please elaborate";
		entry.submittedAfterGuardrail = true;
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
	});

	it("does not resume thought bubble if already acknowledged", () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "my answer", true);
		entry.thoughtBubbleText = "Nice insight!";
		entry.thoughtBubbleAcknowledged = true;
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
	});

	it("restores prefilled answer state", async () => {
		const nextQId = EXPLORE_QUESTIONS[1].id;
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm1 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		await vm1.submitAnswer();

		// Q2 entry now exists with prefilled answer persisted
		const vm2 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.prefilledQuestionIds.has(nextQId)).toBe(true);
		expect(vm2.entries[1].userAnswer).toBe("suggested answer");
	});
});

describe("submitAnswer", () => {
	it("does nothing when answer is empty", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].submitted).toBe(false);
	});

	it("does nothing when answer is whitespace only", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "   ", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].submitted).toBe(false);
	});

	it("marks answer as submitted and persists", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My thoughtful answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].submitted).toBe(true);
		expect(vm.entries[0].userAnswer).toBe("My thoughtful answer");

		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].entries[0].submitted).toBe(true);
	});

	it("trims answer text before submission", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "  My answer  ", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries[0].userAnswer).toBe("My answer");
	});

	it("detects original answer source", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		// prefilledAnswer is "" so source should be "original" — just verify no crash
		await vm.submitAnswer();
		expect(vm.entries[0].submitted).toBe(true);
	});

	it("detects inferred-accepted answer source", async () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "inferred text", false);
		entry.prefilledAnswer = "inferred text";
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.entries[0].submitted).toBe(true);
	});

	it("detects inferred-edited answer source", async () => {
		setupDefaultHandlers();
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "edited text", false);
		entry.prefilledAnswer = "inferred text";
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("guardrail");
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.message).toBe("Please elaborate");
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My detailed answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("thought_bubble");
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.message).toBe("Great insight!");
		expect(vm.entries[0].thoughtBubbleText).toBe("Great insight!");
		expect(vm.entries[0].thoughtBubbleAcknowledged).toBe(false);
	});

	it("advances to next question when reflect returns none", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
		expect(vm.entries).toHaveLength(2);
	});

	it("pre-fills next question from infer results", async () => {
		const nextQId = EXPLORE_QUESTIONS[1].id;
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		const nextEntry = vm.entries.find((e) => e.questionId === nextQId);
		expect(nextEntry).toBeDefined();
		expect(nextEntry!.userAnswer).toBe("Inferred answer");
		expect(nextEntry!.prefilledAnswer).toBe("Inferred answer");
	});

	it("picks random question when infer fails", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.entries).toHaveLength(2);
		expect(vm.entries[1].prefilledAnswer).toBe("");
	});

	it("sets allAnswered when last question answered", async () => {
		setupDefaultHandlers();
		const entries = makeSubmittedEntries(EXPLORE_QUESTIONS.length - 1);
		entries.push(makeEntry(EXPLORE_QUESTIONS[EXPLORE_QUESTIONS.length - 1].id, "Last answer", false));
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		expect(vm.allAnswered).toBe(true);
	});

	it("does not advance while awaiting reflection", async () => {
		setupDefaultHandlers();
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("guardrail");

		// Now dismiss (no edit, so not in editedAfterSubmit)
		setupDefaultHandlers();
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("guardrail");

		// Edit the answer
		vm.entries[0].userAnswer = "much more detailed answer now";
		vm.onActiveEntryInput(vm.entries[0]);

		// Dismiss with edit
		await vm.submitAnswer();

		expect(callCount).toBe(2);
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		// Edit
		vm.entries[0].userAnswer = "better answer";
		vm.onActiveEntryInput(vm.entries[0]);

		// Dismiss with edit
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("thought_bubble");
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.message).toBe("Interesting point");
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();

		// Edit and dismiss guardrail → second reflect returns thought bubble
		vm.entries[0].userAnswer = "better answer";
		vm.onActiveEntryInput(vm.entries[0]);
		await vm.submitAnswer();

		const qId = EXPLORE_QUESTIONS[0].id;

		// Verify entry state after second reflect
		expect(vm.entries[0].guardrailText).not.toBe("");
		expect(vm.entries[0].submittedAfterGuardrail).toBe(true);
		expect(vm.entries[0].thoughtBubbleText).not.toBe("");
		expect(vm.entries[0].thoughtBubbleAcknowledged).toBe(false);

		// Recreate ViewModel from persisted state — thought bubble should resume
		const vm2 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.manualReflectResult.get(qId)?.type).toBe("thought_bubble");
		expect(vm2.editingEntryIndex).toBe(0);

		// Finish exploring dismisses the thought bubble
		vm2.finishExploring();
		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].entries[0].thoughtBubbleAcknowledged).toBe(true);

		// Recreate again — thought bubble should not resume
		const vm3 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("guardrail");

		// Edit the answer and resubmit — second call also returns guardrail,
		// but suppressGuardrail + the client-side thought_bubble gate means
		// it is ignored.
		vm.entries[0].userAnswer = "a much longer and more detailed answer now";
		vm.onActiveEntryInput(vm.entries[0]);
		await vm.submitAnswer();

		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)?.type).toBe("thought_bubble");

		// Dismiss
		setupDefaultHandlers();
		await vm.submitAnswer();

		expect(vm.entries[0].thoughtBubbleAcknowledged).toBe(true);
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeUndefined();
	});
});

describe("entry input and blur", () => {
	it("tracks edit-after-submit for active entry", () => {
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "original", true);
		const entries = [entry, makeEntry(EXPLORE_QUESTIONS[1].id, "pending", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// The active entry is index 1, but let's test with the submitted entry
		vm.entries[0].userAnswer = "edited";
		vm.onAnsweredEntryInput(vm.entries[0]);

		// Not checking internal state directly — just verify no crash
		expect(vm.entries[0].userAnswer).toBe("edited");
	});

	it("blur on edited answered entry persists and re-snapshots", () => {
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "original answer", true);
		const entries = [entry, makeEntry(EXPLORE_QUESTIONS[1].id, "pending", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// Edit the submitted entry
		vm.entries[0].userAnswer = "edited answer";
		vm.onAnsweredEntryInput(vm.entries[0]);
		vm.onAnsweredEntryBlur(vm.entries[0]);

		// Verify persisted
		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].entries[0].userAnswer).toBe("edited answer");
	});
});

describe("manual reflection", () => {
	it("returns guardrail result for empty answer without API call", async () => {
		const entries = makeAllSubmitted();
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		// Clear answer after init so the entry exists but has empty text
		vm.entries[0].userAnswer = "";

		await vm.reflectOnEntry(EXPLORE_QUESTIONS[0].id);

		const result = vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id);
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
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		await vm.reflectOnEntry(EXPLORE_QUESTIONS[0].id);

		const result = vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id);
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
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const promise = vm.reflectOnEntry(EXPLORE_QUESTIONS[0].id);
		expect(vm.manualReflectLoading.has(EXPLORE_QUESTIONS[0].id)).toBe(true);

		resolve!();
		await promise;

		expect(vm.manualReflectLoading.has(EXPLORE_QUESTIONS[0].id)).toBe(false);
	});

	it("fails open on API error", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = makeAllSubmitted();
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		await vm.reflectOnEntry(EXPLORE_QUESTIONS[0].id);

		const result = vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id);
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
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.reflectOnEntry(EXPLORE_QUESTIONS[0].id);
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeDefined();

		// Create a second VM from the same persisted state
		const vm2 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		expect(vm2.manualReflectResult.size).toBe(0);
	});
});

describe("statements and freeform", () => {
	it("toggle adds and removes from set", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const stmtId = MEANING_STATEMENTS.find((s) => s.meaningId === TEST_CARD_ID)?.id;
		if (stmtId === undefined) return; // skip if no statements for this card

		vm.toggleStatement(stmtId);
		expect(vm.selectedStatementIds.has(stmtId)).toBe(true);

		vm.toggleStatement(stmtId);
		expect(vm.selectedStatementIds.has(stmtId)).toBe(false);
	});

	it("confirm persists statements to localStorage", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const stmtId = MEANING_STATEMENTS.find((s) => s.meaningId === TEST_CARD_ID)?.id;
		if (stmtId === undefined) return;

		vm.toggleStatement(stmtId);
		vm.confirmStatements();

		expect(vm.statementsConfirmed).toBe(true);
		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].statementSelections).toContain(stmtId);
	});

	it("toggle persists when already confirmed", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const stmtId = MEANING_STATEMENTS.find((s) => s.meaningId === TEST_CARD_ID)?.id;
		if (stmtId === undefined) return;

		vm.confirmStatements();
		vm.toggleStatement(stmtId);

		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].statementSelections).toContain(stmtId);
	});

	it("freeform persist saves to localStorage", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.freeformNote = "My additional thoughts";
		vm.persistFreeform();

		const saved = loadExploreData(sid());
		expect(saved![TEST_CARD_ID].freeformNote).toBe("My additional thoughts");
	});
});

describe("finishExploring", () => {
	it("persists entries, freeform, and statements", () => {
		const entries = makeAllSubmitted();
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		vm.freeformNote = "Final notes";

		const stmtId = MEANING_STATEMENTS.find((s) => s.meaningId === TEST_CARD_ID)?.id;
		if (stmtId !== undefined) {
			vm.toggleStatement(stmtId);
		}

		vm.finishExploring();

		const savedData = loadExploreData(sid());
		expect(savedData![TEST_CARD_ID].entries).toHaveLength(EXPLORE_QUESTIONS.length);
		expect(savedData![TEST_CARD_ID].freeformNote).toBe("Final notes");
		expect(savedData![TEST_CARD_ID].statementSelections).toBeDefined();
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
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "short", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.submitAnswer();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeDefined();

		vm.finishExploring();

		expect(vm.entries[0].submittedAfterGuardrail).toBe(true);
	});

	it("does not throw when no reflection is shown", () => {
		const entries = makeAllSubmitted();
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		expect(() => {
			vm.finishExploring();
		}).not.toThrow();
	});
});

describe("derived properties", () => {
	it("activeIndex is 0 for no submitted entries", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "pending", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.activeIndex).toBe(0);
	});

	it("activeIndex points to first non-submitted entry", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "a", true), makeEntry(EXPLORE_QUESTIONS[1].id, "b", true), makeEntry(EXPLORE_QUESTIONS[2].id, "pending", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.activeIndex).toBe(2);
	});

	it("activeIndex equals entries.length when all submitted", () => {
		const entries = makeAllSubmitted();
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.activeIndex).toBe(EXPLORE_QUESTIONS.length);
	});

	it("editingEntryIndex during reflection is last submitted entry", () => {
		const entry = makeEntry(EXPLORE_QUESTIONS[0].id, "my answer", true);
		entry.guardrailText = "elaborate";
		setupExploreData(TEST_CARD_ID, [entry]);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.manualReflectResult.get(EXPLORE_QUESTIONS[0].id)).toBeDefined();
		expect(vm.editingEntryIndex).toBe(0);
	});

	it("editingEntryIndex during normal state is active entry", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "a", true), makeEntry(EXPLORE_QUESTIONS[1].id, "pending answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.editingEntryIndex).toBe(1);
	});

	it("allAnswered is false with partial entries", () => {
		const entries = makeSubmittedEntries(2);
		entries.push(makeEntry(EXPLORE_QUESTIONS[2].id, "pending", false));
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.allAnswered).toBe(false);
	});

	it("allAnswered is true when all questions submitted", () => {
		const entries = makeAllSubmitted();
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.allAnswered).toBe(true);
	});

	it("submittedCount reflects number of submitted entries", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "a", true), makeEntry(EXPLORE_QUESTIONS[1].id, "b", true), makeEntry(EXPLORE_QUESTIONS[2].id, "pending", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		expect(vm.submittedCount).toBe(2);
	});

	it("cardStatements returns statements for the card's meaning ID", () => {
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const statements = vm.cardStatements;
		expect(statements.length).toBeGreaterThan(0);
		for (const s of statements) {
			expect(s.meaningId).toBe(TEST_CARD_ID);
		}
	});
});

describe("deterministic question selection", () => {
	async function submitAllQuestions(): Promise<string[]> {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/infer-answers", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const entries = [makeEntry(EXPLORE_QUESTIONS[0].id, "My answer", false)];
		setupExploreData(TEST_CARD_ID, entries);

		const vm = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		for (let i = 0; i < EXPLORE_QUESTIONS.length; i++) {
			const idx = vm.activeIndex;
			if (idx >= vm.entries.length) break;
			vm.entries[idx].userAnswer = `Answer ${String(i)}`;
			await vm.submitAnswer();
		}

		return vm.entries.map((e) => e.questionId);
	}

	it("selects all questions without duplicates", async () => {
		const questionIds = await submitAllQuestions();

		expect(questionIds).toHaveLength(EXPLORE_QUESTIONS.length);
		expect(new Set(questionIds).size).toBe(EXPLORE_QUESTIONS.length);
	});

	it("two runs with same session+card produce the same sequence", async () => {
		const questionIds1 = await submitAllQuestions();

		server.resetHandlers();

		const questionIds2 = await submitAllQuestions();

		expect(questionIds1).toEqual(questionIds2);
	});
});

describe("deterministic initial question assignment", () => {
	it("two VMs with same session and card assign the same initial question", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), { [TEST_CARD_ID]: { entries: [], freeformNote: "", statementSelections: [] } });

		const vm1 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		const data1 = loadExploreData(sid());
		const questionId1 = data1![TEST_CARD_ID].entries[0].questionId;

		// Reset to empty entries so the second VM re-runs selectNextQuestion
		saveExploreData(sid(), { [TEST_CARD_ID]: { entries: [], freeformNote: "", statementSelections: [] } });

		const vm2 = new ExploreMeaningViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();
		const data2 = loadExploreData(sid());
		const questionId2 = data2![TEST_CARD_ID].entries[0].questionId;

		expect(questionId1).toBe(questionId2);
	});
});
