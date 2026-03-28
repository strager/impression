<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import type { SwipeDirection } from "../shared/meaning-cards.ts";
import { IdentifyViewModel } from "./IdentifyViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { detectProfilePhase } from "./store.ts";
import AppButton from "./AppButton.vue";
import SwipeCard from "./SwipeCard.vue";

const router = useRouter();
const profileId = useStringParam("profileId");
const vm = new IdentifyViewModel(profileId);

const swipeCardRef = ref<InstanceType<typeof SwipeCard> | null>(null);
const endStateRef = ref<HTMLElement | null>(null);
const pendingSwipeMethod = ref<"drag" | "button">("drag");

onMounted(() => {
	vm.initialize();
});

function handleSwipe(direction: SwipeDirection): void {
	vm.swipe(direction, pendingSwipeMethod.value);
	pendingSwipeMethod.value = "drag";
	if (vm.isComplete) {
		void nextTick(() => {
			endStateRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}
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
	const phase = detectProfilePhase(profileId);
	if (phase === "examine") {
		void router.push({ name: "examine", params: { profileId } });
		return;
	}
	if (phase === "prioritize-complete" || phase === "prioritize") {
		void router.push({ name: "identifyPrioritize", params: { profileId } });
		return;
	}

	vm.finalize();
	if (vm.requiresPrioritization) {
		void router.push({ name: "identifyPrioritize", params: { profileId } });
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
				<p :class="['instruction', { active: !vm.isComplete && vm.currentIndex === 0 }]">Read each source of meaning and decide if it feels right to you.</p>
				<p :class="['instruction', { active: !vm.isComplete && vm.currentIndex > 0 }]">Keep going — decide if each source of meaning feels right to you.</p>
				<p :class="['instruction', { active: vm.isComplete }]">You've reviewed all {{ vm.totalCards }} sources of meaning. Let's review.</p>
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

		<div v-if="!vm.isComplete" class="card-area">
			<SwipeCard ref="swipeCardRef" :key="vm.currentIndex" :card="vm.currentCard!" :next-card="vm.nextCard" @swiped="handleSwipe" />
		</div>
		<div v-else ref="endStateRef" class="end-state">
			<p style="margin-bottom: var(--space-4)">Here are the sources of meaning that you selected:</p>

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
			<p v-else class="next-step-hint">Next, you'll examine what each one means to you. You will also be able to change your selections.</p>

			<AppButton variant="primary" @click="continueToNextPhase">
				<template v-if="vm.requiresPrioritization">Prioritize meaning</template>
				<template v-else>Examine meaning</template>
			</AppButton>
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

.card-area {
	position: relative;
	z-index: 1;
	margin-bottom: var(--space-6);
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
