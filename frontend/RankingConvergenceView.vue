<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";

import type { StopMode } from "../shared/ranking.ts";
import RemainingEstimatePlot from "./RemainingEstimatePlot.vue";
import ViolinPlot from "./ViolinPlot.vue";
import type { OracleSpec, RunResult, WorkerRequest, WorkerResponse } from "./ranking-convergence-protocol.ts";
import ConvergenceWorker from "./ranking-convergence.worker.ts?worker";

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

interface TestDef {
	name: string;
	scenario: string;
	n: number;
	trueStrength: number[];
	oracleSpec: OracleSpec;
	expectedTopK: number[];
	config: { k: number; minK: number; m: number };
}

function range(n: number): number[] {
	return Array.from({ length: n }, (_, i) => i);
}

function descendingStrength(n: number): number[] {
	return Array.from({ length: n }, (_, i) => n - i);
}

function buildTests(): TestDef[] {
	const tests: TestDef[] = [];

	for (let n = 6; n <= 15; n++) {
		tests.push({
			name: `n=${String(n)}`,
			scenario: "perfect",
			n,
			trueStrength: descendingStrength(n),
			oracleSpec: { type: "perfect" },
			expectedTopK: range(5),
			config: { k: 5, minK: 3, m: 3 },
		});
	}

	for (const confidentCount of [3, 4, 5, 6]) {
		for (let n = 6; n <= 15; n++) {
			const strength = descendingStrength(n);
			const topItems = range(confidentCount);

			tests.push({
				name: `n=${String(n)}`,
				scenario: `noisy-t${String(confidentCount)}`,
				n,
				trueStrength: strength,
				oracleSpec: { type: "noisy", confidentItems: topItems, noiseRange: 4, noiseSeed: 77 },
				expectedTopK: topItems,
				config: { k: 5, minK: 3, m: 3 },
			});

			tests.push({
				name: `n=${String(n)}`,
				scenario: `rand-bot-t${String(confidentCount)}`,
				n,
				trueStrength: strength,
				oracleSpec: { type: "random-bottom", confidentItems: topItems, randomMax: n - confidentCount, noiseSeed: 99 },
				expectedTopK: topItems,
				config: { k: 5, minK: 3, m: 3 },
			});
		}
	}

	for (const n of [8, 10, 12]) {
		const strength = new Array<number>(n).fill(0);
		strength[0] = n;
		strength[1] = n - 1;
		strength[n - 2] = 2;
		strength[n - 1] = 1;
		const confidentItems = [0, 1, n - 2, n - 1];
		tests.push({
			name: `n=${String(n)}`,
			scenario: "mushy",
			n,
			trueStrength: strength,
			oracleSpec: { type: "mushy", confidentItems, n },
			expectedTopK: [0, 1],
			config: { k: 5, minK: 3, m: 3 },
		});
	}

	tests.push({
		name: "n=8",
		scenario: "reversal",
		n: 8,
		trueStrength: [8, 7, 6, 5, 4, 3, 2, 1],
		oracleSpec: {
			type: "reversal",
			reversalRound: 15,
			strengthsBefore: [8, 7, 6, 5, 4, 3, 2, 1],
			strengthsAfter: [8, 3, 6, 5, 4, 7, 2, 1],
		},
		expectedTopK: [0, 2, 3],
		config: { k: 5, minK: 3, m: 3 },
	});

	return tests;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface TestResult {
	name: string;
	runs: RunResult[];
	roundMin: number;
	roundMedian: number;
	roundMax: number;
	eKMin: number;
	eKMedian: number;
	eKMax: number;
	perfectCount: number;
	goodEnoughCount: number;
	incorrectCount: number;
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

// Build test matrix once so tables are always visible.
const allTests = buildTests();
const testNamesByScenario = new Map<string, string[]>();

for (const t of allTests) {
	const names = testNamesByScenario.get(t.scenario);
	if (names !== undefined) {
		names.push(t.name);
	} else {
		testNamesByScenario.set(t.scenario, [t.name]);
	}
}

const delta = ref<number | null>(null);
const stopMode = ref<StopMode>("boundary_only");
const maxTasks = ref<number | null>(null);
const m = ref(3);
const numSeeds = ref(10);
const running = ref(false);
const progressText = ref("");
const results = shallowRef(new Map<string, Map<string, TestResult>>());
const workerDurations = ref<number[]>([]);
const wallStartTime = ref(0);
const wallEndTime = ref(0);
const workerTiming = computed(() => {
	const d = workerDurations.value;
	if (d.length === 0) return null;
	const min = Math.min(...d);
	const max = Math.max(...d);
	const total = d.reduce((a, b) => a + b, 0);
	const avg = total / d.length;
	const wall = wallEndTime.value - wallStartTime.value;
	const parallelism = wall > 0 ? total / wall : 0;
	return { min, max, avg, total, wall, parallelism };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function medianOf(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

// ---------------------------------------------------------------------------
// Worker pool runner
// ---------------------------------------------------------------------------

function runAll(): void {
	running.value = true;
	results.value = new Map();
	workerDurations.value = [];
	wallStartTime.value = 0;
	wallEndTime.value = 0;

	const tests = buildTests();
	const seedCount = numSeeds.value;
	const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

	// Build job list: one job per (test, seed) pair
	interface Job {
		request: WorkerRequest;
		testIndex: number;
	}

	const jobs: Job[] = [];
	let jobId = 0;
	for (let ti = 0; ti < tests.length; ti++) {
		const t = tests[ti];
		for (const seed of seeds) {
			jobs.push({
				request: {
					jobId: jobId++,
					n: t.n,
					trueStrength: t.trueStrength,
					oracleSpec: t.oracleSpec,
					expectedTopK: t.expectedTopK,
					config: { ...t.config, m: m.value },
					...(delta.value !== null ? { delta: delta.value } : {}),
					stopMode: stopMode.value,
					...(maxTasks.value !== null ? { maxTasks: maxTasks.value } : {}),
					seed,
				},
				testIndex: ti,
			});
		}
	}

	const totalJobs = jobs.length;
	let completedJobs = 0;
	let nextJob = 0;

	// Collect results per test index
	const runsByTest = new Map<number, RunResult[]>();
	const newResults = new Map<string, Map<string, TestResult>>();

	function updateResults(testIndex: number): void {
		const runs = runsByTest.get(testIndex);
		if (runs === undefined || runs.length < seedCount) return;

		const t = tests[testIndex];
		const rounds = runs.map((r) => r.round);
		const eKs = runs.map((r) => r.eK);
		const testResult: TestResult = {
			name: t.name,
			runs,
			roundMin: Math.min(...rounds),
			roundMedian: medianOf(rounds),
			roundMax: Math.max(...rounds),
			eKMin: Math.min(...eKs),
			eKMedian: medianOf(eKs),
			eKMax: Math.max(...eKs),
			perfectCount: runs.filter((r) => r.correctness === "perfect").length,
			goodEnoughCount: runs.filter((r) => r.correctness === "good-enough").length,
			incorrectCount: runs.filter((r) => r.correctness === "incorrect").length,
		};

		let scenarioMap = newResults.get(t.scenario);
		if (scenarioMap === undefined) {
			scenarioMap = new Map();
			newResults.set(t.scenario, scenarioMap);
		}
		scenarioMap.set(t.name, testResult);

		results.value = new Map(newResults);
	}

	// Create worker pool
	const poolSize = Math.min(navigator.hardwareConcurrency, totalJobs);
	const workers: Worker[] = [];
	const submitTimes = new Map<number, number>();

	function dispatch(worker: Worker): void {
		if (nextJob >= totalJobs) return;
		const job = jobs[nextJob++];
		const now = performance.now();
		if (wallStartTime.value === 0) wallStartTime.value = now;
		submitTimes.set(job.request.jobId, now);
		worker.postMessage(job.request);
	}

	function onMessage(worker: Worker, e: MessageEvent<WorkerResponse>): void {
		const resp = e.data;
		const job = jobs[resp.jobId];
		const now = performance.now();
		wallEndTime.value = now;
		const submitTime = submitTimes.get(resp.jobId);
		if (submitTime !== undefined) {
			workerDurations.value.push(now - submitTime);
		}
		const ti = job.testIndex;

		let runs = runsByTest.get(ti);
		if (runs === undefined) {
			runs = [];
			runsByTest.set(ti, runs);
		}
		runs.push(resp.result);

		completedJobs++;
		progressText.value = `Running ${String(completedJobs)}/${String(totalJobs)}...`;

		updateResults(ti);

		if (completedJobs >= totalJobs) {
			// All done — terminate workers
			for (const w of workers) w.terminate();
			running.value = false;
			progressText.value = "";
			return;
		}

		// Dispatch next job to this worker
		dispatch(worker);
	}

	for (let i = 0; i < poolSize; i++) {
		const worker = new ConvergenceWorker();
		workers.push(worker);
		worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
			onMessage(worker, e);
		};
		dispatch(worker);
	}
}

function violinValues(runs: RunResult[]): { value: number; correctness: "perfect" | "good-enough" | "incorrect" }[] {
	return runs.map((r) => ({
		value: r.round,
		correctness: r.correctness,
	}));
}

function getResult(scenario: string, testName: string): TestResult | undefined {
	return results.value.get(scenario)?.get(testName);
}

function maxRoundsForScenario(scenario: string): number {
	const scenarioMap = results.value.get(scenario);
	if (scenarioMap === undefined) return 100;
	let max = 0;
	for (const row of scenarioMap.values()) {
		if (row.roundMax > max) max = row.roundMax;
	}
	return Math.max(max, 10);
}

function scenarioTotals(scenario: string): { totalPerfect: number; totalGoodEnough: number; totalIncorrect: number; totalRuns: number } {
	const names = testNamesByScenario.get(scenario) ?? [];
	let totalPerfect = 0;
	let totalGoodEnough = 0;
	let totalIncorrect = 0;
	let totalRuns = 0;
	for (const name of names) {
		const r = getResult(scenario, name);
		if (r === undefined) continue;
		totalPerfect += r.perfectCount;
		totalGoodEnough += r.goodEnoughCount;
		totalIncorrect += r.incorrectCount;
		totalRuns += numSeeds.value;
	}
	return { totalPerfect, totalGoodEnough, totalIncorrect, totalRuns };
}

const scenarioLabels: Record<string, string> = {
	perfect: "Perfect Oracle",
	"noisy-t3": "Noisy (top 3 stable)",
	"noisy-t4": "Noisy (top 4 stable)",
	"noisy-t5": "Noisy (top 5 stable)",
	"noisy-t6": "Noisy (top 6 stable)",
	"rand-bot-t3": "Random Bottom (top 3 stable)",
	"rand-bot-t4": "Random Bottom (top 4 stable)",
	"rand-bot-t5": "Random Bottom (top 5 stable)",
	"rand-bot-t6": "Random Bottom (top 6 stable)",
	mushy: "Mushy Middle",
	reversal: "Preference Reversal",
};

const scenarioDescriptions: Record<string, string> = {
	perfect: "Oracle always picks the truly best and worst items. Baseline for convergence speed. Should stop with confidence, eK=5, and correct=100%.",
	"noisy-t3": "Top 3 items are judged correctly; bottom items are jittered around their true strength (partial noise — still correlated with truth, unlike Random Bottom). Should identify the true top 3.",
	"noisy-t4": "Top 4 items are judged correctly; bottom items are jittered around their true strength (partial noise — still correlated with truth, unlike Random Bottom). Should identify the true top 4.",
	"noisy-t5": "Top 5 items are judged correctly; bottom items are jittered around their true strength (partial noise — still correlated with truth, unlike Random Bottom). Should identify the true top 5.",
	"noisy-t6": "Top 6 items are judged correctly; bottom items are jittered around their true strength (partial noise — still correlated with truth, unlike Random Bottom). Should identify the true top 5 (k=5 cap).",
	"rand-bot-t3": "Top 3 items are judged correctly; bottom items get completely random strengths. Should identify the true top 3.",
	"rand-bot-t4": "Top 4 items are judged correctly; bottom items get completely random strengths. Should identify the true top 4.",
	"rand-bot-t5": "Top 5 items are judged correctly; bottom items get completely random strengths. Should identify the true top 5.",
	"rand-bot-t6": "Top 6 items are judged correctly; bottom items get completely random strengths. Should identify the true top 5 (k=5 cap).",
	mushy: "Top 2 and bottom 2 items are clear; middle items are indistinguishable. Should identify the top 2 correctly (eK=3 or lower) despite the ambiguous middle.",
	reversal: "Oracle changes its preferences at round 15, swapping items 1 and 5. Should adapt to the new ordering and correctly identify items 0, 2, 3 as top.",
};

const scenarioOrder = ["perfect", "noisy-t3", "noisy-t4", "noisy-t5", "noisy-t6", "rand-bot-t3", "rand-bot-t4", "rand-bot-t5", "rand-bot-t6", "mushy", "reversal"];
</script>

<template>
	<!-- eslint-disable vue/no-restricted-html-elements -->
	<div class="rc-container">
		<h1>Ranking convergence</h1>

		<div class="controls">
			<label>
				Delta
				<input :value="delta ?? ''" type="number" step="0.01" min="0.01" max="1" placeholder="auto" class="num-input" @input="delta = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)" />
			</label>
			<label>
				Stop mode
				<select v-model="stopMode" class="select-input">
					<option value="boundary_only">Boundary only</option>
					<option value="all_cross_pairs">All cross-pairs</option>
					<option value="bayesian">Bayesian</option>
				</select>
			</label>
			<label>
				Max tasks
				<input :value="maxTasks ?? ''" type="number" min="1" max="9999" placeholder="auto" class="num-input" @input="maxTasks = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)" />
			</label>
			<label>
				m
				<input v-model.number="m" type="number" min="2" max="99" class="num-input" />
			</label>
			<label>
				Seeds
				<input v-model.number="numSeeds" type="number" min="1" max="100" class="num-input" />
			</label>
			<button :disabled="running" @click="runAll()">
				{{ running ? "Running..." : "Run" }}
			</button>
		</div>

		<p v-if="running" class="progress">{{ progressText }}</p>
		<p v-if="workerTiming" class="hint">Job time: min {{ workerTiming.min.toFixed(0) }}ms, avg {{ workerTiming.avg.toFixed(0) }}ms, max {{ workerTiming.max.toFixed(0) }}ms | total {{ (workerTiming.total / 1000).toFixed(1) }}s, wall {{ (workerTiming.wall / 1000).toFixed(1) }}s, {{ workerTiming.parallelism.toFixed(1) }}x parallelism ({{ workerDurations.length }} jobs)</p>

		<section v-for="scenario in scenarioOrder" :key="scenario" class="scenario-section">
			<h2>{{ scenarioLabels[scenario] ?? scenario }}</h2>
			<p class="scenario-desc">{{ scenarioDescriptions[scenario] }}</p>
			<table>
				<thead>
					<tr>
						<th>Test</th>
						<th>Delta</th>
						<th>Max</th>
						<th colspan="3">Rounds</th>
						<th>Distribution</th>
						<th><span class="hint-label" title="X: actual remaining (high to low, left to right = time). Y: predicted remaining (mid estimate). Dots above the dashed line = overestimates, below = underestimates.">Est. Remaining</span></th>
						<th colspan="3">eK</th>
						<th class="c-perfect" title="Perfect">P</th>
						<th class="c-good-enough" title="Good enough">G</th>
						<th class="c-incorrect" title="Incorrect">I</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="testName in testNamesByScenario.get(scenario)" :key="testName">
						<td>{{ testName }}</td>
						<template v-if="getResult(scenario, testName)">
							<td class="mono num">{{ getResult(scenario, testName)?.runs[0]?.delta }}</td>
							<td class="mono num">{{ getResult(scenario, testName)?.runs[0]?.maxTasks }}</td>
							<td class="mono num"><span class="stat-label">min</span>{{ getResult(scenario, testName)?.roundMin }}</td>
							<td class="mono num"><span class="stat-label">avg</span>{{ getResult(scenario, testName)?.roundMedian }}</td>
							<td class="mono num"><span class="stat-label">max</span>{{ getResult(scenario, testName)?.roundMax }}</td>
							<td>
								<ViolinPlot :values="violinValues(getResult(scenario, testName)?.runs ?? [])" :max-value="maxRoundsForScenario(scenario)" />
							</td>
							<td>
								<RemainingEstimatePlot v-if="(getResult(scenario, testName)?.runs.length ?? 0) > 0" :runs="getResult(scenario, testName)?.runs ?? []" />
							</td>
							<td class="mono num"><span class="stat-label">min</span>{{ getResult(scenario, testName)?.eKMin }}</td>
							<td class="mono num">
								<template v-if="getResult(scenario, testName)?.eKMin === getResult(scenario, testName)?.eKMax"></template><template v-else><span class="stat-label">avg</span>{{ getResult(scenario, testName)?.eKMedian }}</template>
							</td>
							<td class="mono num">
								<template v-if="getResult(scenario, testName)?.eKMin === getResult(scenario, testName)?.eKMax"></template><template v-else><span class="stat-label">max</span>{{ getResult(scenario, testName)?.eKMax }}</template>
							</td>
							<td class="mono num" :class="{ 'c-perfect': (getResult(scenario, testName)?.perfectCount ?? 0) > 0 }">{{ getResult(scenario, testName)?.perfectCount }}</td>
							<td class="mono num" :class="{ 'c-good-enough': (getResult(scenario, testName)?.goodEnoughCount ?? 0) > 0 }">{{ getResult(scenario, testName)?.goodEnoughCount }}</td>
							<td class="mono num" :class="{ 'c-incorrect': (getResult(scenario, testName)?.incorrectCount ?? 0) > 0 }">{{ getResult(scenario, testName)?.incorrectCount }}</td>
						</template>
						<template v-else>
							<td colspan="13"></td>
						</template>
					</tr>
				</tbody>
				<tfoot v-if="results.get(scenario)">
					<tr>
						<td colspan="11"><strong>Total</strong></td>
						<td class="mono num" :class="{ 'c-perfect': scenarioTotals(scenario).totalPerfect > 0 }">
							<strong>{{ scenarioTotals(scenario).totalPerfect }}</strong>
						</td>
						<td class="mono num" :class="{ 'c-good-enough': scenarioTotals(scenario).totalGoodEnough > 0 }">
							<strong>{{ scenarioTotals(scenario).totalGoodEnough }}</strong>
						</td>
						<td class="mono num" :class="{ 'c-incorrect': scenarioTotals(scenario).totalIncorrect > 0 }">
							<strong>{{ scenarioTotals(scenario).totalIncorrect }}</strong>
						</td>
					</tr>
				</tfoot>
			</table>
		</section>
	</div>
</template>

<style scoped>
.rc-container {
	max-width: 900px;
	margin: 0 auto;
	padding: 1rem;
}

.controls {
	display: flex;
	gap: 1rem;
	align-items: end;
	margin-bottom: 1rem;
}

.controls label {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.875rem;
}

.num-input {
	width: 5rem;
	padding: 0.4rem;
	font-size: 1rem;
}

.select-input {
	width: 10rem;
	padding: 0.4rem;
	font-size: 1rem;
}

.controls button {
	padding: 0.4rem 1.2rem;
	font-size: 1rem;
}

.controls button:disabled {
	cursor: wait;
}

.progress {
	color: #666;
	font-style: italic;
}

.hint {
	color: #888;
}

.scenario-section {
	margin-bottom: 2rem;
}

.scenario-section h2 {
	margin-bottom: 0.25rem;
}

.scenario-desc {
	color: #666;
	font-size: 0.875rem;
	margin-bottom: 0.5rem;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.875rem;
}

th,
td {
	padding: 0.35rem 0.5rem;
	text-align: left;
	border-bottom: 1px solid #e0e0e0;
}

th {
	font-weight: 600;
	border-bottom: 2px solid #ccc;
}

.mono {
	font-family: monospace;
}

.num {
	text-align: right;
}

.stat-label {
	color: #999;
	font-size: 0.75em;
	margin-right: 0.15em;
}

.hint-label {
	text-decoration: underline dotted;
	text-underline-offset: 2px;
	cursor: help;
}

.c-perfect {
	color: #2a6e4e;
}

.c-good-enough {
	color: #d97706;
}

.c-incorrect {
	color: #dc2626;
}
</style>
