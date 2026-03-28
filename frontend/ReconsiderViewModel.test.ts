// @vitest-environment node

import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { ReconsiderViewModel } from "./ReconsiderViewModel.ts";
import type { ExamineData } from "./store.ts";
import { ensureProfilesInitialized, getActiveProfileId, loadChosenCardIds, saveChosenCardIds, saveExamineData } from "./store.ts";

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

function setupChosenCards(count: number): string[] {
	const cardIds = MEANING_CARDS.slice(0, count).map((c) => c.id);
	saveChosenCardIds(sid(), cardIds);
	return cardIds;
}

function setupExamineDataWithAnswers(cardIds: string[]): void {
	const data: ExamineData = {};
	for (const cardId of cardIds) {
		data[cardId] = {
			entries: [
				{
					questionId: EXAMINE_QUESTIONS[0].id,
					userAnswer: "Some answer",
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
	}
	saveExamineData(sid(), data);
}

function setupExamineDataEmpty(cardIds: string[]): void {
	const data: ExamineData = {};
	for (const cardId of cardIds) {
		data[cardId] = {
			entries: [
				{
					questionId: EXAMINE_QUESTIONS[0].id,
					userAnswer: "",
					prefilledAnswer: "",
					submitted: false,
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
	}
	saveExamineData(sid(), data);
}

describe("initialize", () => {
	it("returns 'ready' when chosen cards exist", () => {
		setupChosenCards(3);

		const vm = new ReconsiderViewModel(sid());
		expect(vm.initialize()).toBe("ready");
	});

	it("returns 'no-data' when no chosen cards in localStorage", () => {
		const vm = new ReconsiderViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("returns 'no-data' on corrupt localStorage data", () => {
		localStorage.setItem(`somecam-${sid()}-chosen`, "not-valid-json{{{");

		const vm = new ReconsiderViewModel(sid());
		expect(vm.initialize()).toBe("no-data");
	});

	it("populates chosenIds from stored card IDs", () => {
		const cardIds = setupChosenCards(3);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		for (const id of cardIds) {
			expect(vm.chosenIds.has(id)).toBe(true);
		}
		expect(vm.chosenIds.size).toBe(3);
	});

	it("populates examinedIds for cards with non-empty userAnswer", () => {
		const cardIds = setupChosenCards(2);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		for (const id of cardIds) {
			expect(vm.examinedIds.has(id)).toBe(true);
		}
	});

	it("does not mark cards as examined when all userAnswers are empty", () => {
		const cardIds = setupChosenCards(2);
		setupExamineDataEmpty(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(vm.examinedIds.size).toBe(0);
	});

	it("handles missing examine data gracefully", () => {
		setupChosenCards(2);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(vm.examinedIds.size).toBe(0);
	});
});

describe("selectedCount", () => {
	it("returns 0 when no cards are chosen", () => {
		const vm = new ReconsiderViewModel(sid());
		vm.initialize();
		expect(vm.selectedCount).toBe(0);
	});

	it("returns the number of chosen cards after initialize", () => {
		setupChosenCards(4);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();
		expect(vm.selectedCount).toBe(4);
	});

	it("updates after addCard", () => {
		setupChosenCards(2);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();
		expect(vm.selectedCount).toBe(2);

		vm.addCard(MEANING_CARDS[5].id);
		expect(vm.selectedCount).toBe(3);
	});

	it("updates after removeCard", () => {
		const cardIds = setupChosenCards(3);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();
		expect(vm.selectedCount).toBe(3);

		vm.removeCard(cardIds[0], false);
		expect(vm.selectedCount).toBe(2);
	});
});

describe("isExamined", () => {
	it("returns true for a card with examination answers", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(vm.isExamined(cardIds[0])).toBe(true);
	});

	it("returns false for a card without examination answers", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataEmpty(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(vm.isExamined(cardIds[0])).toBe(false);
	});

	it("returns false for a card not in examine data", () => {
		setupChosenCards(1);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(vm.isExamined(MEANING_CARDS[5].id)).toBe(false);
	});
});

describe("toggleCard", () => {
	it("adds card when not currently chosen", () => {
		setupChosenCards(1);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		const newCardId = MEANING_CARDS[5].id;
		expect(vm.chosenIds.has(newCardId)).toBe(false);

		vm.toggleCard(newCardId);
		expect(vm.chosenIds.has(newCardId)).toBe(true);
	});

	it("removes card directly when chosen but not examined", () => {
		const cardIds = setupChosenCards(2);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.toggleCard(cardIds[0]);
		expect(vm.chosenIds.has(cardIds[0])).toBe(false);
	});

	it("shows confirmation when chosen and examined", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.toggleCard(cardIds[0]);
		expect(vm.confirmingRemove).toBe(cardIds[0]);
		expect(vm.chosenIds.has(cardIds[0])).toBe(true);
	});
});

describe("addCard", () => {
	it("adds cardId to chosenIds", () => {
		setupChosenCards(1);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		const newCardId = MEANING_CARDS[3].id;
		vm.addCard(newCardId);
		expect(vm.chosenIds.has(newCardId)).toBe(true);
	});

	it("persists to localStorage in MEANING_CARDS order", () => {
		const cardIds = setupChosenCards(1);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		// Add a card that comes before the existing one in MEANING_CARDS order
		const earlierCard = MEANING_CARDS.find((c) => !cardIds.includes(c.id))!;
		vm.addCard(earlierCard.id);

		const saved = loadChosenCardIds(sid());
		const expectedOrder = MEANING_CARDS.filter((c) => c.id === cardIds[0] || c.id === earlierCard.id).map((c) => c.id);
		expect(saved).toEqual(expectedOrder);
	});
});

describe("removeCard", () => {
	it("removes cardId from chosenIds", () => {
		const cardIds = setupChosenCards(2);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.removeCard(cardIds[0], false);
		expect(vm.chosenIds.has(cardIds[0])).toBe(false);
		expect(vm.chosenIds.has(cardIds[1])).toBe(true);
	});

	it("clears confirmingRemove", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.toggleCard(cardIds[0]);
		expect(vm.confirmingRemove).toBe(cardIds[0]);

		vm.removeCard(cardIds[0], true);
		expect(vm.confirmingRemove).toBeNull();
	});

	it("persists to localStorage in MEANING_CARDS order", () => {
		const cardIds = setupChosenCards(3);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.removeCard(cardIds[1], false);

		const saved = loadChosenCardIds(sid());
		expect(saved).toEqual([cardIds[0], cardIds[2]]);
	});
});

describe("cancelRemove", () => {
	it("clears confirmingRemove to null", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.toggleCard(cardIds[0]);
		expect(vm.confirmingRemove).toBe(cardIds[0]);

		vm.cancelRemove();
		expect(vm.confirmingRemove).toBeNull();
	});

	it("does not throw when confirmingRemove is already null", () => {
		setupChosenCards(1);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(() => {
			vm.cancelRemove();
		}).not.toThrow();
	});
});

describe("onDone", () => {
	it("does not throw", () => {
		setupChosenCards(3);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		expect(() => {
			vm.onDone();
		}).not.toThrow();
	});

	it("does not modify chosenIds", () => {
		setupChosenCards(3);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		const before = new Set(vm.chosenIds);
		vm.onDone();
		expect(vm.chosenIds).toEqual(before);
	});
});

describe("confirmation flow", () => {
	it("toggle examined card sets confirmingRemove, removeCard clears it", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.toggleCard(cardIds[0]);
		expect(vm.confirmingRemove).toBe(cardIds[0]);
		expect(vm.chosenIds.has(cardIds[0])).toBe(true);

		vm.removeCard(cardIds[0], true);
		expect(vm.confirmingRemove).toBeNull();
		expect(vm.chosenIds.has(cardIds[0])).toBe(false);
	});

	it("toggle examined card then cancel preserves card", () => {
		const cardIds = setupChosenCards(1);
		setupExamineDataWithAnswers(cardIds);

		const vm = new ReconsiderViewModel(sid());
		vm.initialize();

		vm.toggleCard(cardIds[0]);
		expect(vm.confirmingRemove).toBe(cardIds[0]);

		vm.cancelRemove();
		expect(vm.confirmingRemove).toBeNull();
		expect(vm.chosenIds.has(cardIds[0])).toBe(true);
	});
});
