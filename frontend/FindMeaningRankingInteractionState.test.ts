import { describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { computeLayoutTops, findClosestSlotIndex, getDraggedOutcome, moveCardToSlot, useFindMeaningRankingInteractionState } from "./FindMeaningRankingInteractionState.ts";

describe("moveCardToSlot", () => {
	it("moves a card into the requested slot", () => {
		expect(moveCardToSlot([0, 1, 2], 2, 0)).toEqual([2, 0, 1]);
		expect(moveCardToSlot([2, 0, 1], 2, 1)).toEqual([0, 2, 1]);
	});

	it("clamps out-of-range slot indices", () => {
		expect(moveCardToSlot([0, 1, 2], 0, 99)).toEqual([1, 2, 0]);
		expect(moveCardToSlot([0, 1, 2], 2, -1)).toEqual([2, 0, 1]);
	});
});

describe("computeLayoutTops", () => {
	it("computes tops for equal-height cards", () => {
		expect(computeLayoutTops([0, 1, 2], [100, 100, 100], 10, 5)).toEqual([10, 115, 220]);
	});

	it("computes tops for varying-height cards", () => {
		expect(computeLayoutTops([0, 1, 2], [80, 120, 60], 10, 5)).toEqual([10, 95, 220]);
	});

	it("accounts for reordered cards with varying heights", () => {
		expect(computeLayoutTops([2, 0, 1], [80, 120, 60], 10, 5)).toEqual([10, 75, 160]);
	});

	it("handles negative gap (overlapping borders)", () => {
		expect(computeLayoutTops([0, 1, 2], [100, 100, 100], 0, -1)).toEqual([0, 99, 198]);
	});
});

describe("findClosestSlotIndex", () => {
	it("returns the nearest slot center", () => {
		const slotRects = [
			{ top: 10, height: 100 },
			{ top: 120, height: 100 },
			{ top: 230, height: 100 },
		];
		expect(findClosestSlotIndex(slotRects, 40)).toBe(0);
		expect(findClosestSlotIndex(slotRects, 176)).toBe(1);
		expect(findClosestSlotIndex(slotRects, 340)).toBe(2);
	});
});

describe("useFindMeaningRankingInteractionState", () => {
	it("moves the selected most meaningful card to the top", () => {
		const state = useFindMeaningRankingInteractionState();
		state.chooseMost(2);
		expect(state.mostIndex.value).toBe(2);
		expect(state.displayOrder.value).toEqual([2, 0, 1]);
	});

	it("moves the selected least meaningful card to the bottom", () => {
		const state = useFindMeaningRankingInteractionState();
		state.chooseLeast(0);
		expect(state.leastIndex.value).toBe(0);
		expect(state.displayOrder.value).toEqual([1, 2, 0]);
	});

	it("matches the reviewed drag matrix for all order permutations and mark states", () => {
		function applyPerm(perm: readonly number[], index: number | null): number | null {
			return index === null ? null : perm[index];
		}

		const permutations = [
			[0, 1, 2],
			[0, 2, 1],
			[1, 0, 2],
			[1, 2, 0],
			[2, 0, 1],
			[2, 1, 0],
		] as const;

		const baseGroups = [
			{
				mostIndex: null,
				leastIndex: null,
				outcomes: [
					{ draggedIndex: 0, dropSlot: 0, expected: { displayOrder: [0, 1, 2], mostIndex: null, leastIndex: null } },
					{ draggedIndex: 0, dropSlot: 1, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: null } },
					{ draggedIndex: 0, dropSlot: 2, expected: { displayOrder: [1, 2, 0], mostIndex: null, leastIndex: 0 } },
					{ draggedIndex: 1, dropSlot: 0, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: null } },
					{ draggedIndex: 1, dropSlot: 1, expected: { displayOrder: [0, 1, 2], mostIndex: null, leastIndex: null } },
					{ draggedIndex: 1, dropSlot: 2, expected: { displayOrder: [0, 2, 1], mostIndex: null, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 0, expected: { displayOrder: [2, 0, 1], mostIndex: 2, leastIndex: null } },
					{ draggedIndex: 2, dropSlot: 1, expected: { displayOrder: [0, 2, 1], mostIndex: null, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 2, expected: { displayOrder: [0, 1, 2], mostIndex: null, leastIndex: null } },
				],
			},
			{
				mostIndex: 0,
				leastIndex: null,
				outcomes: [
					{ draggedIndex: 0, dropSlot: 0, expected: { displayOrder: [0, 1, 2], mostIndex: 0, leastIndex: null } },
					{ draggedIndex: 0, dropSlot: 1, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: null } },
					{ draggedIndex: 0, dropSlot: 2, expected: { displayOrder: [1, 2, 0], mostIndex: null, leastIndex: 0 } },
					{ draggedIndex: 1, dropSlot: 0, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: null } },
					{ draggedIndex: 1, dropSlot: 1, expected: { displayOrder: [0, 1, 2], mostIndex: 0, leastIndex: null } },
					{ draggedIndex: 1, dropSlot: 2, expected: { displayOrder: [0, 2, 1], mostIndex: 0, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 0, expected: { displayOrder: [2, 0, 1], mostIndex: 2, leastIndex: null } },
					{ draggedIndex: 2, dropSlot: 1, expected: { displayOrder: [0, 2, 1], mostIndex: 0, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 2, expected: { displayOrder: [0, 1, 2], mostIndex: 0, leastIndex: null } },
				],
			},
			{
				mostIndex: null,
				leastIndex: 2,
				outcomes: [
					{ draggedIndex: 0, dropSlot: 0, expected: { displayOrder: [0, 1, 2], mostIndex: null, leastIndex: 2 } },
					{ draggedIndex: 0, dropSlot: 1, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: 2 } },
					{ draggedIndex: 0, dropSlot: 2, expected: { displayOrder: [1, 2, 0], mostIndex: null, leastIndex: 0 } },
					{ draggedIndex: 1, dropSlot: 0, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: 2 } },
					{ draggedIndex: 1, dropSlot: 1, expected: { displayOrder: [0, 1, 2], mostIndex: null, leastIndex: 2 } },
					{ draggedIndex: 1, dropSlot: 2, expected: { displayOrder: [0, 2, 1], mostIndex: null, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 0, expected: { displayOrder: [2, 0, 1], mostIndex: 2, leastIndex: null } },
					{ draggedIndex: 2, dropSlot: 1, expected: { displayOrder: [0, 2, 1], mostIndex: null, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 2, expected: { displayOrder: [0, 1, 2], mostIndex: null, leastIndex: 2 } },
				],
			},
			{
				mostIndex: 0,
				leastIndex: 2,
				outcomes: [
					{ draggedIndex: 0, dropSlot: 0, expected: { displayOrder: [0, 1, 2], mostIndex: 0, leastIndex: 2 } },
					{ draggedIndex: 0, dropSlot: 1, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: 2 } },
					{ draggedIndex: 0, dropSlot: 2, expected: { displayOrder: [1, 2, 0], mostIndex: 1, leastIndex: 0 } },
					{ draggedIndex: 1, dropSlot: 0, expected: { displayOrder: [1, 0, 2], mostIndex: 1, leastIndex: 2 } },
					{ draggedIndex: 1, dropSlot: 1, expected: { displayOrder: [0, 1, 2], mostIndex: 0, leastIndex: 2 } },
					{ draggedIndex: 1, dropSlot: 2, expected: { displayOrder: [0, 2, 1], mostIndex: 0, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 0, expected: { displayOrder: [2, 0, 1], mostIndex: 2, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 1, expected: { displayOrder: [0, 2, 1], mostIndex: 0, leastIndex: 1 } },
					{ draggedIndex: 2, dropSlot: 2, expected: { displayOrder: [0, 1, 2], mostIndex: 0, leastIndex: 2 } },
				],
			},
		] as const;

		for (const perm of permutations) {
			const order = [...perm];

			for (const baseGroup of baseGroups) {
				const mostIndex = applyPerm(perm, baseGroup.mostIndex);
				const leastIndex = applyPerm(perm, baseGroup.leastIndex);

				for (const outcome of baseGroup.outcomes) {
					const draggedIndex = perm[outcome.draggedIndex];
					const dropSlot = outcome.dropSlot;
					const expected = {
						displayOrder: outcome.expected.displayOrder.map((i) => perm[i]),
						mostIndex: applyPerm(perm, outcome.expected.mostIndex),
						leastIndex: applyPerm(perm, outcome.expected.leastIndex),
					};

					const state = useFindMeaningRankingInteractionState();
					state.displayOrder.value = [...order];
					state.mostIndex.value = mostIndex;
					state.leastIndex.value = leastIndex;

					expect(getDraggedOutcome(order, mostIndex, leastIndex, draggedIndex, dropSlot)).toEqual(expected);

					state.applyDraggedOrder(draggedIndex, dropSlot);
					expect(state.displayOrder.value).toEqual(expected.displayOrder);
					expect(state.mostIndex.value).toBe(expected.mostIndex);
					expect(state.leastIndex.value).toBe(expected.leastIndex);
				}
			}
		}
	});

	it("restores the saved top and bottom choices for the current task", () => {
		const task = MEANING_CARDS.slice(0, 3);
		const state = useFindMeaningRankingInteractionState();
		state.restoreSelection(task, task[1].id, task[2].id);
		expect(state.mostIndex.value).toBe(1);
		expect(state.leastIndex.value).toBe(2);
		expect(state.displayOrder.value).toEqual([1, 0, 2]);
	});
});
