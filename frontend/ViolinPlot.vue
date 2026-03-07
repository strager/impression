<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		values: { value: number; correctness?: "perfect" | "good-enough" | "incorrect" }[];
		maxValue: number;
		width?: number;
		height?: number;
	}>(),
	{ width: 200, height: 30 },
);

const dotRadius = 2.5;
const margin = 10;

function toX(value: number): number {
	return margin + (value / props.maxValue) * (props.width - 2 * margin);
}

const midY = computed(() => props.height / 2);

// Kernel density estimation along the horizontal axis.
// Returns an array of { x, density } samples.
const densityCurve = computed(() => {
	const vals = props.values.map((v) => v.value);
	if (vals.length < 2) return [];

	// Silverman bandwidth
	const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
	const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
	const sd = Math.sqrt(variance);
	const bw = Math.max(1.06 * sd * vals.length ** -0.2, props.maxValue * 0.02);

	const steps = 60;
	const points: { x: number; density: number }[] = [];
	let maxDensity = 0;
	for (let i = 0; i <= steps; i++) {
		const xVal = (i / steps) * props.maxValue;
		let density = 0;
		for (const v of vals) {
			const z = (xVal - v) / bw;
			density += Math.exp(-0.5 * z * z);
		}
		density /= vals.length * bw * Math.sqrt(2 * Math.PI);
		if (density > maxDensity) maxDensity = density;
		points.push({ x: xVal, density });
	}

	// Normalize so max density maps to half the SVG height (minus vertical margin)
	const maxHalf = props.height / 2 - dotRadius / 2;
	if (maxDensity > 0) {
		for (const p of points) {
			p.density = (p.density / maxDensity) * maxHalf;
		}
	}

	return points;
});

// SVG path for the mirrored violin shape.
const violinPath = computed(() => {
	const pts = densityCurve.value;
	if (pts.length === 0) return "";
	const mid = midY.value;

	// Top edge: left to right
	let d = `M ${String(toX(pts[0].x))} ${String(mid - pts[0].density)}`;
	for (let i = 1; i < pts.length; i++) {
		d += ` L ${String(toX(pts[i].x))} ${String(mid - pts[i].density)}`;
	}
	// Bottom edge: right to left (mirrored)
	for (let i = pts.length - 1; i >= 0; i--) {
		d += ` L ${String(toX(pts[i].x))} ${String(mid + pts[i].density)}`;
	}
	d += " Z";
	return d;
});

const medianX = computed(() => {
	if (props.values.length === 0) return 0;
	const sorted = [...props.values].map((v) => v.value).sort((a, b) => a - b);
	return toX(sorted[Math.floor(sorted.length / 2)]);
});

// Density at the median point, for sizing the median tick to the violin shape.
const medianHalfHeight = computed(() => {
	const pts = densityCurve.value;
	if (pts.length === 0) return props.height / 2 - dotRadius / 2;
	const medVal = props.values.length === 0 ? 0 : [...props.values].map((v) => v.value).sort((a, b) => a - b)[Math.floor(props.values.length / 2)];
	// Find closest density sample
	let best = pts[0];
	let bestDist = Math.abs(pts[0].x - medVal);
	for (let i = 1; i < pts.length; i++) {
		const dist = Math.abs(pts[i].x - medVal);
		if (dist < bestDist) {
			bestDist = dist;
			best = pts[i];
		}
	}
	return best.density;
});

// Place dots inside the violin body using beeswarm-style stacking.
// Sort by value, then stack dots vertically within the violin width at each x.
const dotPositions = computed(() => {
	const mid = midY.value;
	const r = dotRadius;
	const sorted = [...props.values].map((v, i) => ({ ...v, origIndex: i })).sort((a, b) => a.value - b.value);

	const placed: { cx: number; cy: number; correctness: "perfect" | "good-enough" | "incorrect" }[] = [];
	for (const v of sorted) {
		const cx = toX(v.value);
		// Try cy = mid first, then alternate above/below
		let bestCy = mid;
		for (let attempt = 0; attempt < 20; attempt++) {
			const sign = attempt % 2 === 0 ? -1 : 1;
			const offset = Math.ceil(attempt / 2) * (r * 1.8);
			const cy = mid + sign * offset;
			// Check no overlap with already-placed dots
			let overlaps = false;
			for (const p of placed) {
				const dx = cx - p.cx;
				const dy = cy - p.cy;
				if (dx * dx + dy * dy < r * 2 * (r * 2)) {
					overlaps = true;
					break;
				}
			}
			if (!overlaps) {
				bestCy = cy;
				break;
			}
		}
		placed.push({ cx, cy: bestCy, correctness: v.correctness ?? "perfect" });
	}
	return placed;
});
</script>

<template>
	<svg :width="props.width" :height="props.height" class="violin-plot">
		<!-- Violin shape -->
		<path v-if="violinPath" :d="violinPath" fill="#e0e0e0" stroke="#bbb" stroke-width="0.5" />
		<!-- Median tick -->
		<line :x1="medianX" :y1="midY - medianHalfHeight" :x2="medianX" :y2="midY + medianHalfHeight" stroke="#888" stroke-width="1.5" />
		<!-- Data points (beeswarm) — perfect and good-enough dots first -->
		<template v-for="(dot, i) in dotPositions" :key="'d' + String(i)">
			<circle v-if="dot.correctness === 'perfect'" :cx="dot.cx" :cy="dot.cy" :r="dotRadius" fill="#2a6e4e" opacity="0.85" />
			<circle v-else-if="dot.correctness === 'good-enough'" :cx="dot.cx" :cy="dot.cy" :r="dotRadius" fill="#d97706" opacity="0.85" />
		</template>
		<!-- Red X's on top (incorrect) -->
		<template v-for="(dot, i) in dotPositions" :key="'r' + String(i)">
			<g v-if="dot.correctness === 'incorrect'" opacity="0.85">
				<line :x1="dot.cx - dotRadius" :y1="dot.cy - dotRadius" :x2="dot.cx + dotRadius" :y2="dot.cy + dotRadius" stroke="#dc2626" stroke-width="1.5" />
				<line :x1="dot.cx + dotRadius" :y1="dot.cy - dotRadius" :x2="dot.cx - dotRadius" :y2="dot.cy + dotRadius" stroke="#dc2626" stroke-width="1.5" />
			</g>
		</template>
	</svg>
</template>

<style scoped>
.violin-plot {
	display: block;
}
</style>
