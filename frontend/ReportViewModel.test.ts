// @vitest-environment node

import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { ReportViewModel } from "./ReportViewModel.ts";
import type { ExploreData } from "./store.ts";
import { ensureSessionsInitialized, getActiveSessionId, saveCachedSynthesis, saveChosenCardIds, saveExploreData } from "./store.ts";

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

function setupDefaultSynthesizeHandler(): void {
	server.use(
		http.post("*/api/synthesize", () => {
			return HttpResponse.json({ synthesis: "A test synthesis" });
		}),
	);
}

describe("initialize", () => {
	it("returns 'no-data' when no chosen cards", () => {
		const vm = new ReportViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'ready' with valid data and cached synthesis", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));

		const fingerprint = EXPLORE_QUESTIONS.map((q) => `Answer for ${q.id}`).join("\x00");
		saveCachedSynthesis({ sessionId: sid(), cardId: TEST_CARD_ID, fingerprint, synthesis: "Cached synthesis" });

		const vm = new ReportViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.reports).toHaveLength(1);
		expect(vm.reports[0].card.id).toBe(TEST_CARD_ID);
		expect(vm.reports[0].synthesis).toBe("Cached synthesis");
		expect(vm.loading).toBe(false);
	});

	it("returns 'ready' with empty reports when no explore data", () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);

		const vm = new ReportViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.reports).toHaveLength(1);
		expect(vm.reports[0].synthesis).toBe("");
	});
});

describe("synthesis loading", () => {
	it("fetches synthesis from API on cache miss", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		setupDefaultSynthesizeHandler();

		const vm = new ReportViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.reports).toHaveLength(1);
		expect(vm.reports[0].synthesis).toBe("A test synthesis");
		expect(vm.loading).toBe(false);
	});

	it("uses cached synthesis without API call", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));

		const fingerprint = EXPLORE_QUESTIONS.map((q) => `Answer for ${q.id}`).join("\x00");
		saveCachedSynthesis({ sessionId: sid(), cardId: TEST_CARD_ID, fingerprint, synthesis: "Cached synthesis" });

		// No MSW handler — any fetch would fail
		const vm = new ReportViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.reports[0].synthesis).toBe("Cached synthesis");
	});

	it("handles fetch failure gracefully with empty synthesis", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID]));
		server.use(
			http.post("*/api/synthesize", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const vm = new ReportViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.reports[0].synthesis).toBe("");
		expect(vm.loading).toBe(false);
	});

	it("includes freeform note in fingerprint", async () => {
		saveChosenCardIds(sid(), [TEST_CARD_ID]);
		saveExploreData(sid(), makeFullExploreData([TEST_CARD_ID], "My notes"));

		const fingerprint = [...EXPLORE_QUESTIONS.map((q) => `Answer for ${q.id}`), "My notes"].join("\x00");
		saveCachedSynthesis({ sessionId: sid(), cardId: TEST_CARD_ID, fingerprint, synthesis: "Synthesis with notes" });

		const vm = new ReportViewModel(sid());
		vm.initialize();
		await vm.whenReady;

		expect(vm.reports[0].synthesis).toBe("Synthesis with notes");
	});

	it("batches all synthesis fetches before populating reports", async () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		saveChosenCardIds(sid(), cardIds);
		saveExploreData(sid(), makeFullExploreData(cardIds));

		let resolveFirst!: () => void;
		let resolveSecond!: () => void;
		let firstCalledResolve!: () => void;
		let secondCalledResolve!: () => void;
		const firstHandlerCalled = new Promise<void>((r) => {
			firstCalledResolve = r;
		});
		const secondHandlerCalled = new Promise<void>((r) => {
			secondCalledResolve = r;
		});
		let callCount = 0;

		server.use(
			http.post("*/api/synthesize", () => {
				callCount++;
				if (callCount === 1) {
					return new Promise((resolve) => {
						resolveFirst = () => {
							resolve(HttpResponse.json({ synthesis: "Synthesis 1" }));
						};
						firstCalledResolve();
					});
				}
				return new Promise((resolve) => {
					resolveSecond = () => {
						resolve(HttpResponse.json({ synthesis: "Synthesis 2" }));
					};
					secondCalledResolve();
				});
			}),
		);

		const vm = new ReportViewModel(sid());
		vm.initialize();

		// Reports are empty until all fetches complete
		expect(vm.reports).toHaveLength(0);
		expect(vm.loading).toBe(true);

		await firstHandlerCalled;
		resolveFirst();
		// Wait a tick — still waiting for second
		await secondHandlerCalled;
		expect(vm.reports).toHaveLength(0);

		resolveSecond();
		await vm.whenReady;

		expect(vm.reports).toHaveLength(2);
		expect(vm.loading).toBe(false);
	});
});
