// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { ExploreCompleteViewModel } from "./ExploreCompleteViewModel.ts";
import type { ExploreData } from "./store.ts";
import { ensureSessionsInitialized, getActiveSessionId, saveCachedSummary, saveChosenCardIds, saveExploreData } from "./store.ts";

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

function makeFullExploreData(cardIds: string[], freeformNote = ""): ExploreData {
	const data: ExploreData = {};
	for (const cardId of cardIds) {
		data[cardId] = {
			entries: EXPLORE_QUESTIONS.map((q) => ({
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
			statementSelections: [],
		};
	}
	return data;
}

function setupDefaultSummarizeHandler(): void {
	server.use(
		http.post("*/api/summarize", () => {
			return HttpResponse.json({ summary: "A test summary" });
		}),
	);
}

describe("initialize", () => {
	it("returns 'no-data' for unknown card ID", () => {
		const vm = new ExploreCompleteViewModel(sid(), "nonexistent-card");
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when no chosen cards", () => {
		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when no explore data", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when card has no explore data entry", () => {
		const otherCard = MEANING_CARDS[1].id;
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([otherCard]));
		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when card is only partially explored", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		const data: ExploreData = {
			[TEST_CARD_ID]: {
				entries: [
					{
						questionId: EXPLORE_QUESTIONS[0].id,
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
				statementSelections: [],
			},
		};
		saveExploreData(sid(), data);
		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'ready' with valid data", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		expect(vm.initialize()).toBe("ready");
		expect(vm.card).toBeDefined();
		expect(vm.card!.id).toBe(TEST_CARD_ID);
	});
});

describe("summary loading", () => {
	it("loads summaries from API", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.summaryEntries).toHaveLength(EXPLORE_QUESTIONS.length);
		for (const entry of vm.summaryEntries) {
			expect(entry.summary).toBe("A test summary");
			expect(entry.loading).toBe(false);
		}
	});

	it("uses cached summaries", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));

		for (const q of EXPLORE_QUESTIONS) {
			saveCachedSummary({ sessionId: sid(), cardId: TEST_CARD_ID, answer: `Answer for ${q.id}`, summary: `Cached ${q.id}`, questionId: q.id });
		}

		// No MSW handler — any fetch would fail
		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		for (const entry of vm.summaryEntries) {
			expect(entry.summary).toBe(`Cached ${entry.questionId}`);
		}
	});

	it("sets error on fetch failure", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		server.use(
			http.post("*/api/summarize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		for (const entry of vm.summaryEntries) {
			expect(entry.error).not.toBe("");
			expect(entry.loading).toBe(false);
		}
	});

	it("loads freeform summary when note exists", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID], "My notes"));
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();
		await vm.whenReady;

		expect(vm.freeformSummary).not.toBeNull();
		expect(vm.freeformSummary!.summary).toBe("A test summary");
	});

	it("does not create freeform summary when note is empty", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		expect(vm.freeformSummary).toBeNull();
	});
});

describe("progress", () => {
	it("counts explored cards correctly", () => {
		const cardIds = MEANING_CARDS.slice(0, 3).map((c) => c.id);
		saveChosenCardIds(sid(), cardIds);
		// Only first two cards fully explored
		const data = makeFullExploreData(cardIds.slice(0, 2));
		data[cardIds[2]] = {
			entries: [
				{
					questionId: EXPLORE_QUESTIONS[0].id,
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
			statementSelections: [],
		};
		saveExploreData(sid(), data);
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), cardIds[0]);
		vm.initialize();

		expect(vm.exploredCount).toBe(2);
		expect(vm.totalCount).toBe(3);
		expect(vm.allComplete).toBe(false);
	});

	it("allComplete is true when all cards fully explored", () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		saveChosenCardIds(sid(), cardIds);
		saveExploreData(sid(), makeFullExploreData(cardIds));
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), cardIds[0]);
		vm.initialize();

		expect(vm.allComplete).toBe(true);
		expect(vm.exploredCount).toBe(2);
	});
});

describe("warmPhrase", () => {
	it("returns a string from the known set", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		setupDefaultSummarizeHandler();

		const vm = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm.initialize();

		const knownPhrases = ["Here's what you reflected on", "A look at what came up for you", "Your reflections, distilled", "What emerged from your exploration", "A snapshot of your thoughts"];
		expect(knownPhrases).toContain(vm.warmPhrase);
	});

	it("is deterministic for the same inputs", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		setupDefaultSummarizeHandler();

		const vm1 = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm1.initialize();
		const vm2 = new ExploreCompleteViewModel(sid(), TEST_CARD_ID);
		vm2.initialize();

		expect(vm1.warmPhrase).toBe(vm2.warmPhrase);
	});
});
