// @vitest-environment node

import { Window } from "happy-dom";
import { watchSyncEffect } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { FindMeaningRankingViewModel } from "./FindMeaningRankingViewModel.ts";
import { ensureProfilesInitialized, getActiveProfileId, loadChosenCardIds, loadRanking, saveRanking, saveSwipeProgress } from "./store.ts";

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

function setupSwipeProgressAllSwiped(cardIds: string[]): void {
	saveSwipeProgress(sid(), {
		shuffledCardIds: cardIds,
		swipeHistory: cardIds.map((id) => ({ cardId: id, direction: "agree" as const })),
	});
}

beforeEach(() => {
	currentWindow = new Window({ url: "http://localhost" });
	setGlobalDom(currentWindow);
	ensureProfilesInitialized();
});

afterEach(() => {
	currentWindow?.close();
	currentWindow = null;
});

describe("initialize", () => {
	it("returns 'no-data' when sorting isn't complete", () => {
		const vm = new FindMeaningRankingViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when swipe progress exists but not all cards swiped", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		saveSwipeProgress(sid(), {
			shuffledCardIds: cardIds,
			swipeHistory: [{ cardId: cardIds[0], direction: "agree" }],
		});
		const vm = new FindMeaningRankingViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'skip' when <=5 candidate cards", () => {
		const cardIds = MEANING_CARDS.slice(0, 4).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		expect(vm.initialize()).toBe("skip");
		expect(loadChosenCardIds(sid())).toEqual(cardIds);
	});

	it("returns 'ready' when >5 cards, populates currentTask", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.currentTask).not.toBeNull();
		expect(vm.currentTask!.length).toBe(3);
		expect(vm.round).toBe(0);
		expect(vm.isComplete).toBe(false);
	});

	it("resumes from saved comparison history", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		saveRanking(sid(), {
			cardIds,
			comparisons: [{ set: [cardIds[0], cardIds[1], cardIds[2]], best: cardIds[0], worst: cardIds[2] }],
			complete: false,
		});
		const vm = new FindMeaningRankingViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.round).toBe(1);
		expect(vm.canUndo).toBe(true);
	});
});

describe("choose", () => {
	function setupVm(): FindMeaningRankingViewModel {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		vm.initialize();
		return vm;
	}

	it("choose with best and worst advances round", () => {
		const vm = setupVm();
		expect(vm.round).toBe(0);

		const task = vm.currentTask!;
		const worstIndex = task.length - 1;
		vm.choose(0, worstIndex);
		expect(vm.round).toBe(1);

		const saved = loadRanking(sid());
		expect(saved).not.toBeNull();
		expect(saved!.comparisons).toHaveLength(1);
	});

	it("throws when isComplete", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		// Build many comparisons to trigger max-tasks stop
		const comparisons = [];
		for (let i = 0; i < 40; i++) {
			comparisons.push({ set: [cardIds[0], cardIds[1], cardIds[2]], best: cardIds[0], worst: cardIds[2] });
		}
		saveRanking(sid(), { cardIds, comparisons, complete: false });
		const vm = new FindMeaningRankingViewModel(sid());
		vm.initialize();
		// After replaying 40 tasks, it should be stopped
		expect(vm.isComplete).toBe(true);
		expect(() => {
			vm.choose(0, 2);
		}).toThrow();
	});
});

describe("undo", () => {
	function setupVm(): FindMeaningRankingViewModel {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		vm.initialize();
		return vm;
	}

	it("throws when no tasks and in best phase", () => {
		const vm = setupVm();
		expect(() => vm.undo()).toThrow();
	});

	it("decrements round after a task", () => {
		const vm = setupVm();
		const task = vm.currentTask!;
		vm.choose(0, task.length - 1);
		expect(vm.round).toBe(1);

		vm.undo();
		expect(vm.round).toBe(0);
		expect(vm.canUndo).toBe(false);
	});

	it("persists forward comparisons and activeRound to localStorage", () => {
		const vm = setupVm();
		const task = vm.currentTask!;
		vm.choose(0, task.length - 1);

		vm.undo();
		const saved = loadRanking(sid());
		expect(saved).not.toBeNull();
		expect(saved!.comparisons).toHaveLength(1);
		expect(saved!.activeRound).toBe(0);
	});
});

describe("pendingRedo", () => {
	function setupVm(): FindMeaningRankingViewModel {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		vm.initialize();
		return vm;
	}

	it("returns null when no forward history exists", () => {
		const vm = setupVm();
		expect(vm.pendingRedo).toBeNull();
	});

	it("returns undone task data after undo", () => {
		const vm = setupVm();
		const task = vm.currentTask!;
		vm.choose(0, task.length - 1);
		const { bestId, worstId } = vm.undo();
		const redo = vm.pendingRedo;
		expect(redo).not.toBeNull();
		expect(redo!.bestId).toBe(bestId);
		expect(redo!.worstId).toBe(worstId);
	});

	it("undo twice then choose: pendingRedo returns second undone task data", () => {
		const vm = setupVm();
		const task1 = vm.currentTask!;
		vm.choose(0, task1.length - 1);
		const task2 = vm.currentTask!;
		vm.choose(0, task2.length - 1);

		const undo2 = vm.undo();
		vm.undo();

		// Re-advance with same choice as round 0
		vm.choose(0, vm.currentTask!.length - 1);

		const redo = vm.pendingRedo;
		expect(redo).not.toBeNull();
		expect(redo!.bestId).toBe(undo2.bestId);
		expect(redo!.worstId).toBe(undo2.worstId);

		// Consume the redo
		vm.choose(0, vm.currentTask!.length - 1);
		expect(vm.pendingRedo).toBeNull();
	});

	it("changing selection on re-advance truncates forward entries", () => {
		const vm = setupVm();
		const task1 = vm.currentTask!;
		vm.choose(0, task1.length - 1);
		const task2 = vm.currentTask!;
		vm.choose(0, task2.length - 1);

		vm.undo();
		vm.undo();

		// Re-advance with a DIFFERENT choice (reversed best/worst)
		vm.choose(vm.currentTask!.length - 1, 0);
		expect(vm.pendingRedo).toBeNull();
	});

	it("redo data persists across re-initialization", () => {
		const vm1 = setupVm();
		const task1 = vm1.currentTask!;
		vm1.choose(0, task1.length - 1);
		vm1.undo();

		// Simulate page refresh
		const vm2 = new FindMeaningRankingViewModel(sid());
		vm2.initialize();

		const redo = vm2.pendingRedo;
		expect(redo).not.toBeNull();
		expect(vm2.round).toBe(0);
	});
});

describe("finalize", () => {
	it("saves chosen cards via loadChosenCardIds", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		vm.initialize();

		// Make tasks until complete: pick first card as best, last as worst
		while (!vm.isComplete) {
			const task = vm.currentTask!;
			vm.choose(0, task.length - 1);
		}
		vm.finalize();
		const chosen = loadChosenCardIds(sid());
		expect(chosen).not.toBeNull();
		expect(chosen!.length).toBeGreaterThanOrEqual(3);
		expect(chosen!.length).toBeLessThanOrEqual(5);
	});
});

describe("full ranking run", () => {
	it("completes ranking with 7 cards, picking first card as best and last as worst", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new FindMeaningRankingViewModel(sid());
		vm.initialize();

		while (!vm.isComplete) {
			const task = vm.currentTask!;
			vm.choose(0, task.length - 1);
		}

		expect(vm.topK.length).toBeGreaterThanOrEqual(3);
		expect(vm.topK.length).toBeLessThanOrEqual(5);
		vm.finalize();
		const chosen = loadChosenCardIds(sid());
		expect(chosen).not.toBeNull();
		expect(chosen!.length).toBeGreaterThanOrEqual(3);
		expect(chosen!.length).toBeLessThanOrEqual(5);
	});

	it("shows isComplete reactively when resuming a finished ranking", () => {
		// Complete a ranking and save the result.
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm1 = new FindMeaningRankingViewModel(sid());
		vm1.initialize();
		while (!vm1.isComplete) {
			const task = vm1.currentTask!;
			vm1.choose(0, task.length - 1);
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

		vm2.initialize();

		// After replaying a completed ranking, the reactive value of
		// isComplete must be true so Vue re-renders to the end-state.
		expect(isComplete).toBe(true);
	});
});
