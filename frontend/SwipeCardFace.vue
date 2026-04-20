<script setup lang="ts">
import { computed } from "vue";

import type { MeaningCard, SwipeDirection } from "../shared/meaning-cards.ts";

const props = withDefaults(
	defineProps<{
		card: MeaningCard;
		direction?: SwipeDirection | null;
		overlayOpacity?: number;
		labelOpacity?: number;
		showSource?: boolean;
	}>(),
	{ direction: null, overlayOpacity: 0, labelOpacity: 0, showSource: false },
);

const DIRECTION_COLORS: Record<SwipeDirection, string> = {
	agree: "42, 110, 78",
	disagree: "85, 85, 85",
	unsure: "115, 115, 115",
};

const LABELS: Record<SwipeDirection, string> = {
	agree: "Agree ✓",
	disagree: "Disagree ✕",
	unsure: "Unsure ？",
};

const overlayStyle = computed((): Record<string, string> => {
	if (props.direction === null) return {};
	const color = DIRECTION_COLORS[props.direction];
	const borderStyle = props.direction === "unsure" ? "dashed" : "solid";
	return {
		background: `rgba(${color}, ${String(props.overlayOpacity)})`,
		border: `2px ${borderStyle} rgba(${color}, ${String(props.labelOpacity)})`,
	};
});
</script>

<template>
	<div class="face">
		<div v-if="direction !== null" class="face-overlay" :style="overlayStyle" />
		<span v-if="direction !== null" class="face-label" :class="`face-label-${direction}`" :style="{ opacity: labelOpacity }">
			{{ LABELS[direction] }}
		</span>
		<p class="face-text">
			{{ card.description }} <span v-if="showSource" class="face-source">({{ card.source }})</span>
		</p>
	</div>
</template>

<style scoped>
.face {
	position: absolute;
	inset: 0;
	box-sizing: border-box;
	padding: var(--space-8);
	display: flex;
	flex-direction: column;
	justify-content: center;
	overflow: hidden;
}

.face-overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
	transition:
		background 0.1s ease,
		border 0.1s ease;
}

.face-label {
	position: absolute;
	top: 1rem;
	font-size: var(--text-lg);
	font-weight: 700;
	pointer-events: none;
}

.face-label-agree {
	left: 1rem;
	color: var(--color-green-600);
}

.face-label-disagree {
	right: 1rem;
	color: var(--color-gray-600);
}

.face-label-unsure {
	left: 50%;
	transform: translateX(-50%);
	color: var(--color-gray-400);
}

.face-source {
	font-weight: 300;
	color: var(--color-gray-600);
}

.face-text {
	font-size: var(--text-2xl);
	line-height: 1.3;
	margin: 0;
	color: var(--color-black);
	position: relative;
	z-index: 1;
}
</style>
