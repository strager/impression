<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { PrioritizeViewModel } from "./PrioritizeViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import AppButton from "./AppButton.vue";
import PrioritizeDebugPanel from "./PrioritizeDebugPanel.vue";

const router = useRouter();
const route = useRoute();
const profileId = useStringParam("profileId");
const vm = new PrioritizeViewModel(profileId);
const debugMode = computed(() => "debug" in route.query);

const selectedIndex = ref<0 | 1 | null>(null);
const endStateRef = ref<HTMLElement | null>(null);

function preSelectFromPendingRedo(): void {
	const redo = vm.pendingRedo;
	const pair = vm.currentPair;
	if (redo === null || pair === null) {
		selectedIndex.value = null;
		return;
	}
	const idx = pair[0].id === redo.bestId ? 0 : pair[1].id === redo.bestId ? 1 : null;
	selectedIndex.value = idx;
}

onMounted(() => {
	const result = vm.initialize();
	if (result === "no-data") {
		void router.replace({ name: "identify", params: { profileId } });
		return;
	}
	if (result === "skip") {
		void router.replace({ name: "examine", params: { profileId } });
		return;
	}
	preSelectFromPendingRedo();
});

function handleCardTap(index: 0 | 1): void {
	if (selectedIndex.value !== index) {
		selectedIndex.value = index;
		return;
	}
	vm.choose(index);
	selectedIndex.value = null;
	if (vm.isComplete) {
		void nextTick(() => {
			endStateRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	} else {
		preSelectFromPendingRedo();
	}
}

function handleBack(): void {
	if (selectedIndex.value !== null) {
		selectedIndex.value = null;
		return;
	}
	if (!vm.canUndo) return;
	vm.undo();
	preSelectFromPendingRedo();
}

function handleFinish(): void {
	vm.finalize();
	void router.push({ name: "examine", params: { profileId } });
}

const backDisabled = computed(() => selectedIndex.value === null && !vm.canUndo);
</script>

<template>
	<main>
		<header>
			<h1>Prioritize</h1>
			<p v-if="!vm.isComplete" class="instruction">Which one matters more to you?</p>
			<p v-if="vm.estimatedRemaining !== null && vm.estimatedRemaining !== 0" class="remaining-text">Estimated {{ String(Math.ceil(vm.estimatedRemaining)) }} {{ Math.ceil(vm.estimatedRemaining) === 1 ? "comparison" : "comparisons" }} remaining.</p>
		</header>

		<div v-if="!vm.isComplete" class="ranking-area">
			<div :key="vm.round" class="card-pair">
				<template v-if="vm.currentPair !== null">
					<!-- AppButton has no toggle-state API; this is a tap-to-select / tap-again-to-confirm control with aria-pressed. -->
					<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
					<button v-for="(card, index) in vm.currentPair" :key="card.id" class="ranking-card" :class="{ selected: selectedIndex === index }" :aria-pressed="selectedIndex === index" @click="handleCardTap(index as 0 | 1)">
						<span class="card-source">{{ card.source }}</span>
						<p class="card-text">{{ card.description }}</p>
						<span class="confirm-label" :class="{ visible: selectedIndex === index }">Tap again to confirm</span>
					</button>
				</template>
				<template v-else>
					<div class="ranking-card blank" aria-hidden="true" />
					<div class="ranking-card blank" aria-hidden="true" />
				</template>
			</div>

			<div class="button-row">
				<AppButton variant="secondary" emphasis="muted" :disabled="backDisabled" @click="handleBack">Back</AppButton>
			</div>
		</div>

		<div v-else ref="endStateRef" class="end-state">
			<p style="margin-bottom: var(--space-4)">You're done! Here are your top sources of meaning:</p>
			<ul class="checkmark-list">
				<li v-for="card in vm.topKDisplayOrder" :key="card.id">
					<strong>{{ card.source }}</strong> — {{ card.description }}
				</li>
			</ul>
			<p class="next-step-hint">Next, you'll examine what each one means to you.</p>
			<div class="button-row">
				<AppButton variant="secondary" emphasis="muted" :disabled="!vm.canUndo" @click="handleBack">Back</AppButton>
				<AppButton variant="primary" @click="handleFinish">Examine meaning</AppButton>
			</div>
		</div>

		<PrioritizeDebugPanel v-if="debugMode" :vm="vm" />
	</main>
</template>

<style scoped>
main {
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

.instruction {
	color: var(--color-gray-500);
	margin: 0 0 var(--space-2);
}

.remaining-text {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	margin: 0;
}

.card-pair {
	display: flex;
	gap: var(--space-4);
	margin-bottom: var(--space-6);
}

.ranking-card {
	flex: 1;
	min-height: 14rem;
	padding: var(--space-6);
	background: var(--color-white);
	border: var(--border-thin);
	cursor: pointer;
	text-align: left;
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	font-family: inherit;
	color: inherit;
	-webkit-tap-highlight-color: transparent;
}

.ranking-card.blank {
	cursor: default;
}

.ranking-card:hover {
	border-color: var(--color-gray-400);
}

.ranking-card.selected {
	border-color: var(--color-green-600);
	box-shadow: inset 0 0 0 1px var(--color-green-600);
}

.card-source {
	font-weight: 600;
	font-size: var(--text-sm);
	color: var(--color-gray-500);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.card-text {
	margin: 0;
	font-size: var(--text-base);
	line-height: var(--leading-relaxed);
	color: var(--color-black);
}

.confirm-label {
	font-size: var(--text-sm);
	color: var(--color-green-600);
	font-weight: 600;
	margin-top: auto;
	visibility: hidden;
}

.confirm-label.visible {
	visibility: visible;
}

.button-row {
	display: flex;
	justify-content: center;
	gap: var(--space-4);
}

.next-step-hint {
	margin: 0 0 var(--space-4);
	line-height: var(--leading-relaxed);
}

.next-step-hint:last-of-type {
	margin-bottom: var(--space-6);
}

@media (max-width: 480px) {
	.card-pair {
		flex-direction: column;
	}
}
</style>
