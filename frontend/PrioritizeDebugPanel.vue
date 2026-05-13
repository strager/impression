<script setup lang="ts">
import dagre from "dagre";
import { computed } from "vue";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import type { IdentifyRankingViewModel } from "./PrioritizeViewModel.ts";

const props = defineProps<{ vm: IdentifyRankingViewModel }>();

const cardSourceById = new Map(MEANING_CARDS.map((c) => [c.id, c.source]));

function sourceFor(id: string): string {
	return cardSourceById.get(id) ?? id;
}

interface InternalRow {
	id: string;
	source: string;
	mu: number;
	uncertainty: number;
	exposures: number;
	taskBest: number;
	taskWorst: number;
	inTopK: boolean;
}

const internalRows = computed<InternalRow[]>(() => {
	const debugState = props.vm.debugState;
	if (debugState === null) return [];
	const cardIds = props.vm.cardIds;
	const n = cardIds.length;
	const topKIds = new Set(props.vm.topK.map((c) => c.id));
	const bestCounts = new Map<string, number>();
	const worstCounts = new Map<string, number>();
	for (const record of props.vm.history) {
		bestCounts.set(record.best, (bestCounts.get(record.best) ?? 0) + 1);
		worstCounts.set(record.worst, (worstCounts.get(record.worst) ?? 0) + 1);
	}
	const rows: InternalRow[] = [];
	for (let i = 0; i < n; i++) {
		const id = cardIds[i];
		const variance = debugState.sigma[i * n + i];
		rows.push({
			id,
			source: sourceFor(id),
			mu: debugState.mu[i],
			uncertainty: Math.sqrt(Math.max(0, variance)),
			exposures: debugState.exposures[i],
			taskBest: bestCounts.get(id) ?? 0,
			taskWorst: worstCounts.get(id) ?? 0,
			inTopK: topKIds.has(id),
		});
	}
	rows.sort((a, b) => b.mu - a.mu);
	return rows;
});

interface HistoryEntry {
	round: number;
	bestSource: string;
	middleSource: string;
	worstSource: string;
}

const historyEntries = computed<HistoryEntry[]>(() => {
	return props.vm.history.map((record, index) => {
		const middleId = record.set.find((id) => id !== record.best && id !== record.worst) ?? "";
		return {
			round: index + 1,
			bestSource: sourceFor(record.best),
			middleSource: sourceFor(middleId),
			worstSource: sourceFor(record.worst),
		};
	});
});

interface PairEdge {
	from: string;
	to: string;
	forwardCount: number;
	reverseCount: number;
	diff: number;
}

interface RenderedNode {
	id: string;
	source: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface RenderedEdge extends PairEdge {
	path: string;
	labelX: number;
	labelY: number;
	opacity: number;
	strokeWidth: number;
	stroke: string;
}

interface GraphLayout {
	nodes: RenderedNode[];
	edges: RenderedEdge[];
	viewMinX: number;
	viewMinY: number;
	width: number;
	height: number;
}

const NODE_HEIGHT = 28;
const NODE_CHAR_WIDTH = 7;
const NODE_PADDING = 16;
const NODE_MIN_WIDTH = 60;

const pairEdges = computed<PairEdge[]>(() => {
	const directional = new Map<string, number>();
	for (const record of props.vm.history) {
		const middleId = record.set.find((id) => id !== record.best && id !== record.worst);
		if (middleId === undefined) continue;
		const pairs: [string, string][] = [
			[record.best, middleId],
			[record.best, record.worst],
			[middleId, record.worst],
		];
		for (const [from, to] of pairs) {
			const key = `${from}\x00${to}`;
			directional.set(key, (directional.get(key) ?? 0) + 1);
		}
	}

	const seen = new Set<string>();
	const result: PairEdge[] = [];
	for (const [key, count] of directional) {
		const [a, b] = key.split("\x00");
		const pairKey = a < b ? `${a}\x00${b}` : `${b}\x00${a}`;
		if (seen.has(pairKey)) continue;
		seen.add(pairKey);
		const reverseCount = directional.get(`${b}\x00${a}`) ?? 0;
		if (count === reverseCount) continue;
		if (count > reverseCount) {
			result.push({ from: a, to: b, forwardCount: count, reverseCount, diff: count - reverseCount });
		} else {
			result.push({ from: b, to: a, forwardCount: reverseCount, reverseCount: count, diff: reverseCount - count });
		}
	}
	return result;
});

const graphLayout = computed<GraphLayout>(() => {
	const ids = new Set(props.vm.cardIds);
	const cards = MEANING_CARDS.filter((c) => ids.has(c.id));
	const edges = pairEdges.value;
	if (cards.length === 0) {
		return { nodes: [], edges: [], viewMinX: 0, viewMinY: 0, width: 0, height: 0 };
	}

	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: "TB", ranksep: 28, nodesep: 12, edgesep: 10, marginx: 8, marginy: 8 });
	g.setDefaultEdgeLabel(() => ({}));

	for (const card of cards) {
		const width = Math.max(NODE_MIN_WIDTH, card.source.length * NODE_CHAR_WIDTH + NODE_PADDING);
		g.setNode(card.id, { label: card.source, width, height: NODE_HEIGHT });
	}
	for (const edge of edges) {
		g.setEdge(edge.from, edge.to);
	}

	dagre.layout(g);

	const renderedNodes: RenderedNode[] = cards.map((card) => {
		const n = g.node(card.id);
		return { id: card.id, source: card.source, x: n.x, y: n.y, width: n.width, height: n.height };
	});

	const maxDiff = edges.reduce((m, e) => Math.max(m, e.diff), 1);
	const renderedEdges: RenderedEdge[] = edges.map((edge) => {
		const dagreEdge = g.edge(edge.from, edge.to);
		const points = dagreEdge.points;
		const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${String(p.x)} ${String(p.y)}`).join(" ");
		const mid = points[Math.floor(points.length / 2)];
		const t = maxDiff > 1 ? (edge.diff - 1) / (maxDiff - 1) : 0;
		const opacity = 0.4 + 0.6 * t;
		const strokeWidth = 1.0 + 1.0 * t;
		const stroke = edge.reverseCount !== 0 ? "#d97706" : "var(--color-gray-600)";
		return { ...edge, path, labelX: mid.x, labelY: mid.y, opacity, strokeWidth, stroke };
	});

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const node of renderedNodes) {
		minX = Math.min(minX, node.x - node.width / 2);
		minY = Math.min(minY, node.y - node.height / 2);
		maxX = Math.max(maxX, node.x + node.width / 2);
		maxY = Math.max(maxY, node.y + node.height / 2);
	}
	for (const edge of edges) {
		const dagreEdge = g.edge(edge.from, edge.to);
		for (const p of dagreEdge.points) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
	}
	// Pad for arrowhead markers, stroke width, and edge count labels.
	const padding = 12;
	minX -= padding;
	minY -= padding;
	maxX += padding;
	maxY += padding;

	return {
		nodes: renderedNodes,
		edges: renderedEdges,
		viewMinX: minX,
		viewMinY: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
});

const remainingDisplay = computed<string>(() => {
	const est = props.vm.estimatedRemaining;
	if (est === null) return "—";
	return Math.ceil(est).toString();
});

function formatNumber(value: number, digits: number): string {
	if (!Number.isFinite(value)) return String(value);
	return value.toFixed(digits);
}
</script>

<template>
	<section class="debug-panel" aria-label="Prioritize debug view">
		<h2>Debug</h2>

		<section class="debug-section">
			<h3>Internal state</h3>
			<dl class="debug-meta">
				<div>
					<dt>Round</dt>
					<dd>{{ vm.round }}</dd>
				</div>
				<div>
					<dt>Stopped</dt>
					<dd>{{ vm.isComplete ? "yes" : "no" }}</dd>
				</div>
				<div>
					<dt>Stop reason</dt>
					<dd>{{ vm.stopReason ?? "—" }}</dd>
				</div>
				<div>
					<dt>Effective k</dt>
					<dd>{{ vm.effectiveK ?? "—" }}</dd>
				</div>
				<div>
					<dt>Estimated remaining</dt>
					<dd>{{ remainingDisplay }}</dd>
				</div>
				<div>
					<dt>N (cards)</dt>
					<dd>{{ vm.cardIds.length }}</dd>
				</div>
			</dl>
			<table class="debug-table">
				<thead>
					<tr>
						<th>#</th>
						<th>Source</th>
						<th>μ (utility)</th>
						<th>σ (uncertainty)</th>
						<th>Exposures</th>
						<th>Task Best</th>
						<th>Task Worst</th>
						<th>Top-K</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(row, index) in internalRows" :key="row.id" :class="{ 'in-topk': row.inTopK }">
						<td>{{ index + 1 }}</td>
						<td>{{ row.source }}</td>
						<td>{{ formatNumber(row.mu, 3) }}</td>
						<td>{{ formatNumber(row.uncertainty, 3) }}</td>
						<td>{{ row.exposures }}</td>
						<td>{{ row.taskBest }}</td>
						<td>{{ row.taskWorst }}</td>
						<td>{{ row.inTopK ? "✓" : "" }}</td>
					</tr>
				</tbody>
			</table>
		</section>

		<section class="debug-section">
			<h3>History ({{ historyEntries.length }})</h3>
			<ol v-if="historyEntries.length > 0" class="debug-history">
				<li v-for="entry in historyEntries" :key="entry.round">{{ entry.round }}. {{ entry.bestSource }} &gt; {{ entry.middleSource }} &gt; {{ entry.worstSource }}</li>
			</ol>
			<p v-else class="debug-empty">No comparisons yet.</p>
		</section>

		<section class="debug-section">
			<h3>Graph</h3>
			<p class="debug-help">Each triple A&gt;B&gt;C contributes A→B, A→C, B→C to the win counts. One edge per pair, drawn in the dominant direction (none if tied). Label format: +wins -losses; edges with a larger margin are darker.</p>
			<div v-if="graphLayout.nodes.length > 0" class="debug-graph-scroll">
				<svg class="debug-graph" :style="{ minWidth: `${String(graphLayout.width)}px` }" :viewBox="`${String(graphLayout.viewMinX)} ${String(graphLayout.viewMinY)} ${String(graphLayout.width)} ${String(graphLayout.height)}`" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Comparison graph">
					<defs>
						<marker id="debug-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
						</marker>
					</defs>
					<g class="edges">
						<g v-for="edge in graphLayout.edges" :key="`${edge.from}-${edge.to}`" :style="{ opacity: edge.opacity }">
							<path :d="edge.path" :stroke="edge.stroke" :stroke-width="edge.strokeWidth" marker-end="url(#debug-arrowhead)" />
							<text :x="edge.labelX" :y="edge.labelY" class="edge-label">
								<tspan :x="edge.labelX" dy="-0.4em">+{{ edge.forwardCount }}</tspan>
								<tspan :x="edge.labelX" dy="1.2em">−{{ edge.reverseCount }}</tspan>
							</text>
						</g>
					</g>
					<g class="nodes">
						<g v-for="node in graphLayout.nodes" :key="node.id">
							<rect :x="node.x - node.width / 2" :y="node.y - node.height / 2" :width="node.width" :height="node.height" rx="4" ry="4" class="node-rect" />
							<text :x="node.x" :y="node.y" class="node-label">{{ node.source }}</text>
						</g>
					</g>
				</svg>
			</div>
			<p v-else class="debug-empty">No cards yet.</p>
		</section>
	</section>
</template>

<style scoped>
.debug-panel {
	margin-top: var(--space-10);
	padding: var(--space-4);
	border: var(--border-thin);
	background: var(--color-gray-50);
	font-size: var(--text-sm);
	color: var(--color-gray-800);
}

.debug-panel h2 {
	margin: 0 0 var(--space-4);
	font-size: var(--text-xl);
}

.debug-section {
	margin-bottom: var(--space-6);
}

.debug-section:last-child {
	margin-bottom: 0;
}

.debug-section h3 {
	margin: 0 0 var(--space-2);
	font-size: var(--text-base);
}

.debug-meta {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	gap: var(--space-2) var(--space-4);
	margin: 0 0 var(--space-3);
}

.debug-meta div {
	display: flex;
	flex-direction: column;
}

.debug-meta dt {
	color: var(--color-gray-400);
	font-size: var(--text-xs);
}

.debug-meta dd {
	margin: 0;
	font-variant-numeric: tabular-nums;
}

.debug-table {
	width: 100%;
	border-collapse: collapse;
	font-variant-numeric: tabular-nums;
}

.debug-table th,
.debug-table td {
	text-align: left;
	padding: var(--space-1) var(--space-2);
	border-bottom: var(--border-thin);
}

.debug-table th {
	color: var(--color-gray-600);
	font-weight: normal;
}

.debug-table tr.in-topk {
	background: var(--color-success-bg);
}

.debug-history {
	margin: 0;
	padding-left: var(--space-5);
	font-variant-numeric: tabular-nums;
	max-height: 240px;
	overflow-y: scroll;
	list-style: none;
}

.debug-history li {
	padding: 2px 0;
}

.debug-empty {
	margin: 0;
	color: var(--color-gray-400);
}

.debug-help {
	margin: 0 0 var(--space-2);
	color: var(--color-gray-400);
	font-size: var(--text-xs);
}

.debug-graph-scroll {
	overflow-x: auto;
	background: var(--color-white);
	border: var(--border-thin);
	/* Full-bleed: extend past <main>'s 36rem cap to the viewport edges. */
	margin-left: calc(50% - 50vw);
	margin-right: calc(50% - 50vw);
}

.debug-graph {
	display: block;
	width: 100%;
	height: auto;
}

.debug-graph .edges path {
	fill: none;
}

.debug-graph .edge-label {
	fill: var(--color-gray-800);
	font-size: 10px;
	font-variant-numeric: tabular-nums;
	text-anchor: middle;
	dominant-baseline: central;
	paint-order: stroke;
	stroke: var(--color-white);
	stroke-width: 3;
}

.debug-graph .node-rect {
	fill: var(--color-white);
	stroke: var(--color-green-600);
	stroke-width: 1;
}

.debug-graph .node-label {
	fill: var(--color-black);
	font-size: 11px;
	text-anchor: middle;
	dominant-baseline: central;
}
</style>
