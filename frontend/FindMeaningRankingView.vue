<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { FindMeaningRankingViewModel } from "./FindMeaningRankingViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import AppButton from "./AppButton.vue";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const vm = new FindMeaningRankingViewModel(sessionId);

const selectedIndex = ref<0 | 1 | null>(null);
const loading = ref(false);

onMounted(async () => {
	const result = await vm.initialize();
	if (result === "no-data") {
		void router.replace({ name: "findMeaning", params: { sessionId } });
		return;
	}
	if (result === "skip") {
		void router.replace({ name: "explore", params: { sessionId } });
		return;
	}
});

async function handleCardTap(index: 0 | 1): Promise<void> {
	if (loading.value) return;
	if (selectedIndex.value === index) {
		loading.value = true;
		try {
			await vm.choose(index);
			selectedIndex.value = null;
		} finally {
			loading.value = false;
		}
	} else {
		selectedIndex.value = index;
	}
}

async function handleUndo(): Promise<void> {
	if (loading.value) return;
	if (selectedIndex.value !== null) {
		selectedIndex.value = null;
		return;
	}
	loading.value = true;
	try {
		const winnerId = await vm.undo();
		const pair = vm.currentPair;
		if (pair !== null) {
			const idx = pair.findIndex((c) => c.id === winnerId);
			selectedIndex.value = idx === 0 || idx === 1 ? idx : null;
		}
	} finally {
		loading.value = false;
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
			<p class="instruction">Choose which source of meaning resonates with you more.</p>
			<p class="remaining-text" :class="{ hidden: vm.estimatedRemaining === null || vm.estimatedRemaining.mid === 0 }">{{ vm.estimatedRemaining !== null ? `Estimated ${String(Math.ceil(vm.estimatedRemaining.mid))} ${Math.ceil(vm.estimatedRemaining.mid) === 1 ? "comparison" : "comparisons"} remaining.` : "&nbsp;" }}</p>
		</header>

		<div v-if="!vm.isComplete" class="ranking-area">
			<div :key="vm.round" class="card-pair">
				<template v-if="vm.currentPair !== null">
					<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
					<button v-for="(card, index) in vm.currentPair" :key="card.id" class="ranking-card" :class="{ selected: selectedIndex === index }" :disabled="loading" :aria-pressed="selectedIndex === index" @click="handleCardTap(index as 0 | 1)">
						<span class="card-source">{{ card.source }}</span>
						<p class="card-text">{{ card.description }}</p>
						<span v-if="selectedIndex === index" class="confirm-label">Tap again to confirm</span>
					</button>
				</template>
				<template v-else>
					<div class="ranking-card blank" aria-hidden="true" />
					<div class="ranking-card blank" aria-hidden="true" />
				</template>
			</div>
		</div>

		<div v-else class="end-state">
			<h2>You're done!</h2>
			<p>Your top sources of meaning have been identified.</p>
			<AppButton variant="primary" @click="handleFinish">Explore Meaning</AppButton>
		</div>

		<div class="undo-area">
			<AppButton variant="secondary" emphasis="muted" :disabled="(selectedIndex === null && !vm.canUndo) || loading" @click="handleUndo">Undo</AppButton>
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

.card-pair {
	display: flex;
	gap: var(--space-4);
	margin-bottom: var(--space-6);
}

.ranking-card {
	flex: 1;
	min-height: 14rem;
	padding: var(--space-8);
	background: var(--color-white);
	border: var(--border-thin);
	cursor: pointer;
	text-align: left;
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	font-family: inherit;
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
	font-family: var(--font-heading);
	font-weight: 600;
	font-size: var(--text-sm);
	color: var(--color-gray-500);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.card-text {
	margin: 0;
	font-size: var(--text-base, 1rem);
	line-height: 1.5;
	color: var(--color-black);
}

.ranking-card:disabled .card-text {
	color: var(--color-gray-400);
}

.confirm-label {
	font-size: var(--text-sm);
	color: var(--color-green-600);
	font-weight: 600;
	margin-top: auto;
}

.undo-area {
	text-align: center;
	margin-top: var(--space-4);
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

@media (max-width: 480px) {
	.card-pair {
		flex-direction: column;
	}
}
</style>
