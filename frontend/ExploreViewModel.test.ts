// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { ExploreViewModel, parseBullets } from "./ExploreViewModel.ts";
import type { ExploreData } from "./store.ts";
import { ensureSessionsInitialized, getActiveSessionId, loadExploreData, lookupCachedSynthesis, saveCachedSynthesis, saveChosenCardIds, saveExploreData } from "./store.ts";

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

function setupDefaultSynthesizeHandler(): void {
	server.use(
		http.post("*/api/synthesize", () => {
			return HttpResponse.json({ synthesis: "A test synthesis" });
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
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.chosenCards).toHaveLength(3);
	});

	it("loads chosen cards in MEANING_CARDS order", () => {
		const cardIds = [MEANING_CARDS[2].id, MEANING_CARDS[0].id, MEANING_CARDS[1].id];
		saveChosenCardIds(sid(), cardIds);
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.chosenCards.map((c) => c.id)).toEqual([MEANING_CARDS[0].id, MEANING_CARDS[1].id, MEANING_CARDS[2].id]);
	});

	it("creates and saves explore data when none exists", () => {
		setupChosenCards(3);
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		const saved = loadExploreData(sid());
		expect(saved).not.toBeNull();
	});

	it("reuses existing explore data when present", () => {
		const cardIds = setupChosenCards(2);
		const exploreData = makeExploreData(cardIds, EXPLORE_QUESTIONS.length);
		saveExploreData(sid(), exploreData);
		setupDefaultSynthesizeHandler();

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
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.totalAnswered).toBe(3);
	});

	it("does not count auto-filled pending answers as answered", () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 1);
		// Second entry has text but is auto-filled and unconfirmed
		data[cardIds[0]].entries[1].userAnswer = "auto-filled answer";
		data[cardIds[0]].entries[1].autoFilledPending = true;
		saveExploreData(sid(), data);
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.totalAnswered).toBe(1);
	});

	it("overallPercent computes correctly", () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 2);
		saveExploreData(sid(), data);
		setupDefaultSynthesizeHandler();

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
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.allComplete).toBe(true);
	});

	it("allComplete is false when some unanswered", () => {
		const cardIds = setupChosenCards(2);
		saveExploreData(sid(), makeExploreData(cardIds, 1));
		setupDefaultSynthesizeHandler();

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
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		expect(vm.cardStatus(cardIds[0])).toBe("partial");
	});

	it("returns 'complete' when all questions answered", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, EXPLORE_QUESTIONS.length));
		setupDefaultSynthesizeHandler();

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
		setupDefaultSynthesizeHandler();

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

describe("synthesis loading", () => {
	it("loads synthesis from API for cards with answered questions", async () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 2));
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const synthesis = vm.cardSynthesis[cardIds[0]];
		expect(synthesis).toBeDefined();
		expect(synthesis!.text).toBe("A test synthesis");
		expect(synthesis!.loading).toBe(false);
		expect(synthesis!.error).toBe("");
	});

	it("sends short: true in the synthesis request", async () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 1));

		let capturedBody: unknown = null;
		server.use(
			http.post("*/api/synthesize", async ({ request }) => {
				capturedBody = await request.json();
				return HttpResponse.json({ synthesis: "Short synthesis" });
			}),
		);

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(capturedBody).toEqual(expect.objectContaining({ short: true }));
	});

	it("uses cached short synthesis instead of fetching", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 1);
		saveExploreData(sid(), data);

		const answer = data[cardIds[0]].entries[0].userAnswer;
		saveCachedSynthesis({ sessionId: sid(), cardId: cardIds[0], fingerprint: answer, synthesis: "Cached synthesis", short: true });

		// No MSW handler — any fetch would fail with onUnhandledRequest: "error"
		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.cardSynthesis[cardIds[0]]!.text).toBe("Cached synthesis");
	});

	it("sets error on fetch failure", async () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 1));
		server.use(
			http.post("*/api/synthesize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const synthesis = vm.cardSynthesis[cardIds[0]];
		expect(synthesis!.error).not.toBe("");
		expect(synthesis!.loading).toBe(false);
	});

	it("does not create synthesis for untouched cards", () => {
		const cardIds = setupChosenCards(1);
		saveExploreData(sid(), makeExploreData(cardIds, 0));

		const vm = new ExploreViewModel(sid());
		vm.initialize();

		expect(vm.cardSynthesis[cardIds[0]]).toBeUndefined();
	});

	it("saves fetched synthesis to cache with short: true", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 1);
		saveExploreData(sid(), data);
		setupDefaultSynthesizeHandler();

		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		const answer = data[cardIds[0]].entries[0].userAnswer;
		const cached = lookupCachedSynthesis({ sessionId: sid(), cardId: cardIds[0], fingerprint: answer, short: true });
		expect(cached).toBe("A test synthesis");
	});

	it("does not collide with normal synthesis cache", async () => {
		const cardIds = setupChosenCards(1);
		const data = makeExploreData(cardIds, 1);
		saveExploreData(sid(), data);

		const answer = data[cardIds[0]].entries[0].userAnswer;
		// Save a normal (non-short) synthesis
		saveCachedSynthesis({ sessionId: sid(), cardId: cardIds[0], fingerprint: answer, synthesis: "Normal synthesis" });

		// Short cache should miss
		setupDefaultSynthesizeHandler();
		const vm = new ExploreViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.cardSynthesis[cardIds[0]]!.text).toBe("A test synthesis");
		// Normal cache should still be intact
		const normalCached = lookupCachedSynthesis({ sessionId: sid(), cardId: cardIds[0], fingerprint: answer });
		expect(normalCached).toBe("Normal synthesis");
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

describe("parseBullets", () => {
	it("parses standard bullet lines", () => {
		expect(parseBullets("- First\n- Second\n- Third")).toEqual(["First", "Second", "Third"]);
	});

	it("returns null for plain text with no bullets", () => {
		expect(parseBullets("Just a plain sentence.")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseBullets("")).toBeNull();
	});

	it("ignores blank lines between bullets", () => {
		expect(parseBullets("- First\n\n- Second")).toEqual(["First", "Second"]);
	});

	it("handles leading whitespace before dash", () => {
		expect(parseBullets("  - Indented\n- Normal")).toEqual(["Indented", "Normal"]);
	});

	it("trims trailing whitespace from bullet text", () => {
		expect(parseBullets("- Trailing space   \n- Clean")).toEqual(["Trailing space", "Clean"]);
	});

	it("skips lines that are just a dash with no text", () => {
		expect(parseBullets("- Real bullet\n- \n- Another")).toEqual(["Real bullet", "Another"]);
	});

	it("returns null when all bullet lines are empty after trimming", () => {
		expect(parseBullets("- \n-  ")).toBeNull();
	});

	it("handles asterisk bullets by returning null", () => {
		expect(parseBullets("* Not a dash bullet\n* Another")).toBeNull();
	});

	it("ignores non-bullet lines mixed with bullet lines", () => {
		expect(parseBullets("Here are my thoughts:\n- First point\n- Second point")).toEqual(["First point", "Second point"]);
	});

	it("handles single bullet", () => {
		expect(parseBullets("- Only one")).toEqual(["Only one"]);
	});

	it("handles LLM adding a trailing newline", () => {
		expect(parseBullets("- First\n- Second\n")).toEqual(["First", "Second"]);
	});
});
