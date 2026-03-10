<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import ExploreTextarea from "./ExploreTextarea.vue";
import { ExploreMeaningViewModel } from "./ExploreMeaningViewModel.ts";
import { useStringParam } from "./route-utils.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";

const router = useRouter();

const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));

const sessionId = useStringParam("sessionId");
const cardId = useStringParam("meaningId");

const vm = new ExploreMeaningViewModel(sessionId, cardId);

const activeTextarea = ref<InstanceType<typeof ExploreTextarea> | null>(null);
const entryTextareas: (InstanceType<typeof ExploreTextarea> | null)[] = [];
const entryCards: (HTMLElement | null)[] = [];
const freeformTextarea = ref<InstanceType<typeof ExploreTextarea> | null>(null);

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

async function handleSubmitAnswer(): Promise<void> {
	const focusedAtStart = document.activeElement;
	const submittedIndex = vm.editingEntryIndex;
	await vm.submitAnswer();
	void nextTick(() => {
		const cur = document.activeElement;
		if (cur !== focusedAtStart && cur !== document.body && cur !== null) return;
		if (vm.allAnswered && vm.editingEntryIndex === -1) {
			freeformTextarea.value?.focus();
		} else {
			activeTextarea.value?.focus();
		}
	});
	if (submittedIndex >= 0 && vm.manualReflectResult.has(vm.entries[submittedIndex].questionId)) {
		void nextTick(() => {
			entryCards[submittedIndex]?.scrollIntoView({ block: "start", behavior: "smooth" });
		});
	}
}

function handleConfirmStatements(): void {
	vm.confirmStatements();
	void nextTick(() => {
		freeformTextarea.value?.focus();
	});
}

async function handleReflectOnEntry(questionId: string, index: number): Promise<void> {
	const entry = vm.entries[index];
	if (entry.userAnswer.trim() === "") {
		await vm.reflectOnEntry(questionId);
		entryTextareas[index]?.focus();
		void nextTick(() => {
			entryCards[index]?.scrollIntoView({ block: "start", behavior: "smooth" });
		});
		return;
	}
	await vm.reflectOnEntry(questionId);
	void nextTick(() => {
		entryCards[index]?.scrollIntoView({ block: "start", behavior: "smooth" });
	});
}

function onKeydown(index: number | null, event: KeyboardEvent): void {
	if (!(event.key === "Enter" && event.shiftKey)) return;
	event.preventDefault();
	if (index === vm.editingEntryIndex) {
		void handleSubmitAnswer();
	} else if (index !== null) {
		const next = entryTextareas[index + 1] ?? null;
		if (next !== null) {
			next.focus();
		} else if (vm.allAnswered) {
			freeformTextarea.value?.focus();
		}
	} else {
		handleFinishExploring();
	}
}

function handleFinishExploring(): void {
	vm.finishExploring();
	void router.push({ name: "explore", params: { sessionId } });
}

onMounted(() => {
	const status = vm.initialize();
	if (status === "no-data") {
		void router.replace({ name: "explore", params: { sessionId } });
	}
});
</script>

<template>
	<main v-if="vm.card">
		<header>
			<h1>Explore meaning</h1>

			<h2 class="description">
				&ldquo;{{ vm.card.description }}&rdquo; <span class="source">({{ vm.card.source }})</span>
			</h2>

			<div class="instruction-stack">
				<p :class="['instruction', { active: !vm.allAnswered && vm.submittedCount === 0 }]">Reflect on what this source of meaning means to you. Answer each question thoughtfully.</p>
				<p :class="['instruction', { active: !vm.allAnswered && vm.submittedCount > 0 }]">Question {{ vm.submittedCount + 1 }} of {{ EXPLORE_QUESTIONS.length }} — keep reflecting on this source of meaning.</p>
				<p :class="['instruction', { active: vm.allAnswered }]">You've answered all questions. Add any additional notes, or finish exploring this card.</p>
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
			class="card-hrule"
		>
			<label :for="`q-${entry.questionId}`"
				><q>{{ vm.card.description }}</q
				><br />{{ questionsById.get(entry.questionId)?.text }}</label
			>
			<p v-if="vm.prefilledQuestionIds.has(entry.questionId)" class="prefill-hint"><em>This answer was pre-filled based on your previous responses. Feel free to edit it.</em></p>
			<template v-if="entry.submitted">
				<template v-if="vm.manualReflectResult.has(entry.questionId)">
					<p v-if="vm.manualReflectResult.get(entry.questionId)!.type === 'guardrail'" class="reflection-guardrail">
						<em>{{ vm.manualReflectResult.get(entry.questionId)!.message }}</em>
					</p>
					<p v-else-if="vm.manualReflectResult.get(entry.questionId)!.type === 'thought_bubble'" class="reflection-thought-bubble">
						<span class="thought-bubble-icon" aria-hidden="true">💭</span> <em>{{ vm.manualReflectResult.get(entry.questionId)!.message }}</em>
					</p>
					<p v-else class="manual-reflect-positive"><em>Your answer looks good!</em></p>
				</template>
				<p v-if="vm.manualReflectLoading.has(entry.questionId) || (vm.inferring && index === vm.entries.length - 1)" class="hint">Thinking about your answer...</p>
				<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
				<button v-else-if="index !== vm.editingEntryIndex" class="reflect-link-btn" @click="handleReflectOnEntry(entry.questionId, index)">Get feedback</button>
			</template>
			<ExploreTextarea
				:id="`q-${entry.questionId}`"
				:ref="
					(el: any) => {
						entryTextareas[index] = el;
						if (index === vm.editingEntryIndex) activeTextarea = el;
					}
				"
				v-model="entry.userAnswer"
				:variant="index === vm.editingEntryIndex ? undefined : 'answered'"
				:rows="index === vm.editingEntryIndex ? 5 : 3"
				:placeholder="index === vm.editingEntryIndex ? 'Type your reflection here...' : ''"
				@update:model-value="index === vm.editingEntryIndex ? onActiveEntryInput(entry) : onAnsweredEntryInput(entry)"
				@blur="index === vm.editingEntryIndex ? vm.persistEntries() : vm.onAnsweredEntryBlur(entry)"
				@keydown="onKeydown(index, $event)"
			/>
			<template v-if="index === vm.editingEntryIndex">
				<AppButton variant="primary" class="submit-btn" :disabled="vm.awaitingReflection || entry.userAnswer.trim() === ''" @click="handleSubmitAnswer">Next</AppButton>
				<p v-if="vm.manualReflectResult.has(entry.questionId)" class="hint">Press Next to continue as-is, or edit your answer above</p>
				<p v-else class="hint keyboard-hint">Shift + Enter to submit</p>
			</template>
		</div>

		<div v-if="vm.allAnswered && !vm.inferring && vm.editingEntryIndex === -1 && !vm.awaitingReflection" class="card-hrule">
			<h3 class="statements-heading">Which of these statements resonate with you?</h3>
			<div class="statement-list">
				<label v-for="s in vm.cardStatements" :key="s.id" class="statement-row">
					<input type="checkbox" :checked="vm.selectedStatementIds.has(s.id)" class="statement-checkbox" @change="vm.toggleStatement(s.id)" />
					<span class="statement-text">{{ s.statement }}</span>
				</label>
			</div>
			<AppButton v-if="!vm.statementsConfirmed" variant="primary" class="submit-btn" @click="handleConfirmStatements">Next</AppButton>
		</div>

		<div v-if="vm.allAnswered && vm.statementsConfirmed && !vm.inferring && vm.editingEntryIndex === -1 && !vm.awaitingReflection" class="card-hrule">
			<label for="freeform-notes">Additional notes about this source of meaning</label>
			<ExploreTextarea id="freeform-notes" ref="freeformTextarea" v-model="vm.freeformNote" :rows="5" placeholder="Any other thoughts you'd like to capture (optional)" @update:model-value="debouncedFreeformPersist" @blur="vm.persistFreeform()" @keydown="onKeydown(null, $event)" />
		</div>

		<AppButton variant="secondary" class="finish-btn" @click="handleFinishExploring">Finish exploring</AppButton>
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

/* Hide by default; show only when a keyboard is likely present.
   https://github.com/w3c/csswg-drafts/issues/3871 */
.keyboard-hint {
	display: none;
}

@media (hover: hover) and (pointer: fine) {
	.keyboard-hint {
		display: block;
	}
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

.reflect-link-btn:hover {
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

.prefill-hint {
	font-size: var(--text-sm);
	color: var(--color-warning);
	margin: 0 0 var(--space-2);
}

.statements-heading {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 500;
	color: var(--color-gray-800);
	margin: 0 0 var(--space-4);
}

.statement-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.statement-row {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 1rem;
	background: var(--color-white);
	cursor: pointer;
	user-select: none;
}

.statement-checkbox {
	width: 1.15rem;
	height: 1.15rem;
	flex-shrink: 0;
	accent-color: var(--color-green-600);
	cursor: pointer;
}

.statement-text {
	font-size: 0.95rem;
}

.finish-btn {
	width: 100%;
	margin-top: var(--space-6);
}
</style>
