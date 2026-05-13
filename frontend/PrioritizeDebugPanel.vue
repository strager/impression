<script setup lang="ts">
import dagre from "dagre";
import { computed } from "vue";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import type { PrioritizeViewModel } from "./PrioritizeViewModel.ts";

const props = defineProps<{ vm: PrioritizeViewModel }>();

const cardSourceById = new Map(MEANING_CARDS.map((c) => [c.id, c.source]));

function sourceFor(id: string): string {
	return cardSourceById.get(id) ?? id;
}

interface InternalRow {
	id: string;
	source: string;
	exposures: number;
	wins: number;
	losses: number;
	inTopK: boolean;
	sccSize: number;
}

const internalRows = computed<InternalRow[]>(() => {
	const debugState = props.vm.debugState;
	if (debugState === null) return [];
	const cardIds = props.vm.cardIds;
	const topKIds = new Set(props.vm.topK.map((c) => c.id));
	const winsByCard = new Map<string, number>();
	const lossesByCard = new Map<string, number>();
	for (const record of props.vm.history) {
		winsByCard.set(record.best, (winsByCard.get(record.best) ?? 0) + 1);
		lossesByCard.set(record.worst, (lossesByCard.get(record.worst) ?? 0) + 1);
	}
	const sccSizeByCard = new Map<string, number>();
	for (const comp of debugState.sccs) {
		for (const id of comp) {
			sccSizeByCard.set(id, comp.length);
		}
	}
	const rows: InternalRow[] = cardIds.map((id, i) => ({
		id,
		source: sourceFor(id),
		exposures: debugState.exposures[i],
		wins: winsByCard.get(id) ?? 0,
		losses: lossesByCard.get(id) ?? 0,
		inTopK: topKIds.has(id),
		sccSize: sccSizeByCard.get(id) ?? 1,
	}));
	rows.sort((a, b) => {
		if (a.inTopK !== b.inTopK) return a.inTopK ? -1 : 1;
		return b.wins - b.losses - (a.wins - a.losses);
	});
	return rows;
});

interface HistoryEntry {
	round: number;
	winnerSource: string;
	loserSource: string;
}

const historyEntries = computed<HistoryEntry[]>(() => {
	return props.vm.history.map((record, index) => ({
		round: index + 1,
		winnerSource: sourceFor(record.best),
		loserSource: sourceFor(record.worst),
	}));
});

interface RenderedNode {
	id: string;
	source: string;
	x: number;
	y: number;
	width: number;
	height: number;
	sccTint: number;
}

interface RenderedEdge {
	from: string;
	to: string;
	path: string;
	dashed: boolean;
	opacity: number;
	strokeWidth: number;
	weight?: number;
	labelX: number;
	labelY: number;
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

const graphLayout = computed<GraphLayout>(() => {
	const debugState = props.vm.debugState;
	const ids = new Set(props.vm.cardIds);
	const cards = MEANING_CARDS.filter((c) => ids.has(c.id));
	if (debugState === null || cards.length === 0) {
		return { nodes: [], edges: [], viewMinX: 0, viewMinY: 0, width: 0, height: 0 };
	}

	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: "TB", ranksep: 28, nodesep: 12, edgesep: 10, marginx: 8, marginy: 8 });
	g.setDefaultEdgeLabel(() => ({}));

	for (const card of cards) {
		const width = Math.max(NODE_MIN_WIDTH, card.source.length * NODE_CHAR_WIDTH + NODE_PADDING);
		g.setNode(card.id, { label: card.source, width, height: NODE_HEIGHT });
	}
	for (const [from, to] of debugState.edges) {
		g.setEdge(from, to);
	}

	dagre.layout(g);

	const sccTintByCard = new Map<string, number>();
	let multiSccCount = 0;
	for (const comp of debugState.sccs) {
		if (comp.length < 2) continue;
		multiSccCount++;
		for (const id of comp) sccTintByCard.set(id, multiSccCount);
	}

	const renderedNodes: RenderedNode[] = cards.map((card) => {
		const n = g.node(card.id);
		return { id: card.id, source: card.source, x: n.x, y: n.y, width: n.width, height: n.height, sccTint: sccTintByCard.get(card.id) ?? 0 };
	});

	const renderedEdges: RenderedEdge[] = debugState.edges.map(([from, to]) => {
		const dagreEdge = g.edge(from, to);
		const points = dagreEdge.points;
		const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${String(p.x)} ${String(p.y)}`).join(" ");
		const mid = points[Math.floor(points.length / 2)];
		return { from, to, path, dashed: false, opacity: 1, strokeWidth: 1.5, labelX: mid.x, labelY: mid.y };
	});

	// Overlay implied closure edges as dashed lines for pairs that have no direct edge.
	// We can't run dagre.layout for these without distorting the node layout, so we draw
	// straight lines between node centers and scale opacity by the implied weight.
	const directKeys = new Set<string>();
	for (const [from, to] of debugState.edges) directKeys.add(`${from}\x00${to}`);
	const nodeById = new Map<string, RenderedNode>(renderedNodes.map((n) => [n.id, n]));
	for (const [from, to, weight] of debugState.closureImplied) {
		if (directKeys.has(`${from}\x00${to}`) || directKeys.has(`${to}\x00${from}`)) continue;
		if (weight < 0.1) continue;
		const a = nodeById.get(from);
		const b = nodeById.get(to);
		if (a === undefined || b === undefined) continue;
		renderedEdges.push({
			from,
			to,
			path: `M ${String(a.x)} ${String(a.y)} L ${String(b.x)} ${String(b.y)}`,
			dashed: true,
			opacity: 0.2 + 0.6 * weight,
			strokeWidth: 1,
			weight,
			labelX: (a.x + b.x) / 2,
			labelY: (a.y + b.y) / 2,
		});
	}

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

const sccSummary = computed<string>(() => {
	const debugState = props.vm.debugState;
	if (debugState === null) return "—";
	const multi = debugState.sccs.filter((c) => c.length >= 2);
	if (multi.length === 0) return "none";
	return multi.map((c) => `{${c.map((id) => sourceFor(id)).join(", ")}}`).join(", ");
});

const SCC_TINTS = ["#fce7d6", "#dbeafe", "#fde7e3", "#e9d8fd", "#fef3c7", "#d1fae5"];

function sccFill(tint: number): string {
	if (tint === 0) return "var(--color-white)";
	return SCC_TINTS[(tint - 1) % SCC_TINTS.length];
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
				<div>
					<dt>Near-optimal sets</dt>
					<dd>{{ vm.debugState?.nearOptimalCount ?? "—" }}</dd>
				</div>
				<div>
					<dt>Direct edges</dt>
					<dd>{{ vm.debugState?.edges.length ?? "—" }}</dd>
				</div>
				<div class="full">
					<dt>Multi-card SCCs (cycles)</dt>
					<dd>{{ sccSummary }}</dd>
				</div>
			</dl>
			<table class="debug-table">
				<thead>
					<tr>
						<th>#</th>
						<th>Source</th>
						<th>Exposures</th>
						<th>Wins</th>
						<th>Losses</th>
						<th>Top-K</th>
						<th>SCC size</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(row, index) in internalRows" :key="row.id" :class="{ 'in-topk': row.inTopK }">
						<td>{{ index + 1 }}</td>
						<td>{{ row.source }}</td>
						<td>{{ row.exposures }}</td>
						<td>{{ row.wins }}</td>
						<td>{{ row.losses }}</td>
						<td>{{ row.inTopK ? "✓" : "" }}</td>
						<td>{{ row.sccSize > 1 ? row.sccSize : "" }}</td>
					</tr>
				</tbody>
			</table>
		</section>

		<section class="debug-section">
			<h3>History ({{ historyEntries.length }})</h3>
			<ol v-if="historyEntries.length > 0" class="debug-history">
				<li v-for="entry in historyEntries" :key="entry.round">{{ entry.round }}. {{ entry.winnerSource }} &gt; {{ entry.loserSource }}</li>
			</ol>
			<p v-else class="debug-empty">No comparisons yet.</p>
		</section>

		<section class="debug-section">
			<h3>Graph</h3>
			<p class="debug-help">Solid arrows: direct preference edges (winner → loser). Dashed: implied via transitive closure (weight ≥ 0.1). Nodes in the same tinted group share a multi-card SCC (cycle).</p>
			<div v-if="graphLayout.nodes.length > 0" class="debug-graph-scroll">
				<svg class="debug-graph" :style="{ minWidth: `${String(graphLayout.width)}px` }" :viewBox="`${String(graphLayout.viewMinX)} ${String(graphLayout.viewMinY)} ${String(graphLayout.width)} ${String(graphLayout.height)}`" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Comparison graph">
					<defs>
						<marker id="debug-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
						</marker>
					</defs>
					<g class="edges">
						<g v-for="edge in graphLayout.edges" :key="`${edge.from}-${edge.to}-${edge.dashed ? 'i' : 'd'}`" :style="{ opacity: edge.opacity }">
							<path :d="edge.path" :stroke="edge.dashed ? 'var(--color-gray-400)' : 'var(--color-gray-600)'" :stroke-width="edge.strokeWidth" :stroke-dasharray="edge.dashed ? '4 3' : undefined" :marker-end="edge.dashed ? undefined : 'url(#debug-arrowhead)'" />
							<text v-if="edge.weight !== undefined" :x="edge.labelX" :y="edge.labelY" class="edge-label">{{ edge.weight.toFixed(2) }}</text>
						</g>
					</g>
					<g class="nodes">
						<g v-for="node in graphLayout.nodes" :key="node.id">
							<rect :x="node.x - node.width / 2" :y="node.y - node.height / 2" :width="node.width" :height="node.height" rx="4" ry="4" class="node-rect" :style="{ fill: sccFill(node.sccTint) }" />
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

.debug-meta div.full {
	grid-column: 1 / -1;
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
