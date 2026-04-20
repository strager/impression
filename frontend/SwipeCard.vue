<script setup lang="ts">
import { computed, ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import type { SwipeDirection } from "../shared/meaning-cards.ts";
import SwipeCardFace from "./SwipeCardFace.vue";

const props = withDefaults(
	defineProps<{
		card: MeaningCard;
		nextCard?: MeaningCard | null;
		allowUnsure?: boolean;
		showSource?: boolean;
	}>(),
	{ nextCard: null, allowUnsure: true, showSource: false },
);

const emit = defineEmits<{
	swiped: [payload: { direction: SwipeDirection; fromX: number; fromY: number }];
}>();

const SWIPE_THRESHOLD = 100;

const isDragging = ref(false);
const startX = ref(0);
const startY = ref(0);
const offsetX = ref(0);
const offsetY = ref(0);

const dominantDirection = computed<SwipeDirection | null>(() => {
	const ax = Math.abs(offsetX.value);
	const ay = Math.abs(offsetY.value);
	if (ax < 10 && ay < 10) return null;
	// Swipe up: 45° cone (same as before). Swipe left/right: everything
	// above horizontal. Swipe down: dead zone narrowed to 30° from
	// straight down; the rest goes to left/right.
	if (offsetY.value < 0 && ay >= ax) {
		// Swiping upward and angle is within 45° of vertical.
		if (!props.allowUnsure) return null;
		return "unsure";
	}
	if (offsetY.value >= 0) {
		// Swiping downward: only a narrow 30° cone from straight down
		// is a dead zone; the rest counts as horizontal.
		const downDeadZone = Math.PI / 6; // 30° from vertical
		const angle = Math.atan2(ay, ax); // 0 = horizontal, π/2 = vertical
		if (angle > Math.PI / 2 - downDeadZone) return null;
	}
	return offsetX.value > 0 ? "agree" : "disagree";
});

const pastThreshold = computed(() => {
	const ax = Math.abs(offsetX.value);
	const ay = Math.abs(offsetY.value);
	return Math.max(ax, ay) >= SWIPE_THRESHOLD;
});

const overlayOpacity = computed(() => {
	if (!isDragging.value) return 0;
	const ax = Math.abs(offsetX.value);
	const ay = Math.abs(offsetY.value);
	const dist = Math.max(ax, ay);
	return Math.min(dist / SWIPE_THRESHOLD, 1) * 0.25;
});

const labelOpacity = computed(() => {
	if (!isDragging.value) return 0;
	const ax = Math.abs(offsetX.value);
	const ay = Math.abs(offsetY.value);
	const dist = Math.max(ax, ay);
	return Math.min(Math.max((dist - 30) / (SWIPE_THRESHOLD - 30), 0), 1);
});

const cardStyle = computed(() => {
	if (!isDragging.value) {
		return { transition: "transform 0.3s ease" };
	}
	const rotate = offsetX.value * 0.08;
	return {
		transform: `translate(${String(offsetX.value)}px, ${String(offsetY.value)}px) rotate(${String(rotate)}deg)`,
		transition: "none",
	};
});

function onPointerDown(e: PointerEvent): void {
	isDragging.value = true;
	startX.value = e.clientX;
	startY.value = e.clientY;
	offsetX.value = 0;
	offsetY.value = 0;
	if (!(e.currentTarget instanceof HTMLElement)) {
		throw new Error("Expected currentTarget to be an HTMLElement");
	}
	e.currentTarget.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
	if (!isDragging.value) return;
	offsetX.value = e.clientX - startX.value;
	offsetY.value = e.clientY - startY.value;
}

function onPointerUp(): void {
	if (!isDragging.value) return;
	isDragging.value = false;

	if (pastThreshold.value && dominantDirection.value !== null) {
		emit("swiped", { direction: dominantDirection.value, fromX: offsetX.value, fromY: offsetY.value });
	} else {
		offsetX.value = 0;
		offsetY.value = 0;
	}
}
</script>

<template>
	<div class="swipe-card-viewport">
		<div class="swipe-card-stack">
			<div v-if="nextCard" class="swipe-card-surface peek-card">
				<SwipeCardFace :card="nextCard" :show-source="showSource" />
			</div>
			<div class="swipe-card-surface swipe-card" :style="cardStyle" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp">
				<SwipeCardFace :card="card" :direction="dominantDirection" :overlay-opacity="overlayOpacity" :label-opacity="labelOpacity" :show-source="showSource" />
			</div>
		</div>
	</div>
</template>

<style scoped>
/* Stretch to full viewport width so overflow-x clips at screen edges,
   not at the parent's max-width boundary. 50% is half the parent's
   width; -50vw pulls back half the viewport. The difference cancels
   out the centering offset, aligning our left edge with the viewport. */
.swipe-card-viewport {
	width: 100vw;
	margin-left: calc(-50vw + 50%);
	overflow-x: clip;
	display: flex;
	justify-content: center;
}

.swipe-card-stack {
	position: relative;
	width: 100%;
	max-width: 20rem;
}

.peek-card {
	position: absolute;
	inset: 0;
	z-index: 0;
	pointer-events: none;
}

.swipe-card {
	position: relative;
	z-index: 1;
	margin: 0 auto;
	cursor: grab;
	user-select: none;
	touch-action: none;
}

.swipe-card:active {
	cursor: grabbing;
}
</style>
