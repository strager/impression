<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AppButton from "./AppButton.vue";
import ReportContent from "./ReportContent.vue";
import { budgetedFetch } from "./api.ts";
import { capture } from "./analytics.ts";
import { useStringParam } from "./route-utils.ts";
import { exportSessionData, loadPaperSize, savePaperSize } from "./store.ts";
import type { PaperSize } from "./store.ts";
import { ReportViewModel } from "./ReportViewModel.ts";
import reportPageCss from "./report-page.css?inline";

const router = useRouter();
const sessionId = useStringParam("sessionId");
const vm = new ReportViewModel(sessionId);

const paperSize = ref<PaperSize>(loadPaperSize());
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

function onPaperSizeChange(event: Event): void {
	if (!(event.target instanceof HTMLSelectElement)) return;
	const value = event.target.value;
	if (value !== "a4" && value !== "letter") return;
	paperSize.value = value;
	savePaperSize(value);
}

async function downloadPdf(): Promise<void> {
	capture("pdf_download_initiated", { session_id: sessionId });
	const params = new URLSearchParams({ paperSize: paperSize.value });
	await downloadReport(`/api/report-pdf?${params.toString()}`, "impression-report.pdf");
}

async function downloadHtml(): Promise<void> {
	await downloadReport("/api/report-html", "impression-report.html");
}

onMounted(() => {
	const result = vm.initialize();
	if (result === "no-data") {
		void router.replace({ name: "findMeaning", params: { sessionId } });
	}
});

onBeforeUnmount(() => {
	clearDailyLimitTimers();
});
</script>

<template>
	<Teleport to="head">
		<component :is="'style'">{{ reportPageCss }}</component>
	</Teleport>
	<ReportContent :reports="vm.reports">
		<template #header-actions>
			<div class="download-controls">
				<div class="paper-size-group">
					<label for="paper-size">Paper size</label>
					<select id="paper-size" :value="paperSize" @change="onPaperSizeChange">
						<option value="letter">US Letter</option>
						<option value="a4">A4</option>
					</select>
				</div>
				<AppButton variant="primary" class="download-btn" :disabled="downloading || dailyLimitReached" @click="downloadPdf">
					{{ downloading ? "Generating…" : "Download PDF" }}
				</AppButton>
			</div>
			<!-- For development only: -->
			<AppButton v-if="false" variant="secondary" class="download-btn" :disabled="downloading" @click="downloadHtml">Download HTML</AppButton>
			<p v-if="downloadError !== ''" class="download-error">{{ downloadError }}</p>
			<p v-if="dailyLimitReached" class="download-limit-note download-limit-note--reached">You've reached the daily download limit. Try again in {{ dailyLimitRetryTime }}.</p>
			<p v-else-if="!dailyLimitReached && pdfDownloadsRemaining !== null" class="download-limit-note">{{ pdfDownloadsRemaining.toString() }} of 3 PDF downloads remaining today.</p>
			<p v-else-if="!dailyLimitReached" class="download-limit-note">PDF downloads are limited to 3 per day.</p>
		</template>
		<template #card-synthesis-error="{ report }">
			<a class="retry-link" role="button" tabindex="0" @click="vm.retrySynthesis(report.card.id)" @keydown.enter="vm.retrySynthesis(report.card.id)">Retry</a>
		</template>
	</ReportContent>
</template>

<style scoped>
.download-controls {
	display: flex;
	align-items: flex-end;
	gap: var(--space-4);
	flex-wrap: wrap;
}

.paper-size-group select {
	width: auto;
}

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
	.download-controls,
	.download-error,
	.download-limit-note {
		display: none;
	}
}
</style>
