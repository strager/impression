<script setup lang="ts">
import licensesData from "./licenses.json";
import { LicensesViewModel, parseLicenses, type LicenseEntry } from "./LicensesViewModel.ts";

const vm = new LicensesViewModel(parseLicenses(licensesData));

function entryKey(entry: LicenseEntry): string {
	return `${entry.name ?? "unknown"}@${entry.version ?? "unknown"}`;
}

function entryHref(entry: LicenseEntry): string | null {
	return entry.homepage ?? entry.repository;
}
</script>

<template>
	<main>
		<nav class="back-nav">
			<router-link to="/">&larr; Back to home</router-link>
		</nav>

		<h1>Licenses</h1>

		<section class="intro">
			<p>Impression is built on top of open source software. The libraries below are bundled into the version of Impression you run in your browser. Each is the work of its own authors and is distributed under its own license.</p>
		</section>

		<section v-if="vm.licenses.length === 0">
			<p>No third-party licenses found.</p>
		</section>
		<div v-else class="licenses">
			<div v-for="entry in vm.licenses" :key="entryKey(entry)" class="card-hrule">
				<h2 class="card-title">
					{{ entry.name }}
					<span class="meta">version {{ entry.version }}</span>
				</h2>
				<p v-if="entry.description && entry.description !== entry.name" class="license-info">{{ entry.description }}</p>
				<p v-if="entryHref(entry)" class="license-info">
					Website: <a :href="entryHref(entry)!" rel="external">{{ entryHref(entry) }}</a>
				</p>
				<ul v-if="entry.copyrights.length > 0" class="copyrights">
					<li v-for="line in entry.copyrights" :key="line">{{ line }}</li>
				</ul>
				<p class="license-info">License: {{ entry.license ?? "License unknown" }}</p>
				<details v-if="entry.licenseText" class="license-details" @toggle="vm.toggleExpanded(entryKey(entry))">
					<summary>{{ vm.isExpanded(entryKey(entry)) ? "Hide" : "Show" }} license text</summary>
					<pre>{{ entry.licenseText }}</pre>
				</details>
				<details v-if="entry.noticeText" class="license-details">
					<summary>Show notice</summary>
					<pre>{{ entry.noticeText }}</pre>
				</details>
			</div>
		</div>

		<nav class="back-nav">
			<router-link to="/">&larr; Back to home</router-link>
		</nav>
	</main>
</template>

<style scoped>
main {
	margin: var(--space-12) auto;
	max-width: 36rem;
	padding: 0 var(--space-6);
}

.back-nav {
	margin-bottom: var(--space-8);
}

.back-nav a {
	font-size: var(--text-sm);
	color: var(--color-gray-600);
}

.has-hover .back-nav a:hover,
.back-nav a:active {
	color: var(--color-black);
}

h1 {
	margin: 0 0 var(--space-8);
}

.intro {
	margin-bottom: var(--space-8);
}

.intro p {
	color: var(--color-gray-800);
	line-height: var(--leading-relaxed);
	margin: 0 0 var(--space-3);
	max-width: 600px;
}

.licenses {
	margin-bottom: var(--space-8);
}

.meta {
	font-family: var(--font-body);
	font-size: var(--text-sm);
	font-weight: 400;
	color: var(--color-gray-400);
	font-variant-numeric: tabular-nums;
}

.copyrights,
.license-info {
	font-size: var(--text-sm);
	color: var(--color-gray-600);
	line-height: var(--leading-normal);
	margin: var(--space-2) 0 0;
}

.copyrights {
	list-style: none;
	padding: 0;
}

.copyrights li {
	margin: 0;
}

.license-details {
	margin-top: var(--space-3);
	font-size: var(--text-sm);
}

.license-details summary {
	cursor: pointer;
	color: var(--color-green-600);
}

.has-hover .license-details summary:hover,
.license-details summary:active {
	color: var(--color-green-700);
}

.license-details pre {
	margin: var(--space-3) 0 0;
	padding: var(--space-4) var(--space-5);
	background: var(--color-gray-50);
	border: var(--border-thin);
	overflow-x: auto;
	white-space: pre-wrap;
	word-break: break-word;
	font-family: var(--font-body);
	font-size: var(--text-sm);
	line-height: var(--leading-relaxed);
	color: var(--color-gray-800);
}
</style>
