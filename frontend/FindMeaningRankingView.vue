<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { FindMeaningRankingViewModel } from "./FindMeaningRankingViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import AppButton from "./AppButton.vue";
import ToggleButton from "./ToggleButton.vue";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const vm = new FindMeaningRankingViewModel(sessionId);

const mostIndex = ref<number | null>(null);
const leastIndex = ref<number | null>(null);
const displayOrder = ref([0, 1, 2]);
const canAdvance = computed(() => mostIndex.value !== null && leastIndex.value !== null);

onMounted(() => {
	const result = vm.initialize();
	if (result === "no-data") {
		void router.replace({ name: "findMeaning", params: { sessionId } });
		return;
	}
	if (result === "skip") {
		void router.replace({ name: "explore", params: { sessionId } });
		return;
	}
});

function moveToTop(idx: number): void {
	const order = [...displayOrder.value];
	const pos = order.indexOf(idx);
	if (pos > 0) {
		order.splice(pos, 1);
		order.unshift(idx);
		displayOrder.value = order;
	}
}

function moveToBottom(idx: number): void {
	const order = [...displayOrder.value];
	const pos = order.indexOf(idx);
	if (pos < order.length - 1) {
		order.splice(pos, 1);
		order.push(idx);
		displayOrder.value = order;
	}
}

function handleMost(index: number): void {
	if (mostIndex.value === index) {
		mostIndex.value = null;
	} else {
		mostIndex.value = index;
		if (leastIndex.value === index) leastIndex.value = null;
		moveToTop(index);
	}
}

function handleLeast(index: number): void {
	if (leastIndex.value === index) {
		leastIndex.value = null;
	} else {
		leastIndex.value = index;
		if (mostIndex.value === index) mostIndex.value = null;
		moveToBottom(index);
	}
}

function handleNext(): void {
	const best = mostIndex.value;
	const worst = leastIndex.value;
	if (best === null || worst === null) return;
	vm.choose(best, worst);
	mostIndex.value = null;
	leastIndex.value = null;
	displayOrder.value = [0, 1, 2];
}

function handleUndo(): void {
	const { bestId, worstId } = vm.undo();
	displayOrder.value = [0, 1, 2];
	const task = vm.currentTask;
	if (task !== null) {
		const bestIdx = task.findIndex((c) => c.id === bestId);
		const worstIdx = task.findIndex((c) => c.id === worstId);
		mostIndex.value = bestIdx >= 0 ? bestIdx : null;
		leastIndex.value = worstIdx >= 0 ? worstIdx : null;
		if (bestIdx >= 0) moveToTop(bestIdx);
		if (worstIdx >= 0) moveToBottom(worstIdx);
	} else {
		mostIndex.value = null;
		leastIndex.value = null;
	}
}

function handleFinish(): void {
	vm.finalize();
	void router.push({ name: "explore", params: { sessionId } });
}
</script>

<template>
	<main>
		<header>
			<h1>Find Meaning — Rank</h1>
			<p class="instruction">Select your most and least meaningful cards.</p>
			<p class="remaining-text" :class="{ hidden: vm.estimatedRemaining === null || vm.estimatedRemaining.mid === 0 }">{{ vm.estimatedRemaining !== null ? `Estimated ${String(Math.ceil(vm.estimatedRemaining.mid))} ${Math.ceil(vm.estimatedRemaining.mid) === 1 ? "task" : "tasks"} remaining.` : "&nbsp;" }}</p>
		</header>

		<div v-if="!vm.isComplete" class="ranking-area">
			<div v-if="vm.currentTask !== null" :key="vm.round">
				<TransitionGroup tag="div" name="card" class="card-triad">
					<div v-for="idx in displayOrder" :key="vm.currentTask[idx].id" class="ranking-card">
						<div class="card-content">
							<div class="card-title">{{ vm.currentTask[idx].source }}</div>
							<div class="card-body">{{ vm.currentTask[idx].description }}</div>
						</div>
						<div class="card-buttons">
							<ToggleButton variant="primary" :active="mostIndex === idx" @toggle="handleMost(idx)">Most meaningful</ToggleButton>
							<ToggleButton variant="neutral" :active="leastIndex === idx" @toggle="handleLeast(idx)">Least meaningful</ToggleButton>
						</div>
					</div>
				</TransitionGroup>
			</div>
			<div v-else key="blank" class="card-triad">
				<div class="ranking-card blank" aria-hidden="true" />
				<div class="ranking-card blank" aria-hidden="true" />
				<div class="ranking-card blank" aria-hidden="true" />
			</div>

			<div class="button-row">
				<AppButton variant="secondary" emphasis="muted" :disabled="!vm.canUndo" @click="handleUndo">Back</AppButton>
				<AppButton variant="primary" :disabled="!canAdvance" @click="handleNext">Next</AppButton>
			</div>
		</div>

		<div v-else class="end-state">
			<h2>You're done!</h2>
			<p>Your top sources of meaning have been identified.</p>
			<AppButton variant="primary" @click="handleFinish">Explore meaning</AppButton>
		</div>
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
	color: var(--color-gray-400);
	margin: 0 0 var(--space-2);
}

.remaining-text {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	margin: 0;
}

.remaining-text.hidden {
	visibility: hidden;
}

.card-triad {
	display: flex;
	flex-direction: column;
	margin-bottom: var(--space-6);
}

.card-move {
	transition: transform 0.3s ease;
	position: relative;
	z-index: 1;
}

.ranking-card {
	background: var(--color-white);
	border-top: var(--border-thin);
	border-bottom: var(--border-thin);
	padding: var(--space-5) 0;
	text-align: left;
	display: grid;
	grid-template-columns: 1fr auto;
	gap: var(--space-4);
}

.ranking-card + .ranking-card {
	margin-top: -1px;
}

.ranking-card.blank {
	cursor: default;
}

.card-content {
	min-width: 0;
}

.card-content :deep(.card-body) {
	min-height: calc(2 * var(--text-base) * var(--leading-relaxed));
}

.card-buttons {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--space-2);
}

.button-row {
	display: flex;
	justify-content: center;
	gap: var(--space-4);
}

.end-state {
	text-align: center;
}

.end-state h2 {
	margin: 0 0 var(--space-2);
}

.end-state p {
	margin: 0 0 var(--space-6);
	color: var(--color-gray-400);
}
</style>
