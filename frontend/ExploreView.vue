<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import { ExploreViewModel } from "./ExploreViewModel.ts";
import { useStringParam } from "./route-utils.ts";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const vm = new ExploreViewModel(sessionId);

onMounted(() => {
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "findMeaning", params: { sessionId } });
	}
});

const instructionText = computed(() => {
	if (vm.totalAnswered === 0) {
		return "Tap a card below to begin exploring what it means to you.";
	}
	if (vm.totalAnswered >= vm.totalQuestions) {
		return "You've explored all your cards! Review your reflections or download your report.";
	}
	return `You've answered ${String(vm.totalAnswered)} of ${String(vm.totalQuestions)} questions across your cards. Tap a card to continue.`;
});

function exploreButtonLabel(cardId: string): string {
	const status = vm.cardStatus(cardId);
	if (status === "complete") return "Review";
	if (status === "partial") return "Continue";
	return "Explore";
}

function handleExploreCard(cardId: string): void {
	vm.onExploreCard(cardId);
	void router.push({ name: "exploreMeaning", params: { sessionId, meaningId: cardId } });
}

function handleEditSelection(): void {
	vm.onEditSelection();
	void router.push({ name: "findMeaningManual", params: { sessionId } });
}

function handleOpenReport(source: string): void {
	vm.onOpenReport(source);
	void router.push({ name: "report", params: { sessionId } });
}
</script>

<template>
	<main>
		<header>
			<h1>Explore</h1>
			<div v-if="vm.chosenCards.length > 0" class="instruction-stack">
				<p class="instruction active">{{ instructionText }}</p>
			</div>
		</header>

		<div v-if="vm.chosenCards.length > 0" class="overall-progress">
			<div class="progress-bar">
				<div class="progress-fill" :style="{ width: `${String(vm.overallPercent)}%` }" />
			</div>
			<span class="progress-label">{{ vm.totalAnswered }} of {{ vm.totalQuestions }} questions answered</span>
		</div>

		<div class="top-actions">
			<AppButton v-if="vm.allComplete" variant="primary" @click="handleOpenReport('explore_overview_primary')">Download report</AppButton>
			<AppButton variant="secondary" @click="handleEditSelection">Edit selection</AppButton>
		</div>

		<div class="card-list">
			<div v-for="card in vm.sortedCards" :key="card.id" :class="['card-hrule', 'chosen-card', 'status-' + vm.cardStatus(card.id)]">
				<div class="card-title">
					{{ card.description }} <span class="source-label">({{ card.source }})</span>
				</div>
				<span v-if="vm.cardStatus(card.id) === 'complete'" class="chip chip-success status-chip">Complete</span>
				<span v-else-if="vm.cardStatus(card.id) === 'partial'" class="chip chip-warning status-chip">In progress</span>
				<div v-if="vm.cardSummaryEntries[card.id]?.some((e) => e.loading) || vm.cardFreeformSummary[card.id]?.loading" class="summary-loading">Generating summary...</div>
				<template v-else-if="vm.cardSummaryEntries[card.id]">
					<p v-if="vm.cardFreeformSummary[card.id]?.summary" class="freeform-summary">{{ vm.cardFreeformSummary[card.id]!.summary }}</p>
					<p v-else-if="vm.cardFreeformSummary[card.id]?.error" class="summary-error">Could not load notes summary.</p>
					<ul class="summary-block">
						<li v-for="entry in vm.cardSummaryEntries[card.id]" :key="entry.questionId" :class="['summary-item', { unanswered: entry.unanswered }]">
							<span v-if="entry.unanswered" class="summary-unanswered"
								><strong>{{ entry.topic }}:</strong> <em>Not yet answered.</em></span
							>
							<span v-else-if="entry.error" class="summary-error">Could not load summary.</span>
							<span v-else-if="entry.summary"
								><strong>{{ entry.topic }}:</strong> {{ entry.summary }}</span
							>
						</li>
					</ul>
				</template>
				<AppButton :variant="vm.cardStatus(card.id) !== 'complete' ? 'primary' : 'secondary'" class="explore-btn" @click="handleExploreCard(card.id)">{{ exploreButtonLabel(card.id) }}</AppButton>
			</div>
		</div>

		<AppButton :variant="vm.allComplete ? 'primary' : 'secondary'" class="report-btn" @click="handleOpenReport('explore_overview_secondary')">Download report</AppButton>
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

.overall-progress {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	margin-bottom: var(--space-6);
}

.progress-bar {
	width: 100%;
	max-width: 16rem;
	height: 6px;
	background: var(--color-gray-200);
	overflow: hidden;
}

.progress-fill {
	height: 100%;
	background: var(--color-green-600);
	transition: width 0.3s ease;
}

.progress-label {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
}

.card-list {
	margin-bottom: var(--space-6);
}

.chosen-card {
	position: relative;
}

.status-chip {
	position: absolute;
	top: 0;
	right: 0;
}

.source-label {
	font-weight: 400;
	color: var(--color-gray-600);
}

.explore-btn {
	margin-top: var(--space-3);
}

.freeform-summary {
	margin: var(--space-3) 0 0;
	font-size: var(--text-base);
	color: var(--color-gray-800);
	line-height: var(--leading-normal);
}

.summary-loading {
	margin-top: var(--space-3);
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	font-style: italic;
}

.summary-error {
	margin-top: var(--space-3);
	font-size: var(--text-sm);
	color: var(--color-error);
}

.summary-unanswered,
.summary-item.unanswered::before {
	color: var(--color-gray-400);
}

.summary-block {
	list-style: none;
	margin-top: var(--space-3);
	padding: 0 0 0 var(--space-6);
	font-size: var(--text-base);
	line-height: var(--leading-normal);
	color: var(--color-gray-800);
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
}

.summary-item {
	position: relative;
	margin: var(--space-1) 0;
}

.summary-item::before {
	position: absolute;
	left: calc(-1 * var(--space-6));
	content: "\2713";
}

.summary-item.unanswered::before {
	content: "\2610";
}

.top-actions {
	display: flex;
	gap: var(--space-3);
	margin-bottom: var(--space-6);
}

.report-btn {
	margin-bottom: var(--space-4);
}
</style>
