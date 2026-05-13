// @vitest-environment node

import { Window } from "happy-dom";
import { watchSyncEffect } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { PrioritizeViewModel } from "./PrioritizeViewModel.ts";
import { ensureProfilesInitialized, getActiveProfileId, loadChosenCardIds, loadPrioritizeProgress, savePrioritizeProgress, saveSwipeProgress } from "./store.ts";

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
	it("returns 'no-data' when identification isn't complete", () => {
		const vm = new PrioritizeViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' when swipe progress exists but not all cards swiped", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		saveSwipeProgress(sid(), {
			shuffledCardIds: cardIds,
			swipeHistory: [{ cardId: cardIds[0], direction: "agree" }],
		});
		const vm = new PrioritizeViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'skip' when <=5 candidate cards", () => {
		const cardIds = MEANING_CARDS.slice(0, 4).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new PrioritizeViewModel(sid());
		expect(vm.initialize()).toBe("skip");
		expect(loadChosenCardIds(sid())).toEqual(cardIds);
	});

	it("returns 'ready' when >5 cards, populates currentPair", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new PrioritizeViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.currentPair).not.toBeNull();
		expect(vm.currentPair!.length).toBe(2);
		expect(vm.round).toBe(0);
		expect(vm.isComplete).toBe(false);
	});

	it("resumes from saved comparison history", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		savePrioritizeProgress(sid(), {
			cardIds,
			comparisons: [{ set: [cardIds[0], cardIds[1]], best: cardIds[0], worst: cardIds[1] }],
			complete: false,
		});
		const vm = new PrioritizeViewModel(sid());
		expect(vm.initialize()).toBe("ready");
		expect(vm.round).toBe(1);
		expect(vm.canUndo).toBe(true);
	});
});

describe("choose", () => {
	function setupVm(): PrioritizeViewModel {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new PrioritizeViewModel(sid());
		vm.initialize();
		return vm;
	}

	it("choose with winner index advances round", () => {
		const vm = setupVm();
		expect(vm.round).toBe(0);

		vm.choose(0);
		expect(vm.round).toBe(1);

		const saved = loadPrioritizeProgress(sid());
		expect(saved).not.toBeNull();
		expect(saved!.comparisons).toHaveLength(1);
		expect(saved!.comparisons[0].set).toHaveLength(2);
	});

	it("throws when isComplete", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		// Generate all C(7, 2) = 21 unique pairs with the lower-indexed card as winner.
		// That's enough deterministic evidence for Ranking to terminate (boundary-stable)
		// before max-tasks fires.
		const comparisons: { set: [string, string]; best: string; worst: string }[] = [];
		for (let i = 0; i < cardIds.length; i++) {
			for (let j = i + 1; j < cardIds.length; j++) {
				comparisons.push({ set: [cardIds[i], cardIds[j]], best: cardIds[i], worst: cardIds[j] });
			}
		}
		savePrioritizeProgress(sid(), { cardIds, comparisons, complete: false });
		const vm = new PrioritizeViewModel(sid());
		vm.initialize();
		expect(vm.isComplete).toBe(true);
		expect(() => {
			vm.choose(0);
		}).toThrow();
	});
});

describe("undo", () => {
	function setupVm(): PrioritizeViewModel {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new PrioritizeViewModel(sid());
		vm.initialize();
		return vm;
	}

	it("throws when no tasks to undo", () => {
		const vm = setupVm();
		expect(() => vm.undo()).toThrow();
	});

	it("decrements round after a task", () => {
		const vm = setupVm();
		vm.choose(0);
		expect(vm.round).toBe(1);

		vm.undo();
		expect(vm.round).toBe(0);
		expect(vm.canUndo).toBe(false);
	});

	it("persists forward comparisons and activeRound to localStorage", () => {
		const vm = setupVm();
		vm.choose(0);

		vm.undo();
		const saved = loadPrioritizeProgress(sid());
		expect(saved).not.toBeNull();
		expect(saved!.comparisons).toHaveLength(1);
		expect(saved!.activeRound).toBe(0);
	});
});

describe("pendingRedo", () => {
	function setupVm(): PrioritizeViewModel {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new PrioritizeViewModel(sid());
		vm.initialize();
		return vm;
	}

	it("returns null when no forward history exists", () => {
		const vm = setupVm();
		expect(vm.pendingRedo).toBeNull();
	});

	it("returns undone task data after undo", () => {
		const vm = setupVm();
		vm.choose(0);
		const { bestId, worstId } = vm.undo();
		const redo = vm.pendingRedo;
		expect(redo).not.toBeNull();
		expect(redo!.bestId).toBe(bestId);
		expect(redo!.worstId).toBe(worstId);
	});

	it("undo twice then choose: pendingRedo returns second undone task data", () => {
		const vm = setupVm();
		vm.choose(0);
		vm.choose(0);

		const undo2 = vm.undo();
		vm.undo();

		// Re-advance round 0 with the same choice as before.
		vm.choose(0);

		const redo = vm.pendingRedo;
		expect(redo).not.toBeNull();
		expect(redo!.bestId).toBe(undo2.bestId);
		expect(redo!.worstId).toBe(undo2.worstId);

		// Consume the redo
		vm.choose(0);
		expect(vm.pendingRedo).toBeNull();
	});

	it("changing selection on re-advance truncates forward entries", () => {
		const vm = setupVm();
		vm.choose(0);
		vm.choose(0);

		vm.undo();
		vm.undo();

		// Re-advance round 0 with the OTHER card as winner — different from before.
		vm.choose(1);
		expect(vm.pendingRedo).toBeNull();
	});

	it("redo data persists across re-initialization", () => {
		const vm1 = setupVm();
		vm1.choose(0);
		vm1.undo();

		// Simulate page refresh
		const vm2 = new PrioritizeViewModel(sid());
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
		const vm = new PrioritizeViewModel(sid());
		vm.initialize();

		while (!vm.isComplete) {
			vm.choose(0);
		}
		vm.finalize();
		const chosen = loadChosenCardIds(sid());
		expect(chosen).not.toBeNull();
		expect(chosen!.length).toBeGreaterThanOrEqual(3);
		expect(chosen!.length).toBeLessThanOrEqual(5);
	});
});

describe("full ranking run", () => {
	it("completes ranking with 7 cards, always picking the first card of the pair", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		setupSwipeProgressAllSwiped(cardIds);
		const vm = new PrioritizeViewModel(sid());
		vm.initialize();

		while (!vm.isComplete) {
			vm.choose(0);
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
		const vm1 = new PrioritizeViewModel(sid());
		vm1.initialize();
		while (!vm1.isComplete) {
			vm1.choose(0);
		}
		// vm1 saved the completed ranking to localStorage.

		// Simulate a page refresh: create a new ViewModel and initialize it.
		const vm2 = new PrioritizeViewModel(sid());

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
