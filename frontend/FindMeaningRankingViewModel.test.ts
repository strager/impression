// @vitest-environment node

import { Window } from "happy-dom";
import { watchSyncEffect } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { FindMeaningRankingViewModel } from "./FindMeaningRankingViewModel.ts";
import { ensureSessionsInitialized, getActiveSessionId, loadChosenCardIds, loadRanking, saveRanking, saveSwipeProgress } from "./store.ts";

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

function setupSwipeProgressAllSwiped(cardIds: string[]): void {
	saveSwipeProgress(sid(), {
		shuffledCardIds: cardIds,
		swipeHistory: cardIds.map((id) => ({ cardId: id, direction: "agree" as const })),
	});
}

beforeEach(() => {
	currentWindow = new Window({ url: "http://localhost" });
	setGlobalDom(currentWindow);
	ensureSessionsInitialized();
});

afterEach(() => {
	currentWindow?.close();
	currentWindow = null;
});

describe("initialize", () => {
	it("returns 'no-data' when sorting isn't complete", async () => {
		const vm = new FindMeaningRankingViewModel(sid());
		expect(await vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when swipe progress exists but not all cards swiped", async () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		saveSwipeProgress(sid(), {
			shuffledCardIds: cardIds,
			swipeHistory: [{ cardId: cardIds[0], direction: "agree" }],
		});
		const vm = new FindMeaningRankingViewModel(sid());
		expect(await vm.initialize()).toBe("no-data");
	});

	it("returns 'skip' when <=5 candidate cards", async () => {
		const cardIds = MEANING_CARDS.slice(0, 4).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		expect(await vm.initialize()).toBe("skip");
		expect(loadChosenCardIds(sid())).toEqual(cardIds);
	});

	it("returns 'ready' when >5 cards, populates currentPair", async () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		expect(await vm.initialize()).toBe("ready");
		expect(vm.currentPair).not.toBeNull();
		expect(vm.currentPair!.length).toBe(2);
		expect(vm.round).toBe(0);
		expect(vm.isComplete).toBe(false);
	});

	it("resumes from saved comparison history", async () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		saveRanking(sid(), {
			cardIds,
			comparisons: [{ winner: cardIds[0], loser: cardIds[1] }],
			complete: false,
		});
		const vm = new FindMeaningRankingViewModel(sid());
		expect(await vm.initialize()).toBe("ready");
		expect(vm.round).toBe(1);
		expect(vm.canUndo).toBe(true);
	});
});

describe("choose", () => {
	async function setupVm(): Promise<FindMeaningRankingViewModel> {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		await vm.initialize();
		return vm;
	}

	it("advances round and persists to localStorage", async () => {
		const vm = await setupVm();
		await vm.choose(0);
		expect(vm.round).toBe(1);
		const saved = loadRanking(sid());
		expect(saved).not.toBeNull();
		expect(saved!.comparisons).toHaveLength(1);
	});

	it("throws when isComplete", async () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		// Build many comparisons to trigger max-comparisons stop
		const comparisons = [];
		for (let i = 0; i < 80; i++) {
			comparisons.push({ winner: cardIds[0], loser: cardIds[1] });
		}
		saveRanking(sid(), { cardIds, comparisons, complete: false });
		const vm = new FindMeaningRankingViewModel(sid());
		await vm.initialize();
		// After replaying 80 comparisons, it should be stopped
		expect(vm.isComplete).toBe(true);
		await expect(vm.choose(0)).rejects.toThrow();
	});
});

describe("undo", () => {
	async function setupVm(): Promise<FindMeaningRankingViewModel> {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		await vm.initialize();
		return vm;
	}

	it("throws when no comparisons", async () => {
		const vm = await setupVm();
		await expect(vm.undo()).rejects.toThrow();
	});

	it("decrements round", async () => {
		const vm = await setupVm();
		await vm.choose(0);
		expect(vm.round).toBe(1);
		await vm.undo();
		expect(vm.round).toBe(0);
		expect(vm.canUndo).toBe(false);
	});

	it("persists to localStorage", async () => {
		const vm = await setupVm();
		await vm.choose(0);
		await vm.undo();
		const saved = loadRanking(sid());
		expect(saved).not.toBeNull();
		expect(saved!.comparisons).toHaveLength(0);
	});
});

describe("finalize", () => {
	it("saves chosen cards via loadChosenCardIds", async () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		await vm.initialize();

		// Make comparisons until complete
		while (!vm.isComplete) {
			await vm.choose(0);
		}
		vm.finalize();
		const chosen = loadChosenCardIds(sid());
		expect(chosen).not.toBeNull();
		expect(chosen!.length).toBe(5);
	});
});

describe("full ranking run", () => {
	it("completes ranking with 7 cards, picking lexicographically lowest card", async () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		await vm.initialize();

		while (!vm.isComplete) {
			const pair = vm.currentPair!;
			// Pick the card with lexicographically lower ID
			const index = pair[0].id <= pair[1].id ? 0 : 1;
			await vm.choose(index);
		}

		expect(vm.topK.length).toBe(5);
		vm.finalize();
		const chosen = loadChosenCardIds(sid());
		expect(chosen).not.toBeNull();
		expect(chosen!.length).toBe(5);
	});

	it("shows isComplete reactively when resuming a finished ranking", async () => {
		// Complete a ranking and save the result.
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm1 = new FindMeaningRankingViewModel(sid());
		await vm1.initialize();
		while (!vm1.isComplete) {
			await vm1.choose(0);
		}
		// vm1 saved the completed ranking to localStorage.

		// Simulate a page refresh: create a new ViewModel and initialize it.
		const vm2 = new FindMeaningRankingViewModel(sid());

		// Track what Vue's reactivity system sees for isComplete.
		let isComplete: boolean | undefined;
		watchSyncEffect(() => {
			isComplete = vm2.isComplete;
		});

		// Before initialize, isComplete should be false.
		expect(isComplete).toBe(false);

		await vm2.initialize();

		// After replaying a completed ranking, the reactive value of
		// isComplete must be true so Vue re-renders to the end-state.
		expect(isComplete).toBe(true);
	});
});
