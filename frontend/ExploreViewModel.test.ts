// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { ExploreViewModel } from "./ExploreViewModel.ts";
import type { ExploreData } from "./store.ts";
import { ensureSessionsInitialized, fetchOrGetCachedSummary, getActiveSessionId, loadExploreData, lookupCachedSummary, saveCachedSummary, saveChosenCardIds, saveExploreData } from "./store.ts";

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

function setupChosenCards(count: number): string[] {
	const cardIds = MEANING_CARDS.slice(0, count).map((c) => c.id);
	saveChosenCardIds(sid(), cardIds);
	return cardIds;
}

function makeExploreData(cardIds: string[], answeredCount: number): ExploreData {
	const data: ExploreData = {};
	for (const cardId of cardIds) {
		data[cardId] = {
			entries: EXPLORE_QUESTIONS.map((q, i) => ({
				questionId: q.id,
				userAnswer: i < answeredCount ? `Answer for ${q.id}` : "",
				prefilledAnswer: "",
				submitted: i < answeredCount,
				guardrailText: "",
				submittedAfterGuardrail: false,
				thoughtBubbleText: "",
				thoughtBubbleAcknowledged: false,
				autoFilledPending: false,
			})),
			freeformNote: "",
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
	it("returns 'no-data' when no chosen cards in localStorage", () => {
		const vm = new ExploreViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'ready' when chosen cards exist", () => {
		setupChosenCards(3);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.chosenCards).toHaveLength(3);
	});

	it("loads chosen cards in MEANING_CARDS order", () => {
		const cardIds = [MEANING_CARDS[2].id, MEANING_CARDS[0].id, MEANING_CARDS[1].id];
		saveChosenCardIds(sid(), cardIds);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.chosenCards.map((c) => c.id)).toEqual([MEANING_CARDS[0].id, MEANING_CARDS[1].id, MEANING_CARDS[2].id]);
	});

	it("creates and saves explore data when none exists", () => {
		setupChosenCards(3);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		const saved = loadExploreData(sid());
		expect(saved).not.toBeNull();
	});

	it("reuses existing explore data when present", () => {
		const cardIds = setupChosenCards(2);
		const exploreData = makeExploreData(cardIds, EXPLORE_QUESTIONS.length);
		saveExploreData(sid(), exploreData);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		const saved = loadExploreData(sid());
		expect(saved).toEqual(exploreData);
	});

	it("returns 'no-data' on corrupt data", () => {
		localStorage.setItem(`somecam:${sid()}:chosen-card-ids`, "not-valid-json{{{");

		const vm = new ExploreViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});
});

describe("progress tracking", () => {
	it("totalQuestions equals cards * EXPLORE_QUESTIONS.length", () => {
		const cardIds = setupChosenCards(3);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.totalQuestions).toBe(3 * EXPLORE_QUESTIONS.length);
	});

	it("totalAnswered counts answered entries across cards", () => {
		const cardIds = setupChosenCards(2);
		const data = makeExploreData(cardIds, 0);
		data[cardIds[0]].entries[0].userAnswer = "answer 1";
		data[cardIds[0]].entries[1].userAnswer = "answer 2";
		data[cardIds[1]].entries[0].userAnswer = "answer 3";
		saveExploreData(sid(), data);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.totalAnswered).toBe(3);
	});

	it("overallPercent computes correctly", () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 2);
		saveExploreData(sid(), data);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.overallPercent).toBe(Math.round((2 / EXPLORE_QUESTIONS.length) * 100));
	});

	it("overallPercent is 0 when no cards", () => {
		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.overallPercent).toBe(0);
	});

	it("allComplete is true when all questions answered", () => {
		const cardIds = setupChosenCards(2);
		saveExploreData(sid(), makeExploreData(cardIds, EXPLORE_QUESTIONS.length));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.allComplete).toBe(true);
	});

	it("allComplete is false when some unanswered", () => {
		const cardIds = setupChosenCards(2);
		saveExploreData(sid(), makeExploreData(cardIds, 1));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.allComplete).toBe(false);
	});
});

describe("cardStatus", () => {
	it("returns 'untouched' when no answers for card", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.cardStatus(cardIds[0])).toBe("untouched");
	});

	it("returns 'partial' when some but not all answered", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 2));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.cardStatus(cardIds[0])).toBe("partial");
	});

	it("returns 'complete' when all questions answered", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, EXPLORE_QUESTIONS.length));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.cardStatus(cardIds[0])).toBe("complete");
	});
});

describe("sortedCards", () => {
	it("places completed cards last", () => {
		const cardIds = setupChosenCards(3);
		const data = makeExploreData(cardIds, 0);
		// Card 0: complete, Card 1: untouched, Card 2: partial
		for (let i = 0; i < EXPLORE_QUESTIONS.length; i++) {
			data[cardIds[0]].entries[i].userAnswer = `answer ${String(i)}`;
			data[cardIds[0]].entries[i].submitted = true;
		}
		data[cardIds[2]].entries[0].userAnswer = "partial answer";
		data[cardIds[2]].entries[0].submitted = true;
		saveExploreData(sid(), data);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		const sortedIds = vm.sortedCards.map((c) => c.id);
		expect(sortedIds[sortedIds.length - 1]).toBe(cardIds[0]);
	});

	it("preserves MEANING_CARDS order among non-complete cards", () => {
		const cardIds = setupChosenCards(3);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.sortedCards.map((c) => c.id)).toEqual(cardIds);
	});
});

describe("summary loading", () => {
	it("loads summaries from API for answered questions", async () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 2));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const entries = vm.cardSummaryEntries[cardIds[0]];
		expect(entries).toBeDefined();
		const answeredEntries = entries!.filter((e) => !e.unanswered);
		expect(answeredEntries).toHaveLength(2);
		for (const entry of answeredEntries) {
			expect(entry.summary).not.toBe("");
			expect(entry.loading).toBe(false);
			expect(entry.error).toBe("");
		}
	});

	it("uses cached summaries instead of fetching", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 1);
		saveExploreData(sid(), data);

		const questionId = EXPLORE_QUESTIONS[0].id;
		const answer = data[cardIds[0]].entries[0].userAnswer;
		saveCachedSummary({ sessionId: sid(), cardId: cardIds[0], answer, summary: "Cached summary", questionId });

		// No MSW handler — any fetch would fail with onUnhandledRequest: "error"
		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const entries = vm.cardSummaryEntries[cardIds[0]];
		expect(entries![0].summary).toBe("Cached summary");
	});

	it("sets error on fetch failure", async () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 1));
		server.use(
			http.post("*/api/summarize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const entries = vm.cardSummaryEntries[cardIds[0]];
		const answeredEntry = entries!.find((e) => !e.unanswered);
		expect(answeredEntry!.error).not.toBe("");
		expect(answeredEntry!.loading).toBe(false);
	});

	it("marks unanswered questions on partial cards", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 2));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		const entries = vm.cardSummaryEntries[cardIds[0]];
		expect(entries).toBeDefined();
		const answered = entries!.filter((e) => !e.unanswered);
		const unanswered = entries!.filter((e) => e.unanswered);
		expect(answered).toHaveLength(2);
		expect(unanswered).toHaveLength(EXPLORE_QUESTIONS.length - 2);
	});

	it("unanswered entries follow EXPLORE_QUESTIONS order", () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 0);
		// Answer only the last question
		data[cardIds[0]].entries[EXPLORE_QUESTIONS.length - 1].userAnswer = "answer";
		saveExploreData(sid(), data);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		const entries = vm.cardSummaryEntries[cardIds[0]];
		const unanswered = entries!.filter((e) => e.unanswered);
		const unansweredIds = unanswered.map((e) => e.questionId);
		const expectedIds = EXPLORE_QUESTIONS.slice(0, -1).map((q) => q.id);
		expect(unansweredIds).toEqual(expectedIds);
	});

	it("does not create summary entries for untouched cards", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.cardSummaryEntries[cardIds[0]]).toBeUndefined();
	});

	it("saves fetched summaries to cache", async () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 1));
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const questionId = EXPLORE_QUESTIONS[0].id;
		const answer = `Answer for ${questionId}`;
		const cached = lookupCachedSummary({ sessionId: sid(), cardId: cardIds[0], answer, questionId });
		expect(cached).not.toBeNull();
		expect(cached).not.toBe("");
	});
});

describe("freeform summary loading", () => {
	it("loads freeform summary from API", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 1);
		data[cardIds[0]].freeformNote = "My freeform notes";
		saveExploreData(sid(), data);
		setupDefaultSummarizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const freeform = vm.cardFreeformSummary[cardIds[0]];
		expect(freeform).toBeDefined();
		expect(freeform!.summary).not.toBe("");
		expect(freeform!.loading).toBe(false);
		expect(freeform!.error).toBe("");
	});

	it("uses cached freeform summary", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 0);
		const noteText = "My freeform notes";
		data[cardIds[0]].freeformNote = noteText;
		saveExploreData(sid(), data);
		saveCachedSummary({ sessionId: sid(), cardId: cardIds[0], answer: noteText, summary: "Cached freeform" });

		// No MSW handler — any fetch would fail
		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.cardFreeformSummary[cardIds[0]]!.summary).toBe("Cached freeform");
	});

	it("sets error on freeform fetch failure", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 0);
		data[cardIds[0]].freeformNote = "My notes";
		saveExploreData(sid(), data);
		server.use(
			http.post("*/api/summarize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.cardFreeformSummary[cardIds[0]]!.error).not.toBe("");
		expect(vm.cardFreeformSummary[cardIds[0]]!.loading).toBe(false);
	});

	it("does not create freeform entry when no notes exist", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.cardFreeformSummary[cardIds[0]]).toBeUndefined();
	});

	it("does not create freeform entry for empty string notes", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));
		// freeformNote defaults to "" in makeExploreData, so no change needed

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.cardFreeformSummary[cardIds[0]]).toBeUndefined();
	});
});

describe("fetchOrGetCachedSummary", () => {
	it("returns cached summary without fetching", async () => {
		saveCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", summary: "Cached", questionId: "interpretation" });

		// No MSW handler — any fetch would fail with onUnhandledRequest: "error"
		const result = await fetchOrGetCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", questionId: "interpretation" });
		expect(result).toBe("Cached");
	});

	it("fetches from API and saves to cache on miss", async () => {
		setupDefaultSummarizeHandler();

		const result = await fetchOrGetCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", questionId: "interpretation" });
		expect(result).toBe("A test summary");

		const cached = lookupCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", questionId: "interpretation" });
		expect(cached).toBe("A test summary");
	});

	it("deduplicates concurrent fetches for the same key", async () => {
		let callCount = 0;
		server.use(
			http.post("*/api/summarize", () => {
				callCount++;
				return HttpResponse.json({ summary: "Deduped summary" });
			}),
		);

		const p1 = fetchOrGetCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "Same answer", questionId: "interpretation" });
		const p2 = fetchOrGetCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "Same answer", questionId: "interpretation" });

		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe("Deduped summary");
		expect(r2).toBe("Deduped summary");
		expect(callCount).toBe(1);
	});
});

describe("action methods", () => {
	it("onExploreCard does not throw", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(() => {
			vm.onExploreCard(cardIds[0]);
		}).not.toThrow();
	});

	it("onEditSelection does not throw", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(() => {
			vm.onEditSelection();
		}).not.toThrow();
	});

	it("onOpenReport does not throw", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(() => {
			vm.onOpenReport("test_source");
		}).not.toThrow();
	});
});
