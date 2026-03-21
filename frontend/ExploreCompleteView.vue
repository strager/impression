<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import { ExploreCompleteViewModel } from "./ExploreCompleteViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { splitSentences } from "./split-sentences.ts";
import { hasVisitedExploreComplete } from "./store.ts";
import { useMatchMedia } from "./use-match-media.ts";

/**
 * Debug override for the animation cascade on this page.
 * - null: auto (skip animations if the user has already visited this page for this card)
 * - true: always play animations
 * - false: always skip animations
 */
const DEBUG_FORCE_ANIMATE: boolean | null = null;

interface DeviceSize {
	width: number;
	height: number;
}

interface DeviceRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

interface LinearRGB {
	r: number;
	g: number;
	b: number;
}

const PULSE_DURATION_MS = 1000;
const PULSE_OVERSHOOT_PX = 6; // CSS pixels beyond the square edge

const WHITE_LINEAR: LinearRGB = { r: 1, g: 1, b: 1 };

function srgbToLinear(c: number): number {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
	const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
	return Math.round(s * 255);
}

function parseHexColor(hex: string): LinearRGB {
	return {
		r: srgbToLinear(parseInt(hex.slice(1, 3), 16)),
		g: srgbToLinear(parseInt(hex.slice(3, 5), 16)),
		b: srgbToLinear(parseInt(hex.slice(5, 7), 16)),
	};
}

function blendColors(bg: LinearRGB, fg: LinearRGB, t: number): string {
	const r = linearToSrgb(bg.r * (1 - t) + fg.r * t);
	const g = linearToSrgb(bg.g * (1 - t) + fg.g * t);
	const b = linearToSrgb(bg.b * (1 - t) + fg.b * t);
	return `rgb(${String(r)},${String(g)},${String(b)})`;
}

class PulseAnimation {
	private animationFrameId = 0;
	private measurementObserver: ResizeObserver | null = null;

	stop(): void {
		cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = 0;
		this.measurementObserver?.disconnect();
		this.measurementObserver = null;
	}

	play(canvas: HTMLCanvasElement): void {
		this.stop();

		const ctx = canvas.getContext("2d");
		if (ctx === null) throw new Error("failed to get 2d context");

		const square = canvas.parentElement;
		if (!(square instanceof HTMLElement)) throw new Error("pulse canvas has no parent element");

		const styles = getComputedStyle(canvas);
		const activeRgb = parseHexColor(styles.getPropertyValue("--color-green-600").trim());
		const inactiveRgb = parseHexColor(styles.getPropertyValue("--color-gray-200").trim());
		const pendingEntries = new Map<Element, ResizeObserverEntry>();

		this.measurementObserver = new ResizeObserver((entries) => {
			for (const entry of entries) pendingEntries.set(entry.target, entry);

			const canvasEntry = pendingEntries.get(canvas);
			const squareEntry = pendingEntries.get(square);
			if (canvasEntry === undefined || squareEntry === undefined) return;

			this.measurementObserver?.disconnect();
			this.measurementObserver = null;

			const canvasSize = this.getDevicePixelSize(canvasEntry, canvas);
			const squareSize = this.getDevicePixelSize(squareEntry, square);
			const squareLeft = Math.round((canvasSize.width - squareSize.width) / 2);
			const squareTop = Math.round((canvasSize.height - squareSize.height) / 2);
			const squareBounds: DeviceRect = {
				left: squareLeft,
				top: squareTop,
				right: squareLeft + squareSize.width,
				bottom: squareTop + squareSize.height,
			};

			canvas.width = canvasSize.width;
			canvas.height = canvasSize.height;

			const overshoot = Math.round(PULSE_OVERSHOOT_PX * window.devicePixelRatio);
			const initialBounds: DeviceRect = {
				left: squareBounds.left - overshoot,
				top: squareBounds.top - overshoot,
				right: squareBounds.right + overshoot,
				bottom: squareBounds.bottom + overshoot,
			};

			const startTime = performance.now();
			const frame = (now: number): void => {
				const progress = Math.min(1, (now - startTime) / PULSE_DURATION_MS);
				this.renderFrame(ctx, canvasSize, initialBounds, squareBounds, activeRgb, inactiveRgb, progress);

				if (progress < 1) {
					this.animationFrameId = requestAnimationFrame(frame);
				} else {
					this.animationFrameId = 0;
				}
			};

			this.animationFrameId = requestAnimationFrame(frame);
		});

		try {
			this.measurementObserver.observe(canvas, { box: "device-pixel-content-box" });
			this.measurementObserver.observe(square, { box: "device-pixel-content-box" });
		} catch {
			// Safari does not support device-pixel-content-box.
			// getDevicePixelSize falls back to clientWidth * devicePixelRatio.
			console.warn("ResizeObserver does not support device-pixel-content-box; falling back to content-box");
			this.measurementObserver.observe(canvas);
			this.measurementObserver.observe(square);
		}
	}

	private getDevicePixelSize(entry: ResizeObserverEntry, element: HTMLElement): DeviceSize {
		const observedBox = "devicePixelContentBoxSize" in entry ? entry.devicePixelContentBoxSize : undefined;
		if (observedBox !== undefined && observedBox.length > 0) {
			return {
				width: observedBox[0].inlineSize,
				height: observedBox[0].blockSize,
			};
		}

		const dpr = window.devicePixelRatio;
		return {
			width: Math.round(element.clientWidth * dpr),
			height: Math.round(element.clientHeight * dpr),
		};
	}

	private renderFrame(ctx: CanvasRenderingContext2D, canvasSize: DeviceSize, initialBounds: DeviceRect, squareBounds: DeviceRect, activeRgb: LinearRGB, inactiveRgb: LinearRGB, progress: number): void {
		const easedProgress = 1 - (1 - progress) ** 3;

		// White background for entire canvas
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

		// Expand the settled rect by half a pixel so the antialiased edge still lands on a fully filled square.
		const antialiasNudge = 0.5;
		const settledLeft = squareBounds.left - antialiasNudge;
		const settledTop = squareBounds.top - antialiasNudge;
		const settledRight = squareBounds.right + antialiasNudge;
		const settledBottom = squareBounds.bottom + antialiasNudge;
		const animatedRect: DeviceRect = {
			left: initialBounds.left + (settledLeft - initialBounds.left) * easedProgress,
			top: initialBounds.top + (settledTop - initialBounds.top) * easedProgress,
			right: initialBounds.right + (settledRight - initialBounds.right) * easedProgress,
			bottom: initialBounds.bottom + (settledBottom - initialBounds.bottom) * easedProgress,
		};

		const leftEdge = this.getPixelCoverage(animatedRect.left, 1);
		const rightEdge = this.getPixelCoverage(animatedRect.right, -1);
		const topEdge = this.getPixelCoverage(animatedRect.top, 1);
		const bottomEdge = this.getPixelCoverage(animatedRect.bottom, -1);

		const innerLeft = leftEdge.pixel + 1;
		const innerTop = topEdge.pixel + 1;
		const innerWidth = rightEdge.pixel - leftEdge.pixel - 1;
		const innerHeight = bottomEdge.pixel - topEdge.pixel - 1;

		const opacity = easedProgress;

		const drawRect = (x: number, y: number, w: number, h: number, alpha: number): void => {
			// Blend green over white (full sub-rect)
			ctx.fillStyle = blendColors(WHITE_LINEAR, activeRgb, alpha);
			ctx.fillRect(x, y, w, h);

			// Overdraw: blend green over gray (intersection with gray rect)
			const cx = Math.max(x, squareBounds.left);
			const cy = Math.max(y, squareBounds.top);
			const cr = Math.min(x + w, squareBounds.right);
			const cb = Math.min(y + h, squareBounds.bottom);
			if (cr > cx && cb > cy) {
				ctx.fillStyle = blendColors(inactiveRgb, activeRgb, alpha);
				ctx.fillRect(cx, cy, cr - cx, cb - cy);
			}
		};

		drawRect(innerLeft, innerTop, innerWidth, innerHeight, opacity);

		drawRect(leftEdge.pixel, innerTop, 1, innerHeight, leftEdge.alpha * opacity);
		drawRect(rightEdge.pixel, innerTop, 1, innerHeight, rightEdge.alpha * opacity);
		drawRect(innerLeft, topEdge.pixel, innerWidth, 1, topEdge.alpha * opacity);
		drawRect(innerLeft, bottomEdge.pixel, innerWidth, 1, bottomEdge.alpha * opacity);

		drawRect(leftEdge.pixel, topEdge.pixel, 1, 1, leftEdge.alpha * topEdge.alpha * opacity);
		drawRect(rightEdge.pixel, topEdge.pixel, 1, 1, rightEdge.alpha * topEdge.alpha * opacity);
		drawRect(leftEdge.pixel, bottomEdge.pixel, 1, 1, leftEdge.alpha * bottomEdge.alpha * opacity);
		drawRect(rightEdge.pixel, bottomEdge.pixel, 1, 1, rightEdge.alpha * bottomEdge.alpha * opacity);
	}

	// Algorithm by Claudio Santos
	// <https://csantosbh.wordpress.com/2014/02/05/automatically-detecting-the-texture-filter-threshold-for-pixelated-magnifications/>,
	// refined by d7samurai
	// <https://gist.github.com/d7samurai/9f17966ba6130a75d1bfb0f1894ed377>.
	private getPixelCoverage(edgePosition: number, direction: 1 | -1): { pixel: number; alpha: number } {
		const pixel = Math.floor(edgePosition + direction * 0.5);
		return {
			pixel,
			alpha: (pixel + 0.5 - edgePosition) * direction,
		};
	}
}

const router = useRouter();

const sessionId = useStringParam("sessionId");
const cardId = useStringParam("meaningId");

const vm = new ExploreCompleteViewModel(sessionId, cardId);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const skipAnimations = DEBUG_FORCE_ANIMATE === null ? hasVisitedExploreComplete(sessionId, cardId) : !DEBUG_FORCE_ANIMATE;

const titleVisible = ref(false);
const warmPhraseVisible = ref(false);
const progressSquaresVisible = ref(false);
const animatedExploredCount = ref(0);
const latestSquareIndex = ref(-1);
const synthesisVisible = ref(false);
const countSwapActive = ref(false);
const primaryActionVisible = ref(false);
const secondaryActionVisible = ref(false);

const prefersReducedMotion = useMatchMedia("(prefers-reduced-motion: reduce)");
const visibilityGaps = {
	initial: prefersReducedMotion.value ? 300 : 500,
	section: prefersReducedMotion.value ? 1000 : 3000,
	sentencePerChar: prefersReducedMotion.value ? 0 : 40,
	sentenceBase: prefersReducedMotion.value ? 0 : 300,
	progressStart: prefersReducedMotion.value ? 0 : 1500,
};

interface ParagraphData {
	sentences: string[];
	startIndex: number;
}

const synthesisParagraphs = computed((): ParagraphData[] => {
	const paragraphs = vm.synthesis.split("\n").filter(Boolean);
	const result: ParagraphData[] = [];
	let idx = 0;
	for (const para of paragraphs) {
		const sentences = splitSentences(para);
		result.push({ sentences, startIndex: idx });
		idx += sentences.length;
	}
	return result;
});

const revealedSentenceCount = ref(0);

const totalSentenceCount = computed(() => synthesisParagraphs.value.reduce((sum, p) => sum + p.sentences.length, 0));

const showAllAfterIndex = computed(() => {
	const total = totalSentenceCount.value;
	const revealed = revealedSentenceCount.value;
	if (revealed <= 1 || revealed >= total || total <= 1) return -1;
	return revealed - 1;
});

const showAllLinks = ref<HTMLAnchorElement[]>([]);

watch(showAllAfterIndex, (newIndex) => {
	if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.classList.contains("show-all-btn")) return;
	if (newIndex === -1) return;
	void nextTick(() => {
		showAllLinks.value[newIndex]?.focus();
	});
});

const progressSquaresEl = ref<HTMLElement | null>(null);
const actionsEl = ref<HTMLElement | null>(null);

const timers: ReturnType<typeof setTimeout>[] = [];
const pulseCanvases = ref<HTMLCanvasElement[]>([]);
const pulseAnimation = new PulseAnimation();

function schedule(fn: () => void, delay: number): void {
	timers.push(setTimeout(fn, delay));
}

function scrollIntoView(el: HTMLElement | null | undefined): void {
	if (el === null || el === undefined) return;
	void nextTick(() => {
		el.scrollIntoView({ behavior: "smooth", block: "nearest" });
	});
}

onMounted(() => {
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "explore", params: { sessionId } });
		return;
	}

	if (skipAnimations) {
		titleVisible.value = true;
		warmPhraseVisible.value = true;
		synthesisVisible.value = true;
		revealedSentenceCount.value = Infinity;
		progressSquaresVisible.value = true;
		animatedExploredCount.value = vm.exploredCount;
		primaryActionVisible.value = true;
		secondaryActionVisible.value = true;
		return;
	}

	document.documentElement.classList.add("nav-hidden");
	animatedExploredCount.value = Math.max(0, vm.exploredCount - 1);

	let elapsed = 0;
	const revealAfter = (delay: number, fn: () => void): void => {
		elapsed += delay;
		schedule(fn, elapsed);
	};

	revealAfter(visibilityGaps.initial, () => {
		titleVisible.value = true;
	});

	revealAfter(visibilityGaps.section, () => {
		warmPhraseVisible.value = true;
	});

	revealAfter(visibilityGaps.section, () => {
		progressSquaresVisible.value = true;
		scrollIntoView(progressSquaresEl.value);
	});

	if (vm.exploredCount > 0) {
		revealAfter(visibilityGaps.progressStart, () => {
			countSwapActive.value = true;
			animatedExploredCount.value = vm.exploredCount;
			if (prefersReducedMotion.value) return;

			latestSquareIndex.value = vm.exploredCount - 1;
			pulseAnimation.play(pulseCanvases.value[latestSquareIndex.value]);
		});
	}

	const allSentences = synthesisParagraphs.value.flatMap((p) => p.sentences);
	const sentenceDurations = allSentences.map((s) => visibilityGaps.sentenceBase + s.trim().length * visibilityGaps.sentencePerChar);
	revealAfter(visibilityGaps.section, () => {
		synthesisVisible.value = true;
		revealedSentenceCount.value = 1;
	});
	for (let i = 1; i < allSentences.length; i++) {
		revealAfter(sentenceDurations[i - 1], () => {
			revealedSentenceCount.value = i + 1;
		});
	}
	if (allSentences.length === 0) {
		revealedSentenceCount.value = Infinity;
	} else {
		elapsed += sentenceDurations[sentenceDurations.length - 1];
	}

	revealAfter(visibilityGaps.section, () => {
		primaryActionVisible.value = true;
		scrollIntoView(actionsEl.value);
	});

	revealAfter(visibilityGaps.section, () => {
		secondaryActionVisible.value = true;
		scrollIntoView(actionsEl.value);
		document.documentElement.classList.remove("nav-hidden");
		vm.onAnimationComplete();
	});
});

onBeforeUnmount(() => {
	for (const t of timers) clearTimeout(t);
	pulseAnimation.stop();
	document.documentElement.classList.remove("nav-hidden");
});

function handleShowAll(): void {
	for (const t of timers) clearTimeout(t);
	revealedSentenceCount.value = Infinity;
	primaryActionVisible.value = true;
	secondaryActionVisible.value = true;
	document.documentElement.classList.remove("nav-hidden");
	vm.onAnimationComplete();
}

function handleKeepExploring(): void {
	void router.push({ name: "explore", params: { sessionId } });
}

function handleOpenReport(): void {
	void router.push({ name: "report", params: { sessionId } });
}
</script>

<template>
	<main v-if="vm.card">
		<header>
			<h1 :class="['cascading', { visible: titleVisible }]">&ldquo;{{ vm.card.description }}&rdquo;</h1>
			<p :class="['warm-phrase', 'cascading', { visible: warmPhraseVisible }]">{{ vm.warmPhrase }}</p>
		</header>

		<div ref="progressSquaresEl" :class="['progress-squares', 'cascading', { visible: progressSquaresVisible }]">
			<span v-for="(id, index) in vm.chosenCardIds" :key="id" :class="['square', { filled: index < animatedExploredCount, latest: index === latestSquareIndex }]">
				<canvas ref="pulseCanvases" class="pulse-canvas"></canvas>
			</span>
			<span class="progress-text"
				><span class="explored-count-wrapper"
					><span v-if="!skipAnimations" :class="['explored-count', 'count-old', { 'count-leaving': countSwapActive }]">{{ Math.max(0, vm.exploredCount - 1) }}</span
					><span :class="['explored-count', { 'count-new': !skipAnimations, 'count-entering': countSwapActive }]">{{ vm.exploredCount }}</span></span
				>
				of {{ vm.totalCount }} explored</span
			>
		</div>

		<div v-if="vm.isLoading" :class="['summary-loading', 'cascading', { visible: synthesisVisible }]">Generating summary...</div>
		<template v-else>
			<div v-if="synthesisParagraphs.length > 0" class="synthesis-summary">
				<template v-for="(para, pIdx) in synthesisParagraphs" :key="pIdx">
					<p>
						<template v-for="(sentence, sIdx) in para.sentences" :key="sIdx"
							><span :class="['cascading', { visible: para.startIndex + sIdx < revealedSentenceCount }]">{{ sentence }}</span
							><span v-if="para.startIndex + sIdx < totalSentenceCount - 1" class="show-all-anchor">&nbsp;<a ref="showAllLinks" :class="['show-all-btn', { visible: showAllAfterIndex === para.startIndex + sIdx }]" :tabindex="showAllAfterIndex === para.startIndex + sIdx ? 0 : -1" role="button" @click="handleShowAll" @keydown.enter="handleShowAll">Show all</a></span></template
						>
					</p>
				</template>
			</div>
			<p v-if="vm.synthesisError" :class="['summary-error', 'cascading', { visible: synthesisVisible }]">Could not load summary.</p>
		</template>

		<div ref="actionsEl" class="actions">
			<template v-if="vm.allComplete">
				<AppButton variant="primary" :class="['action-btn', 'cascading', { visible: primaryActionVisible }]" @click="handleOpenReport">Print your report</AppButton>
				<AppButton variant="secondary" :class="['action-btn', 'cascading', { visible: secondaryActionVisible }]" @click="handleKeepExploring">Back to explore list</AppButton>
			</template>
			<template v-else>
				<AppButton variant="primary" :class="['action-btn', 'cascading', { visible: primaryActionVisible }]" @click="handleKeepExploring">Keep exploring</AppButton>
			</template>
		</div>
	</main>
</template>

<style scoped>
main {
	margin: var(--space-8) auto;
	max-width: 36rem;
	padding: 0 var(--space-6);
	color: var(--color-black);
}

.cascading {
	opacity: 0;
	visibility: hidden;
	transition: opacity 1.5s ease;
}

.cascading.visible {
	opacity: 1;
	visibility: visible;
}

@media (prefers-reduced-motion: reduce) {
	.cascading,
	.square {
		transition: none;
	}
	.square.latest .pulse-canvas {
		visibility: hidden;
	}
}

header {
	margin-bottom: var(--space-6);
}

h1 {
	margin: 0 0 var(--space-2);
}

.warm-phrase {
	font-size: var(--text-lg);
	color: var(--color-gray-600);
	margin: 0;
}

.progress-squares {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	margin-bottom: var(--space-8);
}

.square {
	position: relative;
	display: inline-block;
	width: 1rem;
	height: 1rem;
	background: var(--color-gray-200);
	transition: background-color 0.1s ease;
}

.square.filled {
	background: var(--color-green-600);
}

.square.latest {
	background: transparent;
}
.pulse-canvas {
	visibility: hidden;
	position: absolute;
	--canvas-padding: 8px;
	inset: calc(-1 * var(--canvas-padding));
	width: calc(100% + 2 * var(--canvas-padding));
	height: calc(100% + 2 * var(--canvas-padding));
}
.square.latest .pulse-canvas {
	visibility: visible;
}

.progress-text {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	margin-left: var(--space-2);
}

.explored-count-wrapper {
	position: relative;
	display: inline-block;
}

.explored-count {
	display: inline-block;
}

.count-old {
	position: absolute;
	right: 0;
}

.count-new {
	opacity: 0;
}

.count-leaving {
	opacity: 0;
	animation: count-fade-out 0.25s ease forwards;
}

.count-entering {
	opacity: 1;
	animation: count-fade-in 1s ease forwards;
}

@keyframes count-fade-out {
	from {
		opacity: 1;
	}
	to {
		opacity: 0;
	}
}

@keyframes count-fade-in {
	from {
		opacity: 0;
		transform: scale(2);
	}
	to {
		opacity: 1;
		transform: scale(1);
	}
}

@media (prefers-reduced-motion: reduce) {
	.count-leaving,
	.count-entering {
		animation: none;
	}
}

.summary-loading {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	font-style: italic;
	margin-bottom: var(--space-8);
}

.synthesis-summary p {
	margin: 0 0 var(--space-2);
	font-size: var(--text-base);
	color: var(--color-gray-800);
	line-height: var(--leading-normal);
}

.show-all-anchor {
	display: inline-block;
	width: 0;
	height: 0;
	position: relative;
	overflow: visible;
	vertical-align: baseline;
}

.show-all-btn {
	white-space: nowrap;
	opacity: 0;
	transition: opacity 0.5s ease;
	pointer-events: none;
	color: var(--color-gray-400);
	font-size: var(--text-sm);
	font-style: italic;
	cursor: pointer;
	line-height: inherit;
}

.show-all-btn.visible {
	opacity: 1;
	transition: opacity 1.5s ease;
	pointer-events: auto;
}

.show-all-btn:hover {
	color: var(--color-green-600);
}

.summary-error {
	font-size: var(--text-sm);
	color: var(--color-error);
}

.actions {
	display: flex;
	flex-direction: column;
	margin-top: var(--space-8);
	gap: var(--space-3);
}

.action-btn {
	width: 100%;
}
</style>
