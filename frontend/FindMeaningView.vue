<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import type { SwipeDirection } from "../shared/meaning-cards.ts";
import { FindMeaningViewModel } from "./FindMeaningViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { detectSessionPhase } from "./store.ts";
import AppButton from "./AppButton.vue";
import SwipeCard from "./SwipeCard.vue";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const vm = new FindMeaningViewModel(sessionId);

const swipeCardRef = ref<InstanceType<typeof SwipeCard> | null>(null);
const pendingSwipeMethod = ref<"drag" | "button">("drag");

const nextPhaseLabel = computed(() => {
	switch (detectSessionPhase(sessionId)) {
		case "explore":
		case "prioritize-complete":
			return "Explore meaning";
		case "prioritize":
			return "Prioritize meaning";
		default:
			return "Continue to next phase";
	}
});

onMounted(() => {
	vm.initialize();
});

function handleSwipe(direction: SwipeDirection): void {
	vm.swipe(direction, pendingSwipeMethod.value);
	pendingSwipeMethod.value = "drag";
}

function handleButtonSwipe(direction: SwipeDirection): void {
	if (vm.isComplete) return;
	pendingSwipeMethod.value = "button";
	if (swipeCardRef.value !== null) {
		swipeCardRef.value.flyAway(direction);
	} else {
		handleSwipe(direction);
	}
}

function handleUndo(): void {
	vm.undo();
	pendingSwipeMethod.value = "drag";
}

function continueToNextPhase(): void {
	const phase = detectSessionPhase(sessionId);
	if (phase === "explore") {
		void router.push({ name: "explore", params: { sessionId } });
		return;
	}
	if (phase === "prioritize-complete" || phase === "prioritize") {
		void router.push({ name: "findMeaningPrioritize", params: { sessionId } });
		return;
	}

	vm.finalize();
	if (vm.requiresPrioritization) {
		void router.push({ name: "findMeaningPrioritize", params: { sessionId } });
	} else {
		void router.push({ name: "explore", params: { sessionId } });
	}
}
</script>

<template>
	<main>
		<header>
			<h1>Find meaning</h1>
			<div v-if="!vm.isComplete" class="instruction-stack">
				<p :class="['instruction', { active: vm.currentIndex === 0 }]">Read each source of meaning and decide if it resonates with you.</p>
				<p :class="['instruction', { active: vm.currentIndex > 0 }]">Keep going — decide if each source of meaning resonates with you.</p>
			</div>
			<div class="progress">
				<div class="progress-bar">
					<div class="progress-fill" :style="{ width: `${String(vm.progressPercent)}%` }" />
				</div>
				<span class="progress-text"> {{ vm.progressPercent }}% ({{ vm.currentIndex }}/{{ vm.totalCards }}) </span>
			</div>
		</header>

		<div v-if="!vm.isComplete" class="card-area">
			<SwipeCard ref="swipeCardRef" :key="vm.currentIndex" :card="vm.currentCard!" :next-card="vm.nextCard" @swiped="handleSwipe" />
		</div>

		<div v-else class="end-state">
			<h2>All reviewed!</h2>
			<p>You have reviewed all {{ vm.totalCards }} sources of meaning.</p>
			<AppButton variant="primary" @click="continueToNextPhase">{{ nextPhaseLabel }}</AppButton>
		</div>

		<div v-if="!vm.isComplete" class="controls">
			<AppButton variant="primary" emphasis="muted" @click="handleButtonSwipe('disagree')">Disagree ✕</AppButton>
			<AppButton variant="secondary" emphasis="muted" @click="handleButtonSwipe('unsure')">Unsure ？</AppButton>
			<AppButton variant="primary" @click="handleButtonSwipe('agree')">Agree ✓</AppButton>
		</div>

		<div v-if="!vm.isComplete" class="undo-area">
			<AppButton variant="secondary" emphasis="muted" :disabled="!vm.canUndo" @click="handleUndo">Undo</AppButton>
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

.progress-text {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
}

.card-area {
	position: relative;
	z-index: 1;
	margin-bottom: var(--space-6);
}

.end-state {
	padding: var(--space-8) 0;
}

.end-state h2 {
	margin: 0 0 var(--space-2);
}

.end-state p {
	color: var(--color-gray-600);
	margin: 0 0 var(--space-6);
	line-height: 1.5;
}

.controls {
	display: flex;
	justify-content: center;
	gap: var(--space-3);
	margin-bottom: var(--space-4);
}

.undo-area {
	text-align: center;
}
</style>
