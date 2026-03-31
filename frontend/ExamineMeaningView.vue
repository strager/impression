<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import ExamineTextarea from "./ExamineTextarea.vue";
import { ExamineMeaningViewModel } from "./ExamineMeaningViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { hasVisitedExamineReflect } from "./store.ts";
import { useMatchMedia } from "./use-match-media.ts";
import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";

const router = useRouter();

const questionsById = new Map(EXAMINE_QUESTIONS.map((q) => [q.id, q]));

const profileId = useStringParam("profileId");
const cardId = useStringParam("meaningId");

const vm = new ExamineMeaningViewModel(profileId, cardId);

const activeTextarea = ref<InstanceType<typeof ExamineTextarea> | null>(null);
const entryTextareas: (InstanceType<typeof ExamineTextarea> | null)[] = [];
const entryCards: (HTMLElement | null)[] = [];
const freeformTextarea = ref<InstanceType<typeof ExamineTextarea> | null>(null);

let persistTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedPersist(): void {
	if (persistTimer !== undefined) return;
	persistTimer = setTimeout(() => {
		persistTimer = undefined;
		vm.persistEntries();
	}, 300);
}

let freeformPersistTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedFreeformPersist(): void {
	if (freeformPersistTimer !== undefined) return;
	freeformPersistTimer = setTimeout(() => {
		freeformPersistTimer = undefined;
		vm.persistFreeform();
	}, 300);
}

function onActiveEntryInput(entry: (typeof vm.entries)[number]): void {
	vm.onActiveEntryInput(entry);
	debouncedPersist();
}

function onAnsweredEntryInput(entry: (typeof vm.entries)[number]): void {
	vm.onAnsweredEntryInput(entry);
	debouncedPersist();
}

// https://github.com/w3c/csswg-drafts/issues/3871
function hasPhysicalKeyboard(): boolean {
	return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function scrollCardIntoViewIfNeeded(index: number): void {
	const el = entryCards[index];
	if (el === null) return;
	const rect = el.getBoundingClientRect();
	if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
	el.scrollIntoView({ block: "start", behavior: "smooth" });
}

async function handleSubmitAnswer(): Promise<void> {
	const focusedAtStart = document.activeElement;
	const submittedIndex = vm.editingEntryIndex;
	if (!hasPhysicalKeyboard() && document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
	await vm.submitAnswer();
	if (hasPhysicalKeyboard()) {
		void nextTick(() => {
			const cur = document.activeElement;
			if (cur !== focusedAtStart && cur !== document.body && cur !== null) return;
			if (vm.freeformVisible) {
				freeformTextarea.value?.focus();
			} else {
				activeTextarea.value?.focus();
			}
		});
	}
	if (submittedIndex >= 0 && vm.manualReflectResult.has(vm.entries[submittedIndex].questionId)) {
		void nextTick(() => {
			scrollCardIntoViewIfNeeded(submittedIndex);
		});
	}
}

function handleConfirmDescriptions(): void {
	vm.confirmDescriptions();
	if (hasPhysicalKeyboard()) {
		void nextTick(() => {
			freeformTextarea.value?.focus();
		});
	}
}

async function handleReflectOnEntry(questionId: string, index: number): Promise<void> {
	const entry = vm.entries[index];
	if (entry.userAnswer.trim() === "") {
		await vm.reflectOnEntry(questionId);
		if (hasPhysicalKeyboard()) {
			entryTextareas[index]?.focus();
		}
		void nextTick(() => {
			scrollCardIntoViewIfNeeded(index);
		});
		return;
	}
	await vm.reflectOnEntry(questionId);
	void nextTick(() => {
		scrollCardIntoViewIfNeeded(index);
	});
}

function handleEditAutoFill(entry: (typeof vm.entries)[number], index: number): void {
	vm.acceptAutoFill(entry);
	void nextTick(() => {
		entryTextareas[index]?.focusAtEnd();
		scrollCardIntoViewIfNeeded(index);
	});
}

function handleClearAutoFill(entry: (typeof vm.entries)[number], index: number): void {
	vm.clearAutoFill(entry);
	void nextTick(() => {
		entryTextareas[index]?.focus();
		scrollCardIntoViewIfNeeded(index);
	});
}

function onKeydown(index: number | null, event: KeyboardEvent): void {
	if (!(event.key === "Enter" && event.shiftKey)) return;
	event.preventDefault();
	if (index !== null && index === vm.editingEntryIndex && vm.entries[index].autoFilledPending) return;
	if (index === vm.editingEntryIndex) {
		void handleSubmitAnswer();
	} else if (index !== null) {
		const next = entryTextareas[index + 1] ?? null;
		if (next !== null) {
			next.focus();
		} else if (vm.freeformVisible) {
			freeformTextarea.value?.focus();
		}
	} else {
		handleFinishExamining();
	}
}

const fadingOut = ref(false);
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
const prefersReducedMotion = useMatchMedia("(prefers-reduced-motion: reduce)");

function handleFinishExamining(): void {
	vm.finishExamining();
	if (vm.readyForReflect) {
		if (prefersReducedMotion.value || hasVisitedExamineReflect(profileId, cardId)) {
			void router.push({ name: "examineReflect", params: { profileId, meaningId: cardId } });
		} else {
			fadingOut.value = true;
			document.documentElement.classList.add("page-fading-out");
			fadeTimer = setTimeout(() => {
				void router.push({ name: "examineReflect", params: { profileId, meaningId: cardId } });
			}, 2000);
		}
	} else if (!vm.allAnswered) {
		void router.push({ name: "examine", params: { profileId } });
	}
}

onBeforeUnmount(() => {
	if (fadeTimer !== undefined) clearTimeout(fadeTimer);
	document.documentElement.classList.remove("page-fading-out");
});

onMounted(() => {
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "examine", params: { profileId } });
	}
});
</script>

<template>
	<main v-if="vm.card" :class="{ 'fading-out': fadingOut }">
		<header>
			<h1>Examine meaning</h1>

			<h2 class="description">
				&ldquo;{{ vm.card.description }}&rdquo; <span class="source">({{ vm.card.source }})</span>
			</h2>

			<div class="instruction-stack">
				<p :class="['instruction', { active: !vm.allAnswered && vm.submittedCount === 0 }]">Reflect on what this source of meaning means to you. Answer each question thoughtfully.</p>
				<p :class="['instruction', { active: !vm.allAnswered && vm.submittedCount > 0 }]">Question {{ vm.submittedCount + 1 }} of {{ EXAMINE_QUESTIONS.length }} — keep reflecting on this source of meaning.</p>
				<p :class="['instruction', { active: vm.allAnswered }]">You've answered all questions. Add any additional notes, or finish examining this source of meaning.</p>
			</div>
		</header>

		<div
			v-for="(entry, index) in vm.entries"
			:key="entry.questionId"
			:ref="
				(el: any) => {
					entryCards[index] = el;
				}
			"
			class="card-hrule question-card"
		>
			<p>
				<label :for="`q-${entry.questionId}`"
					><q>{{ vm.card.description }}</q></label
				>
			</p>
			<p>
				<label :for="`q-${entry.questionId}`">{{ questionsById.get(entry.questionId)?.text }}</label>
			</p>
			<template v-if="entry.submitted">
				<template v-if="vm.manualReflectResult.has(entry.questionId)">
					<p v-if="vm.manualReflectResult.get(entry.questionId)!.type === 'guardrail'" class="reflection-guardrail" style="--chip-parent-cap: 1cap">
						<em>{{ vm.manualReflectResult.get(entry.questionId)!.message }}</em> <span class="chip chip-ai">AI-generated</span>
					</p>
					<p v-else-if="vm.manualReflectResult.get(entry.questionId)!.type === 'thought_bubble'" class="reflection-thought-bubble" style="--chip-parent-cap: 1cap">
						<span class="thought-bubble-icon" aria-hidden="true">💭</span> <em>{{ vm.manualReflectResult.get(entry.questionId)!.message }}</em> <span class="chip chip-ai">AI-generated</span>
					</p>
					<p v-else class="manual-reflect-positive"><em>Your answer looks good!</em></p>
				</template>
			</template>
			<ExamineTextarea
				:id="`q-${entry.questionId}`"
				:ref="
					(el: any) => {
						entryTextareas[index] = el;
						if (index === vm.editingEntryIndex) activeTextarea = el;
					}
				"
				v-model="entry.userAnswer"
				:autofilled="index === vm.editingEntryIndex && entry.autoFilledPending"
				:variant="index === vm.editingEntryIndex ? undefined : 'answered'"
				:rows="index === vm.editingEntryIndex ? 5 : 3"
				:placeholder="index === vm.editingEntryIndex ? 'Type your reflection here...' : ''"
				@update:model-value="index === vm.editingEntryIndex ? onActiveEntryInput(entry) : onAnsweredEntryInput(entry)"
				@blur="index === vm.editingEntryIndex ? vm.persistEntries() : vm.onAnsweredEntryBlur(entry)"
				@keydown="onKeydown(index, $event)"
			/>
			<p v-if="entry.submitted && (vm.manualReflectLoading.has(entry.questionId) || (vm.inferring && index === vm.entries.length - 1))" class="hint">Thinking about your answer...</p>
			<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
			<button v-else-if="entry.submitted && index !== vm.editingEntryIndex" class="reflect-link-btn" @click="handleReflectOnEntry(entry.questionId, index)">Help me reflect</button>
			<template v-if="index === vm.editingEntryIndex">
				<div v-if="entry.autoFilledPending" class="autofill-actions">
					<AppButton variant="primary" @click="handleEditAutoFill(entry, index)">Edit answer</AppButton>
					<AppButton variant="primary" @click="handleClearAutoFill(entry, index)">Write my own</AppButton>
				</div>
				<template v-else>
					<AppButton variant="primary" class="submit-btn" :disabled="vm.awaitingReflection || entry.userAnswer.trim() === ''" @click="handleSubmitAnswer">Next</AppButton>
					<p v-if="vm.manualReflectResult.has(entry.questionId)" class="hint">Press Next to continue as-is, or edit your answer above</p>
					<p v-else-if="hasPhysicalKeyboard()" class="hint">Shift + Enter to submit</p>
				</template>
			</template>
		</div>

		<div v-if="vm.allAnswered && !vm.inferring && vm.editingEntryIndex === -1 && !vm.awaitingReflection" class="card-hrule">
			<h3 class="descriptions-heading">Which of these feel right to you?</h3>
			<div class="description-list">
				<label v-for="d in vm.cardDescriptions" :key="d.id" class="description-row">
					<input type="checkbox" :checked="vm.selectedDescriptionIds.has(d.id)" class="description-checkbox" @change="vm.toggleDescription(d.id)" />
					<span class="description-text">{{ d.text }}</span>
				</label>
			</div>
			<AppButton v-if="!vm.descriptionsConfirmed" variant="primary" class="submit-btn" @click="handleConfirmDescriptions">Next</AppButton>
		</div>

		<div v-if="vm.freeformVisible" class="card-hrule">
			<label for="freeform-notes">Additional notes about this source of meaning</label>
			<ExamineTextarea id="freeform-notes" ref="freeformTextarea" v-model="vm.freeformNote" :rows="5" placeholder="Any other thoughts you'd like to capture (optional)" @update:model-value="debouncedFreeformPersist" @blur="vm.onFreeformBlur()" @keydown="onKeydown(null, $event)" />
		</div>

		<AppButton :variant="vm.readyForReflect ? 'primary' : 'secondary'" class="finish-btn" @click="handleFinishExamining">Finish examining {{ vm.card.source }}</AppButton>
	</main>
</template>

<style scoped>
main {
	margin: var(--space-8) auto;
	max-width: 36rem;
	padding: 0 var(--space-6);
	color: var(--color-black);
	transition: opacity 2s ease;
}

main.fading-out {
	opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
	main {
		transition: none;
	}
}

header {
	margin-bottom: var(--space-8);
}

h1 {
	margin: 0 0 var(--space-1);
}

.description {
	font-weight: 400;
	border-left: 3px solid var(--color-green-600);
	padding: var(--space-4) 0 var(--space-4) var(--space-5);
	margin: var(--space-16) 0 var(--space-12) 0;
}

.source {
	color: var(--color-gray-600);
}

label {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-gray-800);
	cursor: pointer;
}

.submit-btn {
	width: 100%;
	margin-top: var(--space-4);
}

.hint {
	font-size: var(--text-sm);
	color: var(--color-gray-400);
	margin: var(--space-2) 0 0;
}

.question-card p {
	margin-bottom: var(--space-2);
}

.reflection-guardrail {
	font-size: var(--text-lg);
	font-weight: 600;
	color: var(--color-warning);
	margin: 0 0 var(--space-2);
}

.reflection-thought-bubble {
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-green-600);
	background: var(--color-success-bg);
	border-left: 3px solid var(--color-green-600);
	padding: var(--space-3) var(--space-4);
	margin: 0 0 var(--space-2);
	font-style: italic;
}

.reflect-link-btn {
	background: none;
	border: none;
	color: var(--color-gray-400);
	font-size: var(--text-sm);
	text-decoration: underline;
	cursor: pointer;
	padding: 0;
	margin-top: var(--space-1);
}

.has-hover .reflect-link-btn:hover,
.reflect-link-btn:active {
	color: var(--color-green-600);
}

.reflect-link-btn:disabled {
	background: none;
	border: none;
	text-decoration: none;
	cursor: default;
}

.manual-reflect-positive {
	font-size: var(--text-sm);
	color: var(--color-green-600);
	font-style: italic;
	margin: var(--space-1) 0 0;
}

.autofill-actions {
	display: flex;
	gap: var(--space-3);
	margin-top: var(--space-4);
}

.autofill-actions button {
	flex: 1;
}

.descriptions-heading {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-gray-800);
	margin: 0 0 var(--space-4);
}

.description-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.description-row {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 1rem;
	background: var(--color-white);
	cursor: pointer;
	user-select: none;
}

.description-checkbox {
	width: 1.15rem;
	height: 1.15rem;
	flex-shrink: 0;
	accent-color: var(--color-green-600);
	cursor: pointer;
}

.description-text {
	font-size: 0.95rem;
}

.finish-btn {
	width: 100%;
	margin-top: var(--space-6);
}
</style>
