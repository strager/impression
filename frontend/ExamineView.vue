<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";

import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import AppButton from "./AppButton.vue";
import { ExamineViewModel, parseBullets } from "./ExamineViewModel.ts";
import { useStringParam } from "./route-utils.ts";

const questionsPerCard = EXAMINE_QUESTIONS.length;

const router = useRouter();
const profileId = useStringParam("profileId");
const vm = new ExamineViewModel(profileId);

onMounted(() => {
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "findMeaning", params: { profileId } });
	}
});

const instructionText = computed(() => {
	if (vm.totalAnswered === 0) {
		return "Tap a source of meaning below to begin examining what it means to you.";
	}
	if (vm.totalAnswered >= vm.totalQuestions) {
		return "You've examined all your sources of meaning! Review your reflections or download your profile.";
	}
	return `You've answered ${String(vm.totalAnswered)} of ${String(vm.totalQuestions)} questions across your sources of meaning. Tap one to continue.`;
});

function examineButtonLabel(cardId: string): string {
	const status = vm.cardStatus(cardId);
	if (status === "complete") return "Review";
	if (status === "partial") return "Continue";
	return "Examine";
}

function handleExamineCard(cardId: string): void {
	vm.onExamineCard(cardId);
	void router.push({ name: "examineMeaning", params: { profileId, meaningId: cardId } });
}

function handleEditSelection(): void {
	vm.onEditSelection();
	void router.push({ name: "findMeaningManual", params: { profileId } });
}

function handleOpenProfile(source: string): void {
	vm.onOpenProfile(source);
	void router.push({ name: "profile", params: { profileId } });
}
</script>

<template>
	<main>
		<header>
			<h1>Examine</h1>
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
			<AppButton v-if="vm.allComplete" variant="primary" @click="handleOpenProfile('examine_overview_primary')">Download profile</AppButton>
			<AppButton variant="secondary" @click="handleEditSelection">Edit selection</AppButton>
		</div>

		<div class="card-list">
			<div v-for="card in vm.sortedCards" :key="card.id" :class="['card-hrule', 'chosen-card', 'status-' + vm.cardStatus(card.id)]">
				<div class="card-title">
					{{ card.description }} <span class="source-label">({{ card.source }})</span>
				</div>
				<span v-if="vm.cardStatus(card.id) === 'complete'" class="chip chip-positioned chip-success status-chip">Complete</span>
				<span v-else-if="vm.cardStatus(card.id) === 'partial'" class="chip chip-positioned chip-warning status-chip">In progress</span>
				<div v-if="vm.cardAnswerCounts[card.id] && vm.cardStatus(card.id) !== 'complete'" class="card-progress">
					<div class="progress-bar">
						<div class="progress-fill" :style="{ width: `${String(Math.round((vm.cardAnswerCounts[card.id] / questionsPerCard) * 100))}%` }" />
					</div>
					<span class="progress-label">{{ vm.cardAnswerCounts[card.id] }} of {{ questionsPerCard }} questions answered</span>
				</div>
				<div v-if="vm.cardSynthesis[card.id]?.loading" class="summary-loading">Generating summary...</div>
				<template v-else-if="vm.cardSynthesis[card.id]?.text">
					<ul v-if="parseBullets(vm.cardSynthesis[card.id]!.text)" class="checkmark-list">
						<li v-for="(bullet, i) in parseBullets(vm.cardSynthesis[card.id]!.text)" :key="i">
							<span style="--chip-parent-cap: 1cap"
								>{{ bullet }}<template v-if="i === parseBullets(vm.cardSynthesis[card.id]!.text)!.length - 1">{{ " " }}<span class="chip chip-ai">AI-generated</span></template></span
							>
						</li>
					</ul>
					<p v-else class="card-synthesis" style="--chip-parent-cap: 1cap">{{ vm.cardSynthesis[card.id]!.text }} <span class="chip chip-ai">AI-generated</span></p>
				</template>
				<div v-else-if="vm.cardSynthesis[card.id]?.error" class="alert alert-error">Could not load summary. <a class="retry-link" role="button" tabindex="0" @click="vm.retrySynthesis(card.id)" @keydown.enter="vm.retrySynthesis(card.id)">Retry</a></div>
				<AppButton :variant="vm.cardStatus(card.id) !== 'complete' ? 'primary' : 'secondary'" class="examine-btn" @click="handleExamineCard(card.id)">{{ examineButtonLabel(card.id) }}</AppButton>
			</div>
		</div>

		<AppButton :variant="vm.allComplete ? 'primary' : 'secondary'" class="profile-btn" @click="handleOpenProfile('examine_overview_secondary')">Download profile</AppButton>
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

.card-progress {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	margin-top: var(--space-3);
}

.examine-btn {
	margin-top: var(--space-3);
}

.card-synthesis {
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

.top-actions {
	display: flex;
	gap: var(--space-3);
	margin-bottom: var(--space-6);
}

.profile-btn {
	margin-bottom: var(--space-4);
}
</style>
