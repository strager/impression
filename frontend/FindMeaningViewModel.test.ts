// @vitest-environment node

import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { FindMeaningViewModel } from "./FindMeaningViewModel.ts";
import { ensureProfilesInitialized, getActiveProfileId, loadChosenCardIds, loadRanking, loadSwipeProgress, saveSwipeProgress } from "./store.ts";

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
	it("loads all cards on fresh start", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.totalCards).toBe(MEANING_CARDS.length);
		expect(vm.currentIndex).toBe(0);
		expect(vm.currentCard).not.toBeNull();
	});

	it("resumes from saved progress", () => {
		const cardIds = MEANING_CARDS.slice(0, 5).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "disagree" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.totalCards).toBe(5);
		expect(vm.currentIndex).toBe(2);
		expect(vm.canUndo).toBe(true);
	});

	it("falls back to fresh shuffle when saved card IDs are all unknown", () => {
		saveSwipeProgress(sid(), { shuffledCardIds: ["nonexistent-1", "nonexistent-2"], swipeHistory: [] });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.totalCards).toBe(MEANING_CARDS.length);
		expect(vm.currentIndex).toBe(0);
	});
});

describe("swipe", () => {
	it("advances currentIndex", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		expect(vm.currentIndex).toBe(1);
	});

	it("records unsure direction", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("unsure", "drag");
		expect(vm.currentIndex).toBe(1);
		const saved = loadSwipeProgress(sid());
		expect(saved!.swipeHistory[0].direction).toBe("unsure");
	});

	it("changes currentCard to the next card", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		const first = vm.currentCard;
		vm.swipe("agree", "drag");
		expect(vm.currentCard).not.toEqual(first);
	});

	it("sets canUndo to true", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.canUndo).toBe(false);
		vm.swipe("agree", "drag");
		expect(vm.canUndo).toBe(true);
	});

	it("persists to localStorage", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		const saved = loadSwipeProgress(sid());
		expect(saved).not.toBeNull();
		expect(saved!.swipeHistory).toHaveLength(1);
		expect(saved!.swipeHistory[0].direction).toBe("agree");
	});

	it("is a no-op when already complete", () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "agree" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.isComplete).toBe(true);
		vm.swipe("agree", "drag");
		expect(vm.currentIndex).toBe(2);
	});
});

describe("undo", () => {
	it("decrements currentIndex and restores previous card", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		const first = vm.currentCard;
		vm.swipe("agree", "drag");
		vm.undo();
		expect(vm.currentIndex).toBe(0);
		expect(vm.currentCard).toEqual(first);
	});

	it("sets canUndo to false after undoing the only swipe", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		vm.undo();
		expect(vm.canUndo).toBe(false);
	});

	it("persists to localStorage", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		vm.undo();
		const saved = loadSwipeProgress(sid());
		expect(saved).not.toBeNull();
		expect(saved!.swipeHistory).toHaveLength(0);
	});

	it("is a no-op when canUndo is false", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.undo();
		expect(vm.currentIndex).toBe(0);
	});
});

describe("derived properties", () => {
	it("progressPercent starts at 0 and increases after swipe", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.progressPercent).toBe(0);
		vm.swipe("agree", "drag");
		expect(vm.progressPercent).toBeGreaterThan(0);
	});

	it("progressPercent decreases after undo", () => {
		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		vm.swipe("disagree", "drag");
		const before = vm.progressPercent;
		vm.undo();
		expect(vm.progressPercent).toBeLessThan(before);
	});

	it("isComplete becomes true after swiping all cards", () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: [] });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.isComplete).toBe(false);
		vm.swipe("agree", "drag");
		vm.swipe("agree", "drag");
		expect(vm.isComplete).toBe(true);
	});

	it("nextCard is null when on the last card", () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: [] });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		expect(vm.nextCard).toBeNull();
	});
});

describe("agreed and unsure cards", () => {
	it("returns only agreed cards", () => {
		const cardIds = MEANING_CARDS.slice(0, 4).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "disagree" as const },
			{ cardId: cardIds[2], direction: "unsure" as const },
			{ cardId: cardIds[3], direction: "agree" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.agreedCards.map((c) => c.id)).toEqual([cardIds[0], cardIds[3]]);
	});

	it("returns only unsure cards", () => {
		const cardIds = MEANING_CARDS.slice(0, 4).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "unsure" as const },
			{ cardId: cardIds[2], direction: "disagree" as const },
			{ cardId: cardIds[3], direction: "unsure" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.unsureCards.map((c) => c.id)).toEqual([cardIds[1], cardIds[3]]);
	});

	it("returns cards in MEANING_CARDS order, not swipe order", () => {
		const cardIds = [MEANING_CARDS[4].id, MEANING_CARDS[2].id, MEANING_CARDS[0].id];
		const history = cardIds.map((id) => ({ cardId: id, direction: "agree" as const }));
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.agreedCards.map((c) => c.id)).toEqual([MEANING_CARDS[0].id, MEANING_CARDS[2].id, MEANING_CARDS[4].id]);
	});

	it("returns empty lists when everything is disagreed", () => {
		const cardIds = MEANING_CARDS.slice(0, 3).map((c) => c.id);
		const history = cardIds.map((id) => ({ cardId: id, direction: "disagree" as const }));
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		expect(vm.agreedCards).toEqual([]);
		expect(vm.unsureCards).toEqual([]);
	});

	it("updates after undo", () => {
		const cardIds = MEANING_CARDS.slice(0, 2).map((c) => c.id);
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: [] });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.swipe("agree", "drag");
		expect(vm.agreedCards).toHaveLength(1);
		vm.undo();
		expect(vm.agreedCards).toHaveLength(0);
	});
});

describe("finalize", () => {
	it("saves chosen card IDs when 5 or fewer agreed", () => {
		const cardIds = MEANING_CARDS.slice(0, 5).map((c) => c.id);
		const history = cardIds.map((id) => ({ cardId: id, direction: "agree" as const }));
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.finalize();
		expect(vm.requiresPrioritization).toBe(false);
		expect(loadChosenCardIds(sid())).toEqual(cardIds);
	});

	it("saves ranking data when more than 5 agreed", () => {
		const cardIds = MEANING_CARDS.slice(0, 7).map((c) => c.id);
		const history = cardIds.map((id) => ({ cardId: id, direction: "agree" as const }));
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.finalize();
		expect(vm.requiresPrioritization).toBe(true);
		const ranking = loadRanking(sid());
		expect(ranking).not.toBeNull();
		expect(ranking!.cardIds).toEqual(cardIds);
		expect(ranking!.comparisons).toEqual([]);
		expect(ranking!.complete).toBe(false);
	});

	it("does not require prioritization when ≤5 agreed among many cards", () => {
		const cardIds = MEANING_CARDS.slice(0, 8).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "agree" as const },
			{ cardId: cardIds[2], direction: "disagree" as const },
			{ cardId: cardIds[3], direction: "agree" as const },
			{ cardId: cardIds[4], direction: "disagree" as const },
			{ cardId: cardIds[5], direction: "disagree" as const },
			{ cardId: cardIds[6], direction: "agree" as const },
			{ cardId: cardIds[7], direction: "agree" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.finalize();
		expect(vm.requiresPrioritization).toBe(false);
		const chosen = loadChosenCardIds(sid());
		expect(chosen).toEqual([cardIds[0], cardIds[1], cardIds[3], cardIds[6], cardIds[7]]);
	});

	it("includes unsure cards when fewer than 3 agreed", () => {
		const cardIds = MEANING_CARDS.slice(0, 6).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "disagree" as const },
			{ cardId: cardIds[2], direction: "unsure" as const },
			{ cardId: cardIds[3], direction: "agree" as const },
			{ cardId: cardIds[4], direction: "unsure" as const },
			{ cardId: cardIds[5], direction: "disagree" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.finalize();
		expect(vm.requiresPrioritization).toBe(false);
		const chosen = loadChosenCardIds(sid());
		expect(chosen).toEqual([cardIds[0], cardIds[3], cardIds[2], cardIds[4]]);
	});

	it("excludes unsure cards when 3 or more agreed", () => {
		const cardIds = MEANING_CARDS.slice(0, 6).map((c) => c.id);
		const history = [
			{ cardId: cardIds[0], direction: "agree" as const },
			{ cardId: cardIds[1], direction: "agree" as const },
			{ cardId: cardIds[2], direction: "unsure" as const },
			{ cardId: cardIds[3], direction: "agree" as const },
			{ cardId: cardIds[4], direction: "unsure" as const },
			{ cardId: cardIds[5], direction: "disagree" as const },
		];
		saveSwipeProgress(sid(), { shuffledCardIds: cardIds, swipeHistory: history });

		const vm = new FindMeaningViewModel(sid());
		vm.initialize();
		vm.finalize();
		expect(vm.requiresPrioritization).toBe(false);
		const chosen = loadChosenCardIds(sid());
		expect(chosen).toEqual([cardIds[0], cardIds[1], cardIds[3]]);
	});
});
