<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import { capture } from "./analytics.ts";
import { useStringParam } from "./route-utils.ts";
import { loadChosenCardIds, loadExamineData, saveChosenCardIds } from "./store.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";

const router = useRouter();
const profileId = useStringParam("profileId");
const chosenIds = ref<Set<string>>(new Set());
const examinedIds = ref<Set<string>>(new Set());
const confirmingRemove = ref<string | null>(null);

const selectedCount = computed(() => chosenIds.value.size);

function saveChosenIds(): void {
	const ordered = MEANING_CARDS.filter((c) => chosenIds.value.has(c.id)).map((c) => c.id);
	saveChosenCardIds(profileId, ordered);
}

function isExamined(cardId: string): boolean {
	return examinedIds.value.has(cardId);
}

function toggleCard(cardId: string): void {
	if (chosenIds.value.has(cardId)) {
		if (isExamined(cardId)) {
			confirmingRemove.value = cardId;
			return;
		}
		removeCard(cardId, false);
	} else {
		addCard(cardId);
	}
}

function addCard(cardId: string): void {
	chosenIds.value.add(cardId);
	chosenIds.value = new Set(chosenIds.value);
	saveChosenIds();
	capture("card_toggled", { session_id: profileId });
}

function removeCard(cardId: string, hadData: boolean): void {
	chosenIds.value.delete(cardId);
	chosenIds.value = new Set(chosenIds.value);
	confirmingRemove.value = null;
	saveChosenIds();
	capture("card_toggled", { session_id: profileId });
	if (hadData) {
		capture("card_with_data_removed", { session_id: profileId });
	}
}

function cancelRemove(): void {
	if (confirmingRemove.value !== null) {
		capture("manual_remove_with_data_cancelled", {
			session_id: profileId,
		});
	}
	confirmingRemove.value = null;
}

function onDone(): void {
	capture("manual_selection_completed", {
		session_id: profileId,
		card_count: selectedCount.value,
	});
	void router.push({ name: "examine", params: { profileId } });
}

onMounted(() => {
	try {
		const cardIds = loadChosenCardIds(profileId);
		if (cardIds === null) {
			void router.replace({ name: "identify", params: { profileId } });
			return;
		}
		chosenIds.value = new Set(cardIds);

		const examineData = loadExamineData(profileId);
		if (examineData !== null) {
			for (const [cardId, cardData] of Object.entries(examineData)) {
				if (cardData.entries.some((e) => e.userAnswer !== "")) {
					examinedIds.value.add(cardId);
				}
			}
		}
		capture("manual_selection_visited", { session_id: profileId });
	} catch {
		void router.replace({ name: "identify", params: { profileId } });
	}
});
</script>

<template>
	<main>
		<header>
			<h1>Identify — manual</h1>
			<div class="instruction-stack">
				<p :class="['instruction', { active: selectedCount === 0 }]">Select at least one source of meaning to examine.</p>
				<p :class="['instruction', { active: selectedCount >= 1 && selectedCount <= 2 }]">Select the sources of meaning you want to examine (aim for 3–5).</p>
				<p :class="['instruction', { active: selectedCount >= 3 && selectedCount <= 5 }]">Good selection! Tap Done when you're ready.</p>
				<p :class="['instruction', { active: selectedCount > 5 }]">Consider narrowing to 3–5 sources for a more focused examination.</p>
			</div>
			<p class="count">{{ selectedCount }} source{{ selectedCount === 1 ? "" : "s" }} of meaning selected</p>
		</header>

		<div class="card-list">
			<label v-for="card in MEANING_CARDS" :key="card.id" :class="['card-row', { selected: chosenIds.has(card.id), unselected: !chosenIds.has(card.id) }]">
				<input type="checkbox" :checked="chosenIds.has(card.id)" class="card-checkbox" @change="toggleCard(card.id)" />
				<div class="card-content">
					<span class="card-source">{{ card.source }}</span>
					<span class="card-desc">{{ card.description }}</span>
				</div>
				<span v-if="isExamined(card.id)" class="chip chip-success examined-chip">Examined</span>

				<div v-if="confirmingRemove === card.id" class="confirm-overlay" @click.stop>
					<p>This source of meaning has examination answers. Remove it?</p>
					<!-- eslint-disable vue/no-restricted-html-elements -->
					<div class="confirm-actions">
						<button class="confirm-remove" @click="removeCard(card.id, true)">Remove</button>
						<button class="btn-secondary confirm-cancel" @click="cancelRemove">Cancel</button>
					</div>
					<!-- eslint-enable vue/no-restricted-html-elements -->
				</div>
			</label>
		</div>

		<AppButton variant="primary" class="done-btn" @click="onDone">Done</AppButton>
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

.card-row:hover {
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
