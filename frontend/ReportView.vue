<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import ReportContent from "./ReportContent.vue";
import { budgetedFetch } from "./api.ts";
import type { CardReport, QuestionReport } from "../shared/report-types.ts";
import { capture } from "./analytics.ts";
import { useStringParam } from "./route-utils.ts";
import { exportSessionData, loadChosenCardIds, loadExploreData, lookupCachedSummary } from "./store.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { MEANING_STATEMENTS } from "../shared/meaning-statements.ts";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

const reports = ref<CardReport[]>([]);
const downloading = ref(false);
const downloadError = ref("");
const pdfDownloadsRemaining = ref<number | null>(null);
const dailyLimitReached = ref(false);
const dailyLimitRetryTime = ref("");
const dailyLimitResetAtMs = ref<number | null>(null);

let clearDailyLimitTimeout: number | undefined;

function formatWaitTime(seconds: number): string {
	if (seconds <= 0) {
		return "less than 1 hour";
	}
	const hours = Math.ceil(seconds / (60 * 60));
	if (hours <= 1) return "1 hour";
	return `${hours.toString()} hours`;
}

function parseRetryAfterSeconds(value: string | null): number | null {
	if (value === null) {
		return null;
	}

	const numericSeconds = Number.parseInt(value, 10);
	if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
		return numericSeconds;
	}

	const retryAt = Date.parse(value);
	if (Number.isNaN(retryAt)) {
		return null;
	}
	return Math.max(Math.ceil((retryAt - Date.now()) / 1000), 0);
}

function clearDailyLimitTimers(): void {
	if (clearDailyLimitTimeout !== undefined) {
		window.clearTimeout(clearDailyLimitTimeout);
		clearDailyLimitTimeout = undefined;
	}
}

function clearDailyLimitState(resetRemaining: boolean): void {
	dailyLimitReached.value = false;
	dailyLimitRetryTime.value = "";
	dailyLimitResetAtMs.value = null;
	if (resetRemaining) {
		pdfDownloadsRemaining.value = null;
	}
	if (clearDailyLimitTimeout !== undefined) {
		window.clearTimeout(clearDailyLimitTimeout);
		clearDailyLimitTimeout = undefined;
	}
}

function clearDailyLimitStateIfExpired(): void {
	if (dailyLimitResetAtMs.value !== null && Date.now() >= dailyLimitResetAtMs.value) {
		clearDailyLimitState(true);
	}
}

function scheduleDailyLimitClear(retryAfterSeconds: number): void {
	const retryAfterMs = Math.max(retryAfterSeconds, 0) * 1000;
	dailyLimitResetAtMs.value = Date.now() + retryAfterMs;
	clearDailyLimitTimers();
	clearDailyLimitTimeout = window.setTimeout(() => {
		clearDailyLimitStateIfExpired();
	}, retryAfterMs);
}

async function downloadReport(endpoint: string, filename: string): Promise<void> {
	clearDailyLimitStateIfExpired();
	downloading.value = true;
	downloadError.value = "";

	try {
		const body = exportSessionData(sessionId);
		const response = await budgetedFetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body,
		});

		const remainingHeader = response.headers.get("X-Impression-PDF-Downloads-Remaining");
		if (remainingHeader !== null) {
			const parsedRemaining = Number.parseInt(remainingHeader, 10);
			if (Number.isFinite(parsedRemaining) && parsedRemaining >= 0) {
				pdfDownloadsRemaining.value = parsedRemaining;
			}
		}

		if (!response.ok) {
			const errorBody: unknown = await response
				.clone()
				.json()
				.catch(() => null);
			if (typeof errorBody === "object" && errorBody !== null && "code" in errorBody && errorBody.code === "daily_limit_exceeded") {
				const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
				dailyLimitReached.value = true;
				if (retryAfterSeconds !== null) {
					dailyLimitRetryTime.value = formatWaitTime(retryAfterSeconds);
					scheduleDailyLimitClear(retryAfterSeconds);
				} else {
					dailyLimitRetryTime.value = "about 1 hour";
					scheduleDailyLimitClear(60 * 60);
				}
				return;
			}
			clearDailyLimitState(false);
			throw new Error(`Report generation failed (${response.status.toString()})`);
		}
		clearDailyLimitState(false);

		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	} catch (error) {
		downloadError.value = error instanceof Error ? error.message : "Download failed.";
	} finally {
		downloading.value = false;
	}
}

async function downloadPdf(): Promise<void> {
	capture("pdf_download_initiated", { session_id: sessionId });
	await downloadReport("/api/report-pdf", "impression-report.pdf");
}

async function downloadHtml(): Promise<void> {
	await downloadReport("/api/report-html", "impression-report.html");
}

onMounted(() => {
	try {
		const cardIds = loadChosenCardIds(sessionId);
		if (cardIds === null) {
			void router.replace({ name: "findMeaning", params: { sessionId } });
			return;
		}

		const exploreData = loadExploreData(sessionId) ?? {};
		const statementTextById = new Map(MEANING_STATEMENTS.map((s) => [s.id, s.statement]));

		for (const cardId of cardIds) {
			const card = cardsById.get(cardId);
			if (card === undefined) continue;

			const hasCardData = cardId in exploreData;
			const entries = hasCardData ? exploreData[cardId].entries : [];
			const answersByQuestionId = new Map(entries.map((e) => [e.questionId, e.userAnswer]));
			const questions: QuestionReport[] = [];

			for (const question of EXPLORE_QUESTIONS) {
				const answer = answersByQuestionId.get(question.id) ?? "";
				const summary = lookupCachedSummary({ sessionId, cardId, answer, questionId: question.id }) ?? "";

				questions.push({
					topic: question.topic,
					question: question.questionFirstPerson,
					answer,
					summary,
				});
			}

			const freeformNote = hasCardData ? exploreData[cardId].freeformNote : "";
			const freeformSummary = lookupCachedSummary({ sessionId, cardId, answer: freeformNote }) ?? "";

			const selectedIds = hasCardData ? exploreData[cardId].statementSelections : [];
			const selectedStatements = selectedIds.map((id) => statementTextById.get(id)).filter((text): text is string => text !== undefined);

			reports.value.push({ card, questions, selectedStatements, freeformNote, freeformSummary });
		}
		capture("report_viewed", { session_id: sessionId });
	} catch {
		void router.replace({ name: "findMeaning", params: { sessionId } });
	}
});

onBeforeUnmount(() => {
	clearDailyLimitTimers();
});
</script>

<template>
	<ReportContent :reports="reports">
		<template #header-actions>
			<AppButton variant="primary" class="download-btn" :disabled="downloading || dailyLimitReached" @click="downloadPdf">
				{{ downloading ? "Generating…" : "Download PDF" }}
			</AppButton>
			<!-- For development only: -->
			<AppButton v-if="false" variant="secondary" class="download-btn" :disabled="downloading" @click="downloadHtml">Download HTML</AppButton>
			<p v-if="downloadError !== ''" class="download-error">{{ downloadError }}</p>
			<p v-if="dailyLimitReached" class="download-limit-note download-limit-note--reached">You've reached the daily download limit. Try again in {{ dailyLimitRetryTime }}.</p>
			<p v-else-if="!dailyLimitReached && pdfDownloadsRemaining !== null" class="download-limit-note">{{ pdfDownloadsRemaining.toString() }} of 3 PDF downloads remaining today.</p>
			<p v-else-if="!dailyLimitReached" class="download-limit-note">PDF downloads are limited to 3 per day.</p>
		</template>
	</ReportContent>
</template>

<style scoped>
.download-error {
	margin-top: var(--space-2);
	font-size: var(--text-sm);
	color: var(--color-error);
}

.download-limit-note {
	margin-top: var(--space-2);
	font-size: var(--text-sm);
	color: var(--color-muted);
}

.download-limit-note--reached {
	color: var(--color-error);
}

@media print {
	.download-btn,
	.download-error,
	.download-limit-note {
		display: none;
	}
}
</style>
