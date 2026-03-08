<script setup lang="ts">
import { computed, ref } from "vue";

import type { MeaningCard } from "../shared/meaning-cards.ts";
import type { SwipeDirection } from "../shared/meaning-cards.ts";

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
	swiped: [direction: SwipeDirection];
}>();

const SWIPE_THRESHOLD = 100;
const FLY_AWAY_DURATION_MS = 800;

const isDragging = ref(false);
const startX = ref(0);
const startY = ref(0);
const offsetX = ref(0);
const offsetY = ref(0);
const flyingAway = ref(false);
const flyX = ref(0);
const flyY = ref(0);
const flyDirection = ref<SwipeDirection | null>(null);
const flyDurationMs = ref(FLY_AWAY_DURATION_MS);

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

const DIRECTION_COLORS: Record<SwipeDirection, string> = {
	agree: "42, 110, 78",
	disagree: "85, 85, 85",
	unsure: "115, 115, 115",
};

const overlayColor = computed(() => {
	let dir: SwipeDirection | null;
	let opacity: number;
	if (flyingAway.value) {
		dir = flyDirection.value;
		opacity = 0.25;
	} else if (isDragging.value) {
		dir = dominantDirection.value;
		const ax = Math.abs(offsetX.value);
		const ay = Math.abs(offsetY.value);
		const dist = Math.max(ax, ay);
		opacity = Math.min(dist / SWIPE_THRESHOLD, 1) * 0.25;
	} else {
		return "transparent";
	}
	if (dir === null) return "transparent";
	return `rgba(${DIRECTION_COLORS[dir]}, ${String(opacity)})`;
});

const labelOpacity = computed(() => {
	if (flyingAway.value) return 1;
	if (!isDragging.value) return 0;
	const ax = Math.abs(offsetX.value);
	const ay = Math.abs(offsetY.value);
	const dist = Math.max(ax, ay);
	return Math.min(Math.max((dist - 30) / (SWIPE_THRESHOLD - 30), 0), 1);
});

const activeDirection = computed<SwipeDirection | null>(() => {
	if (flyingAway.value) return flyDirection.value;
	if (isDragging.value) return dominantDirection.value;
	return null;
});

const overlayStyle = computed(() => {
	const style: Record<string, string> = { background: overlayColor.value };
	const dir = activeDirection.value;
	if (dir === "unsure") {
		style.border = `2px dashed rgba(${DIRECTION_COLORS.unsure}, ${String(labelOpacity.value)})`;
	} else if (dir !== null) {
		style.border = `2px solid rgba(${DIRECTION_COLORS[dir]}, ${String(labelOpacity.value)})`;
	}
	return style;
});

const cardStyle = computed(() => {
	if (flyingAway.value) {
		const rotate = flyX.value * 0.08;
		return {
			transform: `translate(${String(flyX.value)}px, ${String(flyY.value)}px) rotate(${String(rotate)}deg)`,
			opacity: "0",
			transition: `transform ${String(flyDurationMs.value)}ms ease, opacity ${String(flyDurationMs.value)}ms ease`,
		};
	}
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
	if (flyingAway.value) return;
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
		flyAway(dominantDirection.value, 300);
	} else {
		offsetX.value = 0;
		offsetY.value = 0;
	}
}

function flyAway(direction: SwipeDirection, durationMs = FLY_AWAY_DURATION_MS): void {
	if (flyingAway.value) return;
	if (!props.allowUnsure && direction === "unsure") return;
	flyingAway.value = true;
	flyDirection.value = direction;
	flyDurationMs.value = durationMs;
	flyX.value = direction === "agree" ? 600 : direction === "disagree" ? -600 : 0;
	flyY.value = direction === "unsure" ? -400 : 0;

	globalThis.setTimeout(() => {
		emit("swiped", direction);
	}, durationMs);
}

defineExpose({ flyAway });
</script>

<template>
	<div class="swipe-card-viewport">
		<div class="swipe-card-stack">
			<div v-if="nextCard" class="card-surface peek-card">
				<p class="card-text">
					{{ nextCard.description }} <span v-if="showSource" class="card-source">({{ nextCard.source }})</span>
				</p>
			</div>
			<div class="card-surface swipe-card" :style="cardStyle" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp">
				<div class="card-overlay" :style="overlayStyle" />
				<span v-if="dominantDirection === 'agree' || flyDirection === 'agree'" class="direction-label agree" :style="{ opacity: labelOpacity }"> Agree ✓ </span>
				<span v-if="dominantDirection === 'disagree' || flyDirection === 'disagree'" class="direction-label disagree" :style="{ opacity: labelOpacity }"> Disagree ✕ </span>
				<span v-if="dominantDirection === 'unsure' || flyDirection === 'unsure'" class="direction-label unsure" :style="{ opacity: labelOpacity }"> Unsure ？ </span>
				<p class="card-text">
					{{ card.description }} <span v-if="showSource" class="card-source">({{ card.source }})</span>
				</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.card-surface {
	height: 14rem;
	padding: var(--space-8);
	background: var(--color-white);
	border: var(--border-thin);
	font-family: var(--font-heading);
}
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
	display: flex;
	flex-direction: column;
	justify-content: center;
	z-index: 0;
	pointer-events: none;
}

.swipe-card {
	position: relative;
	z-index: 1;
	margin: 0 auto;
	display: flex;
	flex-direction: column;
	justify-content: center;
	cursor: grab;
	user-select: none;
	touch-action: none;
	overflow: hidden;
}

.swipe-card:active {
	cursor: grabbing;
}

.card-overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
	transition:
		background 0.1s ease,
		border 0.1s ease;
}

.direction-label {
	position: absolute;
	top: 1rem;
	font-size: var(--text-lg);
	font-weight: 700;
	pointer-events: none;
}

.direction-label.agree {
	right: 1rem;
	color: var(--color-green-600);
}

.direction-label.disagree {
	left: 1rem;
	color: var(--color-gray-600);
}

.direction-label.unsure {
	left: 50%;
	transform: translateX(-50%);
	color: var(--color-gray-400);
}

.card-source {
	font-weight: 300;
	color: var(--color-gray-600);
}

.card-text {
	font-size: var(--text-2xl);
	line-height: 1.3;
	margin: 0;
	color: var(--color-black);
	position: relative;
	z-index: 1;
}
</style>
