<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		runs: { estimatedMidPerRound: (number | null)[]; round: number }[];
		width?: number;
		height?: number;
	}>(),
	{ width: 200, height: 80 },
);

const margin = { top: 4, right: 4, bottom: 4, left: 4 };

const plotWidth = computed(() => props.width - margin.left - margin.right);
const plotHeight = computed(() => props.height - margin.top - margin.bottom);

const dots = computed(() => {
	const result: { predicted: number; actual: number; color: string }[] = [];
	const total = props.runs.length;
	for (let ri = 0; ri < total; ri++) {
		const run = props.runs[ri];
		const hue = (ri / total) * 360;
		const color = `hsl(${String(hue)}, 70%, 45%)`;
		for (let i = 0; i < run.estimatedMidPerRound.length; i++) {
			const mid = run.estimatedMidPerRound[i];
			if (mid === null) continue;
			result.push({ predicted: mid, actual: run.round - (i + 1), color });
		}
	}
	return result;
});

const axisMax = computed(() => {
	let max = 1;
	for (const d of dots.value) {
		if (d.predicted > max) max = d.predicted;
		if (d.actual > max) max = d.actual;
	}
	return max;
});

function toX(actual: number): number {
	return margin.left + (1 - actual / axisMax.value) * plotWidth.value;
}

function toY(predicted: number): number {
	return margin.top + (1 - predicted / axisMax.value) * plotHeight.value;
}

const diagonal = computed(() => ({
	x1: toX(0),
	y1: toY(0),
	x2: toX(axisMax.value),
	y2: toY(axisMax.value),
}));
</script>

<template>
	<svg :width="props.width" :height="props.height" class="remaining-estimate-plot">
		<!-- y=x reference line (perfect estimation) -->
		<line :x1="diagonal.x1" :y1="diagonal.y1" :x2="diagonal.x2" :y2="diagonal.y2" stroke="#ccc" stroke-width="1" stroke-dasharray="4 2" />
		<!-- Scatter dots -->
		<circle v-for="(dot, i) in dots" :key="i" :cx="toX(dot.actual)" :cy="toY(dot.predicted)" r="1.5" :fill="dot.color" opacity="0.5" />
	</svg>
</template>

<style scoped>
.remaining-estimate-plot {
	display: block;
}
</style>
