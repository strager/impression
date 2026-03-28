// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { ExamineCompleteViewModel } from "./ExamineCompleteViewModel.ts";
import type { ExamineData } from "./store.ts";
import { ensureProfilesInitialized, getActiveProfileId, hasVisitedExamineComplete, saveCachedSynthesis, saveChosenCardIds, saveExamineData } from "./store.ts";

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

function makeFullExamineData(cardIds: string[], freeformNote = ""): ExamineData {
	const data: ExamineData = {};
	for (const cardId of cardIds) {
		data[cardId] = {
			entries: EXAMINE_QUESTIONS.map((q) => ({
				questionId: q.id,
				userAnswer: `Answer for ${q.id}`,
				prefilledAnswer: "",
				submitted: true,
				guardrailText: "",
				submittedAfterGuardrail: false,
				thoughtBubbleText: "",
				thoughtBubbleAcknowledged: false,
				autoFilledPending: false,
			})),
			freeformNote,
			descriptionSelections: [],
		};
	}
	return data;
}

function setupDefaultSynthesizeHandler(): void {
	server.use(
		http.post("*/api/synthesize", () => {
			return HttpResponse.json({ synthesis: "A test synthesis" });
		}),
	);
}

describe("initialize", () => {
	it("returns 'no-data' for unknown card ID", () => {
		const vm = new ExamineCompleteViewModel(sid(), "nonexistent-card");
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when no chosen cards", () => {
		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when no examine data", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when card has no examine data entry", () => {
		const otherCard = MEANING_CARDS[1].id;
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([otherCard]));
		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when card is only partially examined", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		const data: ExamineData = {
			[TEST_CARD_ID]: {
				entries: [
					{
						questionId: EXAMINE_QUESTIONS[0].id,
						userAnswer: "partial answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: "",
						submittedAfterGuardrail: false,
						thoughtBubbleText: "",
						thoughtBubbleAcknowledged: false,
						autoFilledPending: false,
					},
				],
				freeformNote: "",
				descriptionSelections: [],
			},
		};
		saveExamineData(sid(), data);
		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'ready' with valid data", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		setupDefaultSynthesizeHandler();

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.card).toBeDefined();
		expect(vm.card!.id).toBe(TEST_CARD_ID);
	});
});

describe("synthesis loading", () => {
	it("loads synthesis from API", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		setupDefaultSynthesizeHandler();

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.synthesis).toBe("A test synthesis");
		expect(vm.synthesisLoading).toBe(false);
	});

	it("uses cached synthesis", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));

		const fingerprint = EXAMINE_QUESTIONS.map((q) => `Answer for ${q.id}`).join("\x00");
		saveCachedSynthesis({ profileId: sid(), cardId: TEST_CARD_ID, fingerprint, synthesis: "Cached synthesis" });

		// No MSW handler — any fetch would fail
		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.synthesis).toBe("Cached synthesis");
	});

	it("sets error on fetch failure", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		server.use(
			http.post("*/api/synthesize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.synthesisError).not.toBe("");
		expect(vm.synthesisLoading).toBe(false);
	});

	it("includes freeform note in synthesis fingerprint", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID], "My notes"));

		const fingerprint = [...EXAMINE_QUESTIONS.map((q) => `Answer for ${q.id}`), "My notes"].join("\x00");
		saveCachedSynthesis({ profileId: sid(), cardId: TEST_CARD_ID, fingerprint, synthesis: "Synthesis with notes" });

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.synthesis).toBe("Synthesis with notes");
	});
});

describe("retrySynthesis", () => {
	it("retries after initial failure and loads synthesis", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		server.use(
			http.post("*/api/synthesize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.synthesisError).not.toBe("");
		expect(vm.synthesisLoading).toBe(false);

		// Swap to a working handler and retry
		server.use(
			http.post("*/api/synthesize", () => {
				return HttpResponse.json({ synthesis: "Retried synthesis" });
			}),
		);

		vm.retrySynthesis();
		expect(vm.synthesisError).toBe("");
		expect(vm.synthesisLoading).toBe(true);

		await vm.whenReady;

		expect(vm.synthesis).toBe("Retried synthesis");
		expect(vm.synthesisLoading).toBe(false);
	});
});

describe("progress", () => {
	it("counts examined cards correctly", () => {
		const cardIds = MEANING_CARDS.slice(0, 3).map((c) => c.id);
		saveChosenCardIds(sid(), cardIds);
		// Only first two cards fully examined
		const data = makeFullExamineData(cardIds.slice(0, 2));
		data[cardIds[2]] = {
			entries: [
				{
					questionId: EXAMINE_QUESTIONS[0].id,
					userAnswer: "partial",
					prefilledAnswer: "",
					submitted: true,
					guardrailText: "",
					submittedAfterGuardrail: false,
					thoughtBubbleText: "",
					thoughtBubbleAcknowledged: false,
					autoFilledPending: false,
				},
			],
			freeformNote: "",
			descriptionSelections: [],
		};
		saveExamineData(sid(), data);
		setupDefaultSynthesizeHandler();

		const vm = new ExamineCompleteViewModel(sid(), cardIds[0]);
		vm.initialize();

		expect(vm.examinedCount).toBe(2);
		expect(vm.totalCount).toBe(3);
		expect(vm.allComplete).toBe(false);
	});

	it("allComplete is true when all cards fully examined", () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		saveChosenCardIds(sid(), cardIds);
		saveExamineData(sid(), makeFullExamineData(cardIds));
		setupDefaultSynthesizeHandler();

		const vm = new ExamineCompleteViewModel(sid(), cardIds[0]);
		vm.initialize();

		expect(vm.allComplete).toBe(true);
		expect(vm.examinedCount).toBe(2);
	});
});

describe("onAnimationComplete", () => {
	it("marks the card as visited in store", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		setupDefaultSynthesizeHandler();

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		expect(vm.hasBeenVisited).toBe(false);
		vm.onAnimationComplete();
		expect(vm.hasBeenVisited).toBe(true);
		expect(hasVisitedExamineComplete(sid(), TEST_CARD_ID)).toBe(true);
	});
});

describe("warmPhrase", () => {
	it("returns a string from the known set", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		setupDefaultSynthesizeHandler();

		const vm = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const knownPhrases = ["Here's what you reflected on", "A look at what came up for you", "Your reflections, distilled", "What emerged from your examination", "A snapshot of your thoughts"];
		expect(knownPhrases).toContain(vm.warmPhrase);
	});

	it("is deterministic for the same inputs", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExamineData(sid(), makeFullExamineData([TEST_CARD_ID]));
		setupDefaultSynthesizeHandler();

		const vm1 = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		const vm2 = new ExamineCompleteViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();

		expect(vm1.warmPhrase).toBe(vm2.warmPhrase);
	});
});
