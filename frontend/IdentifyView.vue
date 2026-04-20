<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import type { MeaningCard, SwipeDirection } from "../shared/meaning-cards.ts";
import { IdentifyViewModel } from "./IdentifyViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { detectProfilePhase } from "./store.ts";
import AppButton from "./AppButton.vue";
import SwipeCard from "./SwipeCard.vue";
import SwipeCardFace from "./SwipeCardFace.vue";

const router = useRouter();
const profileId = useStringParam("profileId");
const vm = new IdentifyViewModel(profileId);

const endStateRef = ref<HTMLElement | null>(null);

interface Ghost {
	id: number;
	card: MeaningCard;
	direction: SwipeDirection;
	fromX: number;
	fromY: number;
}

const ghosts = ref<Ghost[]>([]);
let nextGhostId = 0;

const GHOST_DURATION_MS = 800;

onMounted(() => {
	vm.initialize();
});

function commitSwipe(direction: SwipeDirection, fromX: number, fromY: number, method: "drag" | "button"): void {
	const card: MeaningCard | null = vm.currentCard;
	if (card === null) return;

	const ghostId = nextGhostId++;
	ghosts.value.push({
		id: ghostId,
		card,
		direction,
		fromX,
		fromY,
	});
	globalThis.setTimeout(() => {
		ghosts.value = ghosts.value.filter((g) => g.id !== ghostId);
	}, GHOST_DURATION_MS);

	vm.swipe(direction, method);

	if (vm.isComplete) {
		void nextTick(() => {
			endStateRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}
}

function handleSwipe(payload: { direction: SwipeDirection; fromX: number; fromY: number }): void {
	commitSwipe(payload.direction, payload.fromX, payload.fromY, "drag");
}

function handleButtonSwipe(direction: SwipeDirection): void {
	commitSwipe(direction, 0, 0, "button");
}

function handleUndo(): void {
	vm.undo();
}

function ghostTargetX(direction: SwipeDirection): number {
	if (direction === "agree") return 600;
	if (direction === "disagree") return -600;
	return 0;
}

function ghostTargetY(direction: SwipeDirection): number {
	return direction === "unsure" ? -400 : 0;
}

function ghostStyle(g: Ghost): Record<string, string> {
	const targetX = ghostTargetX(g.direction);
	const targetY = ghostTargetY(g.direction);
	return {
		"--ghost-from-x": `${String(g.fromX)}px`,
		"--ghost-from-y": `${String(g.fromY)}px`,
		"--ghost-from-rot": `${String(g.fromX * 0.08)}deg`,
		"--ghost-to-x": `${String(targetX)}px`,
		"--ghost-to-y": `${String(targetY)}px`,
		"--ghost-to-rot": `${String(targetX * 0.08)}deg`,
	};
}

function continueToNextPhase(): void {
	const phase = detectProfilePhase(profileId);
	if (phase === "examine") {
		void router.push({ name: "examine", params: { profileId } });
		return;
	}
	if (phase === "prioritize-complete" || phase === "prioritize") {
		void router.push({ name: "prioritize", params: { profileId } });
		return;
	}

	vm.finalize();
	if (vm.requiresPrioritization) {
		void router.push({ name: "prioritize", params: { profileId } });
	} else {
		void router.push({ name: "examine", params: { profileId } });
	}
}
</script>

<template>
	<main>
		<header>
			<h1>Identify</h1>
			<div class="instruction-stack">
				<p :class="['instruction', { active: !vm.isComplete && vm.currentIndex === 0 }]">Read each expression and decide if it feels right to you.</p>
				<p :class="['instruction', { active: !vm.isComplete && vm.currentIndex > 0 }]">Keep going — decide if each expression feels right to you.</p>
				<p :class="['instruction', { active: vm.isComplete }]">You've reviewed all {{ vm.totalCards }} expressions. Let's review.</p>
			</div>
			<div class="progress">
				<div class="progress-bar">
					<div class="progress-fill" :style="{ width: `${String(vm.progressPercent)}%` }" />
				</div>
				<div class="progress-row">
					<span class="progress-text"> {{ vm.progressPercent }}% ({{ vm.currentIndex }}/{{ vm.totalCards }}) </span>
					<AppButton variant="secondary" emphasis="muted" :class="['undo-button', { 'undo-hidden': !vm.canUndo }]" @click="handleUndo">Undo</AppButton>
				</div>
			</div>
		</header>

		<div class="card-region">
			<div v-if="!vm.isComplete" class="card-area">
				<SwipeCard :key="vm.currentIndex" :card="vm.currentCard!" :next-card="vm.nextCard" @swiped="handleSwipe" />
			</div>
			<div v-else ref="endStateRef" class="end-state">
				<p style="margin-bottom: var(--space-4)">Here are the expressions that you selected:</p>

				<div v-if="vm.agreedCards.length > 0" class="selection-group">
					<h3>Feels right to you</h3>
					<ul class="checkmark-list selection-columns">
						<li v-for="card in vm.agreedCards" :key="card.id">{{ card.description }}</li>
					</ul>
				</div>

				<div v-if="vm.unsureCards.length > 0" class="selection-group">
					<h3>Not sure yet</h3>
					<ul class="selection-columns">
						<li v-for="card in vm.unsureCards" :key="card.id">{{ card.description }}</li>
					</ul>
				</div>

				<p v-if="vm.requiresPrioritization" class="next-step-hint">Next, you'll narrow these down to the ones that matter most.</p>
				<p v-else class="next-step-hint">Next, you'll examine what each one means to you. You will also be able to change your sources of meaning.</p>

				<AppButton variant="primary" @click="continueToNextPhase">
					<template v-if="vm.requiresPrioritization">Prioritize meaning</template>
					<template v-else>Examine meaning</template>
				</AppButton>
			</div>

			<div class="ghost-layer" aria-hidden="true">
				<div class="ghost-stack">
					<div v-for="g in ghosts" :key="g.id" class="swipe-card-surface ghost-card" :style="ghostStyle(g)">
						<SwipeCardFace :card="g.card" :direction="g.direction" :overlay-opacity="0.25" :label-opacity="1" />
					</div>
				</div>
			</div>
		</div>

		<div v-if="!vm.isComplete" class="controls">
			<AppButton variant="primary" emphasis="muted" @click="handleButtonSwipe('disagree')">Disagree ✕</AppButton>
			<AppButton variant="secondary" emphasis="muted" @click="handleButtonSwipe('unsure')">Unsure ？</AppButton>
			<AppButton variant="primary" @click="handleButtonSwipe('agree')">Agree ✓</AppButton>
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

header {
	margin-bottom: var(--space-8);
}

h1 {
	margin: 0 0 var(--space-1);
}

.progress {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
}

.progress-bar {
	width: 100%;
	height: 6px;
	background: var(--color-gray-200);
	overflow: hidden;
}

.progress-fill {
	height: 100%;
	background: var(--color-green-600);
	transition: width 0.3s ease;
}

.progress-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.progress-text {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
}

.undo-button {
	font-size: var(--text-sm);
	transition: opacity 0.3s ease;
}

.undo-hidden {
	opacity: 0;
	pointer-events: none;
}

.card-region {
	position: relative;
	margin-bottom: var(--space-6);
}

.card-area {
	position: relative;
	z-index: 1;
}

.ghost-layer {
	width: 100vw;
	position: absolute;
	top: 0;
	left: 0;
	margin-left: calc(-50vw + 50%);
	height: 14rem;
	pointer-events: none;
	overflow-x: clip;
	z-index: 2;
	display: flex;
	justify-content: center;
}

.ghost-stack {
	position: relative;
	width: 100%;
	max-width: 20rem;
	height: 100%;
}

.ghost-card {
	position: absolute;
	inset: 0;
	animation: ghost-fly-away 800ms ease forwards;
}

@keyframes ghost-fly-away {
	from {
		transform: translate(var(--ghost-from-x), var(--ghost-from-y)) rotate(var(--ghost-from-rot));
		opacity: 1;
	}
	to {
		transform: translate(var(--ghost-to-x), var(--ghost-to-y)) rotate(var(--ghost-to-rot));
		opacity: 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.ghost-card {
		animation: none;
		transform: translate(var(--ghost-from-x), var(--ghost-from-y)) rotate(var(--ghost-from-rot));
	}
}

.selection-group {
	margin-bottom: var(--space-6);
}

.selection-columns {
	display: block;
	columns: 2;
}

.selection-columns li {
	break-inside: avoid;
}

.next-step-hint {
	margin: 0 0 var(--space-4);
	line-height: 1.5;
}

.next-step-hint:last-of-type {
	margin-bottom: var(--space-6);
}

.controls {
	display: flex;
	justify-content: center;
	gap: var(--space-3);
}
</style>
