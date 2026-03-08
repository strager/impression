import { ref } from "vue";
import type { Ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";

export interface SlotRect {
	top: number;
	height: number;
}

export function moveCardToSlot(order: readonly number[], cardIndex: number, slotIndex: number): number[] {
	const nextOrder = [...order];
	const currentSlot = nextOrder.indexOf(cardIndex);
	if (currentSlot < 0) {
		return nextOrder;
	}
	const clampedSlot = Math.max(0, Math.min(slotIndex, nextOrder.length - 1));
	if (currentSlot === clampedSlot) {
		return nextOrder;
	}
	nextOrder.splice(currentSlot, 1);
	nextOrder.splice(clampedSlot, 0, cardIndex);
	return nextOrder;
}

export function findClosestSlotIndex(slotRects: readonly SlotRect[], pointerY: number): number {
	if (slotRects.length === 0) {
		return 0;
	}
	let closestSlot = 0;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const [slotIndex, slotRect] of slotRects.entries()) {
		const slotCenterY = slotRect.top + slotRect.height / 2;
		const distance = Math.abs(pointerY - slotCenterY);
		if (distance < closestDistance) {
			closestSlot = slotIndex;
			closestDistance = distance;
		}
	}
	return closestSlot;
}

export function getDraggedOutcome(
	order: readonly number[],
	mostIndex: number | null,
	leastIndex: number | null,
	draggedIndex: number,
	dropSlot: number,
): {
	displayOrder: number[];
	leastIndex: number | null;
	mostIndex: number | null;
} {
	const currentSlot = order.indexOf(draggedIndex);
	if (currentSlot < 0) {
		return {
			displayOrder: [...order],
			leastIndex,
			mostIndex,
		};
	}
	const targetSlot = Math.max(0, Math.min(dropSlot, order.length - 1));
	if (targetSlot === currentSlot) {
		return {
			displayOrder: [...order],
			leastIndex,
			mostIndex,
		};
	}
	const displayOrder = moveCardToSlot(order, draggedIndex, targetSlot);
	const lastSlot = displayOrder.length - 1;
	const clampedDropSlot = Math.max(0, Math.min(dropSlot, lastSlot));
	let nextMostIndex = mostIndex;
	let nextLeastIndex = leastIndex;

	if (clampedDropSlot === 0) {
		nextMostIndex = draggedIndex;
		if (nextLeastIndex === nextMostIndex) {
			nextLeastIndex = mostIndex !== null && leastIndex !== null ? (displayOrder[lastSlot] ?? null) : null;
		}
	} else if (clampedDropSlot === lastSlot) {
		nextLeastIndex = draggedIndex;
		if (nextMostIndex === nextLeastIndex) {
			nextMostIndex = mostIndex !== null && leastIndex !== null ? (displayOrder[0] ?? null) : null;
		}
	} else if (currentSlot < clampedDropSlot) {
		nextMostIndex = displayOrder[0] ?? null;
		if (nextLeastIndex === nextMostIndex) {
			nextLeastIndex = null;
		}
	} else {
		nextLeastIndex = displayOrder[lastSlot] ?? null;
		if (nextMostIndex === nextLeastIndex) {
			nextMostIndex = null;
		}
	}

	return {
		displayOrder,
		leastIndex: nextLeastIndex,
		mostIndex: nextMostIndex,
	};
}

export function useFindMeaningRankingInteractionState(): {
	displayOrder: Ref<number[]>;
	leastIndex: Ref<number | null>;
	mostIndex: Ref<number | null>;
	applyDraggedOrder: (draggedIndex: number, slotIndex: number) => void;
	reset: () => void;
	restoreSelection: (task: readonly MeaningCard[] | null, bestId: string, worstId: string) => void;
	chooseLeast: (index: number) => void;
	chooseMost: (index: number) => void;
} {
	const mostIndex = ref<number | null>(null);
	const leastIndex = ref<number | null>(null);
	const displayOrder = ref([0, 1, 2]);
	function moveToTop(index: number): void {
		displayOrder.value = moveCardToSlot(displayOrder.value, index, 0);
	}

	function moveToBottom(index: number): void {
		displayOrder.value = moveCardToSlot(displayOrder.value, index, displayOrder.value.length - 1);
	}

	function chooseMost(index: number): void {
		if (mostIndex.value === index) {
			mostIndex.value = null;
			return;
		}
		mostIndex.value = index;
		if (leastIndex.value === index) {
			leastIndex.value = null;
		}
		moveToTop(index);
	}

	function chooseLeast(index: number): void {
		if (leastIndex.value === index) {
			leastIndex.value = null;
			return;
		}
		leastIndex.value = index;
		if (mostIndex.value === index) {
			mostIndex.value = null;
		}
		moveToBottom(index);
	}

	function applyDraggedOrder(draggedIndex: number, slotIndex: number): void {
		const result = getDraggedOutcome(displayOrder.value, mostIndex.value, leastIndex.value, draggedIndex, slotIndex);
		displayOrder.value = result.displayOrder;
		mostIndex.value = result.mostIndex;
		leastIndex.value = result.leastIndex;
	}

	function reset(): void {
		mostIndex.value = null;
		leastIndex.value = null;
		displayOrder.value = [0, 1, 2];
	}

	function restoreSelection(task: readonly MeaningCard[] | null, bestId: string, worstId: string): void {
		reset();
		if (task === null) {
			return;
		}
		const bestIndex = task.findIndex((card) => card.id === bestId);
		const worstIndex = task.findIndex((card) => card.id === worstId);
		if (bestIndex >= 0) {
			chooseMost(bestIndex);
		}
		if (worstIndex >= 0) {
			chooseLeast(worstIndex);
		}
	}

	return {
		displayOrder,
		leastIndex,
		mostIndex,
		applyDraggedOrder,
		reset,
		restoreSelection,
		chooseLeast,
		chooseMost,
	};
}
