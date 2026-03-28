<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import { ReconsiderViewModel } from "./ReconsiderViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";

const router = useRouter();
const profileId = useStringParam("profileId");
const vm = new ReconsiderViewModel(profileId);

function handleDone(): void {
	vm.onDone();
	void router.push({ name: "examine", params: { profileId } });
}

onMounted(() => {
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "identify", params: { profileId } });
	}
});
</script>

<template>
	<main>
		<header>
			<h1>Reconsider</h1>
			<div class="instruction-stack">
				<p :class="['instruction', { active: vm.selectedCount === 0 }]">Select at least one source of meaning to examine.</p>
				<p :class="['instruction', { active: vm.selectedCount >= 1 && vm.selectedCount <= 2 }]">Select the sources of meaning you want to examine (aim for 3–5).</p>
				<p :class="['instruction', { active: vm.selectedCount >= 3 && vm.selectedCount <= 5 }]">Good choices! Tap Done when you're ready.</p>
				<p :class="['instruction', { active: vm.selectedCount > 5 }]">Consider narrowing to 3–5 sources for a more focused examination.</p>
			</div>
			<p class="count">{{ vm.selectedCount }} source{{ vm.selectedCount === 1 ? "" : "s" }} of meaning selected</p>
		</header>

		<div class="card-list">
			<label v-for="card in MEANING_CARDS" :key="card.id" :class="['card-row', { selected: vm.chosenIds.has(card.id), unselected: !vm.chosenIds.has(card.id) }]">
				<input type="checkbox" :checked="vm.chosenIds.has(card.id)" class="card-checkbox" @change="vm.toggleCard(card.id)" />
				<div class="card-content">
					<span class="card-source">{{ card.source }}</span>
					<span class="card-desc">{{ card.description }}</span>
				</div>
				<span v-if="vm.isExamined(card.id)" class="chip chip-success examined-chip">Examined</span>

				<div v-if="vm.confirmingRemove === card.id" class="confirm-overlay" @click.stop>
					<p>This source of meaning has examination answers. Remove it?</p>
					<!-- eslint-disable vue/no-restricted-html-elements -->
					<div class="confirm-actions">
						<button class="confirm-remove" @click="vm.removeCard(card.id, true)">Remove</button>
						<button class="btn-secondary confirm-cancel" @click="vm.cancelRemove()">Cancel</button>
					</div>
					<!-- eslint-enable vue/no-restricted-html-elements -->
				</div>
			</label>
		</div>

		<AppButton variant="primary" class="done-btn" @click="handleDone">Done</AppButton>
	</main>
</template>

<style scoped>
main {
	margin: 2rem auto;
	max-width: 36rem;
	padding: 0 1.5rem;
	color: var(--color-black);
}

header {
	margin-bottom: 1.5rem;
}

h1 {
	margin: 0 0 0.25rem;
}

.count {
	font-size: 0.95rem;
	color: var(--color-gray-400);
	margin: 0;
}

.card-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.card-row {
	position: relative;
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 1rem;
	cursor: pointer;
	transition: background 0.15s;
	user-select: none;
}

.card-row.selected {
	background: var(--color-white);
}

.card-row.unselected {
	background: var(--color-white);
	opacity: 0.7;
}

.has-hover .card-row:hover,
.card-row:active {
	opacity: 1;
}

.card-checkbox {
	width: 1.15rem;
	height: 1.15rem;
	flex-shrink: 0;
	accent-color: var(--color-green-600);
	cursor: pointer;
}

.card-content {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	min-width: 0;
	flex: 1;
}

.card-source {
	font-weight: 600;
	font-size: 0.95rem;
}

.card-desc {
	font-size: 0.85rem;
	color: var(--color-gray-600);
}

.examined-chip {
	flex-shrink: 0;
	margin-left: var(--space-3);
}

.confirm-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	background: rgba(255, 255, 255, 0.95);
	z-index: 1;
}

.confirm-overlay p {
	margin: 0 0 0.5rem;
	font-size: 0.9rem;
	color: var(--color-gray-800);
}

.confirm-actions {
	display: flex;
	gap: var(--space-2);
}

.confirm-remove {
	padding: var(--space-2) var(--space-6);
	font-size: 0.85rem;
	font-weight: 600;
	color: var(--color-white);
	background: var(--color-error);
	border: 1px solid var(--color-error);
}

.confirm-cancel {
	padding: var(--space-2) var(--space-6);
}

.done-btn {
	margin-top: var(--space-6);
}
</style>
