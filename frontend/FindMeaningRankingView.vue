<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, TransitionGroup, watch } from "vue";
import { useRouter } from "vue-router";

import { computeLayoutTops, findClosestSlotIndex, getDraggedOutcome, moveCardToSlot, useFindMeaningRankingInteractionState } from "./FindMeaningRankingInteractionState.ts";
import type { SlotRect } from "./FindMeaningRankingInteractionState.ts";
import { FindMeaningRankingViewModel } from "./FindMeaningRankingViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { useMatchMedia } from "./use-match-media.ts";
import AppButton from "./AppButton.vue";
import ToggleButton from "./ToggleButton.vue";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const vm = new FindMeaningRankingViewModel(sessionId);

const interaction = useFindMeaningRankingInteractionState();
const mostIndex = interaction.mostIndex;
const leastIndex = interaction.leastIndex;
const displayOrder = interaction.displayOrder;
const cardStageRef = ref<HTMLElement | null>(null);
const slotRefs = ref<(HTMLElement | null)[]>([]);
const buttonRowRef = ref<HTMLElement | null>(null);
const endStateRef = ref<HTMLElement | null>(null);
const pointerCaptureElement = ref<HTMLElement | null>(null);
const DRAG_LIFT_X_PX = -6;
const DRAG_LIFT_Y_PX = 6;

interface DragState {
	borderVisible: boolean;
	cardHeight: number;
	cardHeights: number[];
	draggedIndex: number;
	hoveredSlot: number;
	liftX: number;
	originSlot: number;
	overlayTop: number;
	phase: "dragging" | "settling";
	pointerId: number;
	pointerOffsetY: number;
	slotGap: number;
	slotRects: SlotRect[];
}

const dragState = ref<DragState | null>(null);
const activeCardTransitions = new Set<string>();
let dragBorderFrameId: number | null = null;
let settleFrameId: number | null = null;
const isSettling = computed(() => dragState.value?.phase === "settling");
const suppressMotion = ref(false);
const prefersReducedMotion = useMatchMedia("(prefers-reduced-motion: reduce)");
const useTransitionGroup = computed(() => dragState.value === null && !suppressMotion.value && !prefersReducedMotion.value);
const cardListComponent = computed(() => (useTransitionGroup.value ? TransitionGroup : "div"));
const cardListProps = computed(() => (useTransitionGroup.value ? { tag: "div", name: "card" } : {}));
const dragOverlayStyle = computed(() => {
	const activeDrag = dragState.value;
	if (activeDrag === null) {
		return {};
	}
	return {
		transform: `translate(${String(activeDrag.liftX)}px, ${String(activeDrag.overlayTop)}px)`,
		"--drag-lift-x": `${String(DRAG_LIFT_X_PX)}px`,
		"--drag-lift-y": `${String(DRAG_LIFT_Y_PX)}px`,
	};
});
const draggedCard = computed(() => {
	if (dragState.value === null || vm.currentTask === null) {
		return null;
	}
	return vm.currentTask[dragState.value.draggedIndex] ?? null;
});
const previewSelection = computed(() => {
	const activeDrag = dragState.value;
	if (activeDrag === null) {
		return {
			leastIndex: leastIndex.value,
			mostIndex: mostIndex.value,
		};
	}
	const outcome = getDraggedOutcome(displayOrder.value, mostIndex.value, leastIndex.value, activeDrag.draggedIndex, activeDrag.hoveredSlot);
	return {
		leastIndex: outcome.leastIndex,
		mostIndex: outcome.mostIndex,
	};
});
const canSubmit = computed(() => mostIndex.value !== null && leastIndex.value !== null);
const canSubmitPreview = computed(() => previewSelection.value.mostIndex !== null && previewSelection.value.leastIndex !== null);

watch([mostIndex, leastIndex], () => {
	if (canSubmit.value) {
		buttonRowRef.value?.scrollIntoView({
			behavior: prefersReducedMotion.value ? "auto" : "smooth",
			block: "nearest",
		});
	}
});

onMounted(() => {
	const result = vm.initialize();
	if (result === "no-data") {
		void router.replace({ name: "findMeaning", params: { sessionId } });
		return;
	}
	if (result === "skip") {
		void router.replace({ name: "explore", params: { sessionId } });
		return;
	}
	const redo = vm.pendingRedo;
	if (redo !== null && vm.currentTask !== null) {
		interaction.restoreSelection(vm.currentTask, redo.bestId, redo.worstId);
	}
});

onBeforeUnmount(() => {
	removeWindowDragListeners();
	if (dragState.value !== null) {
		releasePointerCapture(dragState.value.pointerId);
	}
});

function setSlotRef(slotIndex: number, element: Element | null): void {
	slotRefs.value[slotIndex] = element instanceof HTMLElement ? element : null;
}

function measureSlotRects(stageRect: DOMRect): SlotRect[] | null {
	const result: SlotRect[] = [];
	for (const slotElement of slotRefs.value) {
		if (slotElement === null) {
			return null;
		}
		const rect = slotElement.getBoundingClientRect();
		result.push({ top: rect.top - stageRect.top, height: rect.height });
	}
	return result;
}

function clearDragState(): void {
	if (dragBorderFrameId !== null) {
		cancelAnimationFrame(dragBorderFrameId);
		dragBorderFrameId = null;
	}
	if (settleFrameId !== null) {
		cancelAnimationFrame(settleFrameId);
		settleFrameId = null;
	}
	removeWindowDragListeners();
	if (dragState.value !== null) {
		releasePointerCapture(dragState.value.pointerId);
	}
	activeCardTransitions.clear();
	dragState.value = null;
}

function scheduleDragBorderFadeIn(): void {
	if (dragBorderFrameId !== null) {
		cancelAnimationFrame(dragBorderFrameId);
	}
	dragBorderFrameId = requestAnimationFrame(() => {
		dragBorderFrameId = null;
		const activeDrag = dragState.value;
		if (activeDrag?.phase !== "dragging") {
			return;
		}
		dragState.value = {
			...activeDrag,
			borderVisible: true,
		};
	});
}

async function finalizeSettledDrag(): Promise<void> {
	const activeDrag = dragState.value;
	if (activeDrag?.phase !== "settling") {
		return;
	}
	if (activeDrag.hoveredSlot === activeDrag.originSlot) {
		clearDragState();
		return;
	}
	suppressMotion.value = true;
	interaction.applyDraggedOrder(activeDrag.draggedIndex, activeDrag.hoveredSlot);
	clearDragState();
	await nextTick();
	suppressMotion.value = false;
}

function maybeFinalizeSettledDrag(): void {
	if (dragState.value?.phase !== "settling") {
		return;
	}
	if (activeCardTransitions.size === 0) {
		void finalizeSettledDrag();
	}
}

function handleAnimatedTransformStart(key: string, event: TransitionEvent): void {
	if (event.propertyName !== "transform") {
		return;
	}
	activeCardTransitions.add(key);
}

function handleAnimatedTransformFinish(key: string, event: TransitionEvent): void {
	if (event.propertyName !== "transform") {
		return;
	}
	activeCardTransitions.delete(key);
	maybeFinalizeSettledDrag();
}

function getCardShellStyle(index: number): Record<string, string> {
	const activeDrag = dragState.value;
	if (activeDrag === null || activeDrag.draggedIndex === index) {
		return {};
	}
	const currentSlot = displayOrder.value.indexOf(index);
	if (currentSlot < 0 || currentSlot >= activeDrag.slotRects.length) {
		return {};
	}
	const targetOrder = moveCardToSlot(displayOrder.value, activeDrag.draggedIndex, activeDrag.hoveredSlot);
	const targetSlot = targetOrder.indexOf(index);
	if (targetSlot < 0 || targetSlot >= activeDrag.slotRects.length) {
		return {};
	}
	const targetTops = computeLayoutTops(targetOrder, activeDrag.cardHeights, activeDrag.slotRects[0].top, activeDrag.slotGap);
	const offsetY = targetTops[targetSlot] - activeDrag.slotRects[currentSlot].top;
	if (offsetY === 0) {
		return {};
	}
	return {
		transform: `translateY(${String(offsetY)}px)`,
	};
}

function isDraggedCard(index: number): boolean {
	return dragState.value?.draggedIndex === index;
}

const dropTargetStyle = computed(() => {
	const activeDrag = dragState.value;
	if (activeDrag === null) {
		return null;
	}
	const targetOrder = moveCardToSlot(displayOrder.value, activeDrag.draggedIndex, activeDrag.hoveredSlot);
	const targetTops = computeLayoutTops(targetOrder, activeDrag.cardHeights, activeDrag.slotRects[0].top, activeDrag.slotGap);
	return {
		top: `${String(targetTops[activeDrag.hoveredSlot])}px`,
		height: `${String(activeDrag.cardHeights[activeDrag.draggedIndex])}px`,
	};
});

function handleMost(index: number): void {
	if (dragState.value !== null) {
		return;
	}
	interaction.chooseMost(index);
}

function handleLeast(index: number): void {
	if (dragState.value !== null) {
		return;
	}
	interaction.chooseLeast(index);
}

function addWindowDragListeners(): void {
	window.addEventListener("pointermove", handleWindowPointerMove);
	window.addEventListener("pointerup", handleWindowPointerUp);
	window.addEventListener("pointercancel", handleWindowPointerCancel);
}

function removeWindowDragListeners(): void {
	window.removeEventListener("pointermove", handleWindowPointerMove);
	window.removeEventListener("pointerup", handleWindowPointerUp);
	window.removeEventListener("pointercancel", handleWindowPointerCancel);
}

function handleCardPointerDown(event: PointerEvent, index: number): void {
	if (dragState.value !== null) {
		return;
	}
	if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
		return;
	}
	const target = event.target;
	if (target instanceof Element && target.closest("button") !== null) {
		return;
	}
	const currentTarget = event.currentTarget;
	const stage = cardStageRef.value;
	if (!(currentTarget instanceof HTMLElement) || stage === null) {
		return;
	}
	const cardElement = currentTarget.querySelector<HTMLElement>(".ranking-card");
	if (cardElement === null) {
		return;
	}
	const stageRect = stage.getBoundingClientRect();
	const cardRect = cardElement.getBoundingClientRect();
	const slotRects = measureSlotRects(stageRect);
	if (slotRects === null) {
		return;
	}
	const currentSlot = displayOrder.value.indexOf(index);
	if (currentSlot < 0) {
		return;
	}
	const cardHeights: number[] = [];
	for (let slotIndex = 0; slotIndex < displayOrder.value.length; slotIndex++) {
		const cardIndex = displayOrder.value[slotIndex];
		cardHeights[cardIndex] = slotRects[slotIndex].height;
	}
	const slotGap = slotRects.length >= 2 ? slotRects[1].top - (slotRects[0].top + slotRects[0].height) : 0;
	activeCardTransitions.clear();
	dragState.value = {
		borderVisible: false,
		cardHeight: cardRect.height,
		cardHeights,
		draggedIndex: index,
		hoveredSlot: currentSlot,
		liftX: DRAG_LIFT_X_PX,
		originSlot: currentSlot,
		overlayTop: cardRect.top - stageRect.top - DRAG_LIFT_Y_PX,
		phase: "dragging",
		pointerId: event.pointerId,
		pointerOffsetY: event.clientY - cardRect.top,
		slotGap,
		slotRects,
	};
	scheduleDragBorderFadeIn();
	pointerCaptureElement.value = currentTarget;
	currentTarget.setPointerCapture(event.pointerId);
	addWindowDragListeners();
	event.preventDefault();
}

function handleWindowPointerMove(event: PointerEvent): void {
	const activeDrag = dragState.value;
	if (activeDrag?.pointerId !== event.pointerId) {
		return;
	}
	const stage = cardStageRef.value;
	if (stage === null) {
		return;
	}
	const stageRect = stage.getBoundingClientRect();
	const overlayTop = event.clientY - stageRect.top - activeDrag.pointerOffsetY - DRAG_LIFT_Y_PX;
	const pointerY = event.clientY - stageRect.top;
	const nextHoveredSlot = findClosestSlotIndex(activeDrag.slotRects, pointerY);
	dragState.value = {
		...activeDrag,
		hoveredSlot: nextHoveredSlot,
		overlayTop,
	};
}

function releasePointerCapture(pointerId: number): void {
	const captureElement = pointerCaptureElement.value;
	if (captureElement?.hasPointerCapture(pointerId)) {
		captureElement.releasePointerCapture(pointerId);
	}
	pointerCaptureElement.value = null;
}

function handleWindowPointerUp(event: PointerEvent): void {
	const activeDrag = dragState.value;
	if (activeDrag?.pointerId !== event.pointerId) {
		return;
	}
	removeWindowDragListeners();
	releasePointerCapture(event.pointerId);
	const previewOrder = moveCardToSlot(displayOrder.value, activeDrag.draggedIndex, activeDrag.hoveredSlot);
	const settleSlot = previewOrder.indexOf(activeDrag.draggedIndex);
	const targetTops = computeLayoutTops(previewOrder, activeDrag.cardHeights, activeDrag.slotRects[0].top, activeDrag.slotGap);
	const settleTop = targetTops[settleSlot] ?? activeDrag.overlayTop;
	const overlayWillMove = Math.abs(settleTop - activeDrag.overlayTop) > 0.5 || activeDrag.liftX !== 0;
	dragState.value = {
		...activeDrag,
		borderVisible: false,
		phase: "settling",
	};
	if (prefersReducedMotion.value) {
		void finalizeSettledDrag();
		return;
	}
	if (overlayWillMove) {
		settleFrameId = requestAnimationFrame(() => {
			settleFrameId = null;
			const settlingDrag = dragState.value;
			if (settlingDrag?.phase !== "settling") {
				return;
			}
			dragState.value = {
				...settlingDrag,
				liftX: 0,
				overlayTop: settleTop,
			};
		});
	} else {
		maybeFinalizeSettledDrag();
	}
}

function handleWindowPointerCancel(event: PointerEvent): void {
	if (dragState.value?.pointerId !== event.pointerId) {
		return;
	}
	removeWindowDragListeners();
	releasePointerCapture(event.pointerId);
	clearDragState();
}

function handleNext(): void {
	const best = previewSelection.value.mostIndex;
	const worst = previewSelection.value.leastIndex;
	if (best === null || worst === null) return;
	vm.choose(best, worst);
	interaction.reset();
	clearDragState();
	if (vm.isComplete) {
		void nextTick(() => {
			endStateRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	} else {
		const redo = vm.pendingRedo;
		if (redo !== null && vm.currentTask !== null) {
			interaction.restoreSelection(vm.currentTask, redo.bestId, redo.worstId);
		}
	}
}

function handleUndo(): void {
	const { bestId, worstId } = vm.undo();
	clearDragState();
	interaction.restoreSelection(vm.currentTask, bestId, worstId);
}

function handleFinish(): void {
	vm.finalize();
	void router.push({ name: "explore", params: { sessionId } });
}
</script>

<template>
	<main>
		<header>
			<h1>Find meaning — rank</h1>
			<div v-if="!vm.isComplete" class="instruction-stack">
				<p class="instruction active">Select your most and least meaningful sources of meaning, or drag one into one of the three slots.</p>
			</div>
			<p v-if="vm.estimatedRemaining !== null && vm.estimatedRemaining !== 0" class="remaining-text">Estimated {{ String(Math.ceil(vm.estimatedRemaining)) }} {{ Math.ceil(vm.estimatedRemaining) === 1 ? "task" : "tasks" }} remaining.</p>
		</header>

		<div v-if="!vm.isComplete" class="ranking-area">
			<div v-if="vm.currentTask !== null" :key="vm.round">
				<div ref="cardStageRef" class="card-stage" :class="{ settling: isSettling, 'motion-suppressed': suppressMotion }">
					<component :is="cardListComponent" v-bind="cardListProps" class="card-triad">
						<div v-for="(idx, slotIndex) in displayOrder" :key="vm.currentTask[idx].id" :ref="(element) => setSlotRef(slotIndex, element as Element | null)" class="ranking-slot" @pointerdown="handleCardPointerDown($event, idx)">
							<div class="ranking-slot-shell" :class="{ animated: dragState !== null && dragState.draggedIndex !== idx }" :style="getCardShellStyle(idx)" @transitionrun="handleAnimatedTransformStart(`card-${String(idx)}`, $event)" @transitionend="handleAnimatedTransformFinish(`card-${String(idx)}`, $event)" @transitioncancel="handleAnimatedTransformFinish(`card-${String(idx)}`, $event)">
								<div class="card-hrule ranking-card" :class="{ spacer: isDraggedCard(idx) }" :aria-hidden="isDraggedCard(idx)">
									<div class="card-title">{{ vm.currentTask[idx].source }}</div>
									<div class="card-body">{{ vm.currentTask[idx].description }}</div>
									<span class="chip chip-positioned chip-success ranking-chip ranking-chip-top" :style="{ opacity: previewSelection.mostIndex === idx ? 1 : 0 }">Most important</span>
									<div class="card-buttons">
										<ToggleButton variant="primary" :active="previewSelection.mostIndex === idx" :disabled="isSettling || isDraggedCard(idx)" @toggle="handleMost(idx)">↑</ToggleButton>
										<ToggleButton variant="neutral" :active="previewSelection.leastIndex === idx" :disabled="isSettling || isDraggedCard(idx)" @toggle="handleLeast(idx)">↓</ToggleButton>
									</div>
									<span class="chip chip-positioned chip-neutral ranking-chip ranking-chip-bottom" :style="{ opacity: previewSelection.leastIndex === idx ? 1 : 0 }">Least important</span>
								</div>
							</div>
						</div>
					</component>
					<div v-if="dropTargetStyle !== null" class="drop-target-indicator" :style="dropTargetStyle" />
					<div v-if="draggedCard !== null" class="drag-overlay">
						<div class="drag-overlay-card" :class="{ settling: isSettling }" :style="dragOverlayStyle" @transitionrun="handleAnimatedTransformStart('overlay', $event)" @transitionend="handleAnimatedTransformFinish('overlay', $event)" @transitioncancel="handleAnimatedTransformFinish('overlay', $event)">
							<div class="card-hrule ranking-card" :class="{ 'border-visible': dragState?.borderVisible, dragging: true, settling: isSettling }">
								<div class="card-title">{{ draggedCard.source }}</div>
								<div class="card-body">{{ draggedCard.description }}</div>
								<span class="chip chip-positioned chip-success ranking-chip ranking-chip-top" :style="{ opacity: previewSelection.mostIndex === dragState?.draggedIndex ? 1 : 0 }">Most important</span>
								<div class="card-buttons">
									<ToggleButton variant="primary" :active="previewSelection.mostIndex === dragState?.draggedIndex" disabled>↑</ToggleButton>
									<ToggleButton variant="neutral" :active="previewSelection.leastIndex === dragState?.draggedIndex" disabled>↓</ToggleButton>
								</div>
								<span class="chip chip-positioned chip-neutral ranking-chip ranking-chip-bottom" :style="{ opacity: previewSelection.leastIndex === dragState?.draggedIndex ? 1 : 0 }">Least important</span>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div v-else key="blank" class="card-triad">
				<div class="card-hrule ranking-card blank" aria-hidden="true" />
				<div class="card-hrule ranking-card blank" aria-hidden="true" />
				<div class="card-hrule ranking-card blank" aria-hidden="true" />
			</div>

			<div ref="buttonRowRef" class="button-row">
				<AppButton variant="secondary" emphasis="muted" :disabled="!vm.canUndo" @click="handleUndo">Back</AppButton>
				<AppButton variant="primary" :disabled="!canSubmitPreview" @click="handleNext">Next</AppButton>
			</div>
		</div>

		<div v-else ref="endStateRef" class="end-state">
			<p style="margin-bottom: var(--space-4)">You're done! Here are your top sources of meaning:</p>
			<ul class="checkmark-list">
				<li v-for="card in vm.topKDisplayOrder" :key="card.id">
					<strong>{{ card.source }}</strong> — {{ card.description }}
				</li>
			</ul>
			<p class="next-step-hint">Next, you'll explore what each one means to you.</p>
			<div class="button-row">
				<AppButton variant="secondary" emphasis="muted" :disabled="!vm.canUndo" @click="handleUndo">Back</AppButton>
				<AppButton variant="primary" @click="handleFinish">Explore meaning</AppButton>
			</div>
		</div>
	</main>
</template>

<style scoped>
main {
	--card-bleed-left: var(--space-2);
	--card-bleed-right: 0px;
	max-width: 36rem;
	margin: var(--space-8) auto;
	padding: 0 var(--space-6);
	color: var(--color-black);
}

header {
	margin-bottom: var(--space-8);
}

h1 {
	margin: 0 0 var(--space-1);
}

.next-step-hint {
	margin: 0 0 var(--space-4);
	line-height: 1.5;
}

.next-step-hint:last-of-type {
	margin-bottom: var(--space-6);
}

.remaining-text {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	margin: 0;
}

.card-triad {
	display: flex;
	flex-direction: column;
	margin-bottom: var(--space-6);
}

.card-stage {
	position: relative;
}

.card-move {
	transition: transform 0.3s ease;
	position: relative;
	z-index: 1;
}

.ranking-slot {
	position: relative;
}

.ranking-slot-shell {
	position: relative;
	z-index: 1;
}

.ranking-slot-shell.animated {
	transition: transform 0.18s ease;
}

.drop-target-indicator {
	position: absolute;
	left: calc(-1 * var(--card-bleed-left));
	right: calc(-1 * var(--card-bleed-right));
	box-sizing: border-box;
	background: var(--color-gray-50);
	border: 1px dashed var(--color-gray-200);
	pointer-events: none;
	z-index: 2;
}

.motion-suppressed .ranking-slot-shell.animated {
	transition: none;
}

.ranking-slot {
	border-top: var(--border-thin);
	border-bottom: var(--border-thin);
}

.ranking-slot + .ranking-slot {
	margin-top: -1px;
}

.ranking-card {
	/* Extend cards into the page's horizontal padding. */
	margin-left: calc(-1 * var(--card-bleed-left));
	margin-right: calc(-1 * var(--card-bleed-right));
	padding-left: var(--card-bleed-left);
	padding-right: var(--card-bleed-right);
	border-top: none;
	border-bottom: none;
	display: grid;
	grid-template-columns: 1fr auto auto;
	grid-template-rows: auto auto 1fr auto;
	grid-template-areas:
		"title chip-top chip-top"
		"title .        buttons"
		"body  body     buttons"
		".     chip-btm chip-btm";
	column-gap: var(--space-4);
	row-gap: var(--space-2);
	touch-action: none;
	user-select: none;
}

.ranking-card.blank {
	cursor: default;
}

.ranking-card.spacer {
	visibility: hidden;
}

.drag-overlay {
	position: absolute;
	inset: 0 0 auto;
	pointer-events: none;
	z-index: 3;
}

.drag-overlay-card {
	will-change: transform;
}

.drag-overlay-card.settling {
	transition: transform 0.18s ease;
}

.motion-suppressed .drag-overlay-card.settling {
	transition: none;
}

.ranking-card.dragging {
	--drag-entry-duration: 0.06s;
	background: var(--color-white);
	animation: drag-lift var(--drag-entry-duration) ease-out;
	position: relative;
	cursor: grabbing;
}

.ranking-card.dragging::after {
	content: "";
	position: absolute;
	inset: 0;
	border: 2px solid var(--color-green-600);
	opacity: 0;
	pointer-events: none;
	transition: opacity var(--drag-entry-duration) ease-out;
	will-change: opacity;
}

.ranking-card.dragging.border-visible::after {
	opacity: 1;
}

@keyframes drag-lift {
	from {
		transform: translate(calc(var(--drag-lift-x) * -1), var(--drag-lift-y));
	}

	to {
		transform: translate(0, 0);
	}
}

.card-stage.settling {
	pointer-events: none;
}

.ranking-slot :deep(button) {
	touch-action: manipulation;
}

.card-title {
	grid-area: title;
	min-width: 0;
	margin-bottom: 0;
}

.card-body {
	grid-area: body;
	min-width: 0;
	min-height: calc(2 * var(--text-base) * var(--leading-relaxed));
}

.ranking-chip {
	justify-self: end;
}

.ranking-chip-top {
	grid-area: chip-top;
	align-self: start;
	/* Negate .card-hrule vertical padding to make chip flush with top edge. */
	margin-top: calc(-1 * var(--space-5));
}

.ranking-chip-bottom {
	grid-area: chip-btm;
	align-self: end;
	/* Negate .card-hrule vertical padding to make chip flush with bottom edge. */
	margin-bottom: calc(-1 * var(--space-5));
}

.card-buttons {
	grid-area: buttons;
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: var(--space-2);
	padding-right: var(--space-2);
}

.button-row {
	display: flex;
	justify-content: center;
	gap: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
	.card-move {
		transition: none;
	}

	.ranking-slot-shell.animated {
		transition: none;
	}

	.drag-overlay-card.settling {
		transition: none;
	}

	.ranking-card.dragging {
		animation: none;
	}

	.ranking-card.dragging::after {
		transition: none;
	}

	.ranking-chip {
		transition: none;
	}
}
</style>
