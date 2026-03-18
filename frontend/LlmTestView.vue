<script setup lang="ts">
import { reactive, ref, watch } from "vue";

import { fetchReflectOnAnswer, fetchInferredAnswers, fetchSummary } from "./api.ts";
import type { LlmTestState } from "./store.ts";
import { loadLlmTestState, saveLlmTestState } from "./store.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";

interface QuestionRow {
	questionId: string;
	answer: string;
	depthLoading: boolean;
	depthResult: string | null;
	depthError: string | null;
	summarizeLoading: boolean;
	summarizeResult: string | null;
	summarizeError: string | null;
}

function createRow(): QuestionRow {
	return {
		questionId: EXPLORE_QUESTIONS[0].id,
		answer: "",
		depthLoading: false,
		depthResult: null,
		depthError: null,
		summarizeLoading: false,
		summarizeResult: null,
		summarizeError: null,
	};
}

function toQuestionRows(storedRows: LlmTestState["rows"]): QuestionRow[] {
	return storedRows.map((row) => ({
		questionId: row.questionId,
		answer: row.answer,
		depthLoading: false,
		depthResult: null,
		depthError: null,
		summarizeLoading: false,
		summarizeResult: null,
		summarizeError: null,
	}));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persistState(): void {
	saveLlmTestState({
		cardId: selectedCardId.value,
		rows: rows.map((row) => ({
			questionId: row.questionId,
			answer: row.answer,
		})),
	});
}

function debouncedSave(): void {
	if (saveTimer !== undefined) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = undefined;
		persistState();
	}, 300);
}

const stored = loadLlmTestState();
const selectedCardId = ref(stored !== null ? stored.cardId : MEANING_CARDS[0].id);
const rows = reactive<QuestionRow[]>(stored !== null ? toQuestionRows(stored.rows) : [createRow()]);

watch(selectedCardId, persistState);

const inferResult = ref<string | null>(null);
const inferLoading = ref(false);
const inferError = ref<string | null>(null);

function addRow() {
	rows.push(createRow());
	persistState();
}

function removeRow(index: number) {
	rows.splice(index, 1);
	persistState();
}

async function checkDepth(row: QuestionRow) {
	row.depthLoading = true;
	row.depthError = null;
	row.depthResult = null;
	try {
		const result = await fetchReflectOnAnswer({
			cardId: selectedCardId.value,
			questionId: row.questionId,
			answer: row.answer,
		});
		row.depthResult = JSON.stringify(result, null, 2);
	} catch (e) {
		row.depthError = e instanceof Error ? e.message : String(e);
	} finally {
		row.depthLoading = false;
	}
}

async function summarize(row: QuestionRow) {
	row.summarizeLoading = true;
	row.summarizeError = null;
	row.summarizeResult = null;
	try {
		const result = await fetchSummary({
			cardId: selectedCardId.value,
			questionId: row.questionId,
			answer: row.answer,
		});
		row.summarizeResult = JSON.stringify(result, null, 2);
	} catch (e) {
		row.summarizeError = e instanceof Error ? e.message : String(e);
	} finally {
		row.summarizeLoading = false;
	}
}

async function inferAnswers() {
	inferLoading.value = true;
	inferError.value = null;
	inferResult.value = null;
	try {
		const result = await fetchInferredAnswers({
			cardId: selectedCardId.value,
			questions: rows.map((r) => ({ questionId: r.questionId, answer: r.answer })),
		});
		inferResult.value = JSON.stringify(result, null, 2);
	} catch (e) {
		inferError.value = e instanceof Error ? e.message : String(e);
	} finally {
		inferLoading.value = false;
	}
}
</script>

<template>
	<!-- eslint-disable vue/no-restricted-html-elements -->
	<div class="llm-test">
		<h1>LLM Test</h1>

		<label>
			Card
			<select v-model="selectedCardId">
				<option v-for="card in MEANING_CARDS" :key="card.id" :value="card.id">{{ card.source }} &mdash; {{ card.description }}</option>
			</select>
		</label>

		<div v-for="(row, i) in rows" :key="i" class="question-row">
			<div class="row-header">
				<label>
					Question
					<select v-model="row.questionId" @change="persistState()">
						<option v-for="q in EXPLORE_QUESTIONS" :key="q.id" :value="q.id">{{ q.topic }}: {{ q.text }}</option>
					</select>
				</label>
				<button v-if="rows.length > 1" class="remove-btn" @click="removeRow(i)">Remove</button>
			</div>

			<label>
				Answer
				<textarea v-model="row.answer" rows="3" placeholder="Type an answer..." @input="debouncedSave()"></textarea>
			</label>

			<div class="row-actions">
				<button :disabled="row.depthLoading" @click="checkDepth(row)">
					{{ row.depthLoading ? "Reflecting..." : "Reflect" }}
				</button>
				<button :disabled="row.summarizeLoading" @click="summarize(row)">
					{{ row.summarizeLoading ? "Summarizing..." : "Summarize" }}
				</button>
			</div>

			<div v-if="row.depthLoading || row.depthResult || row.depthError" class="result-section">
				<h3>Reflect</h3>
				<p v-if="row.depthLoading">Loading...</p>
				<pre v-if="row.depthResult">{{ row.depthResult }}</pre>
				<p v-if="row.depthError" class="error">{{ row.depthError }}</p>
			</div>

			<div v-if="row.summarizeLoading || row.summarizeResult || row.summarizeError" class="result-section">
				<h3>Summarize</h3>
				<p v-if="row.summarizeLoading">Loading...</p>
				<pre v-if="row.summarizeResult">{{ row.summarizeResult }}</pre>
				<p v-if="row.summarizeError" class="error">{{ row.summarizeError }}</p>
			</div>
		</div>

		<div class="global-actions">
			<button @click="addRow">+ Add question</button>
			<button :disabled="inferLoading" @click="inferAnswers">
				{{ inferLoading ? "Inferring..." : "Infer Answers" }}
			</button>
		</div>

		<div v-if="inferLoading || inferResult || inferError" class="result-section">
			<h2>Infer Answers</h2>
			<p v-if="inferLoading">Loading...</p>
			<pre v-if="inferResult">{{ inferResult }}</pre>
			<p v-if="inferError" class="error">{{ inferError }}</p>
		</div>
	</div>
</template>

<style scoped>
.llm-test {
	max-width: 800px;
	margin: 0 auto;
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

label {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

select,
textarea {
	width: 100%;
	font-size: 1rem;
	padding: 0.5rem;
}

.question-row {
	border: 1px solid #ccc;
	border-radius: 4px;
	padding: 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.row-header {
	display: flex;
	gap: 0.5rem;
	align-items: end;
}

.row-header label {
	flex: 1;
}

.remove-btn {
	padding: 0.5rem 0.75rem;
	font-size: 0.875rem;
}

.row-actions {
	display: flex;
	gap: var(--space-2);
}

.row-actions button,
.global-actions button {
	padding: 0.5rem 1rem;
}

.row-actions button:disabled,
.global-actions button:disabled {
	cursor: wait;
}

.global-actions {
	display: flex;
	gap: var(--space-2);
}

.result-section pre {
	background: #f5f5f5;
	padding: 0.75rem;
	overflow-x: auto;
	white-space: pre-wrap;
}

.error {
	color: red;
}
</style>
