<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { RouteLocationRaw } from "vue-router";
import AppButton from "./AppButton.vue";
import { capture } from "./analytics.ts";
import { HomeViewModel } from "./HomeViewModel.ts";
import type { ProgressPhase, SessionMeta } from "./store.ts";
import { formatSessionDate } from "./store.ts";

const router = useRouter();
const vm = new HomeViewModel();
const renameInputEl = ref<HTMLInputElement[]>([]);

onMounted(() => {
	vm.initialize();
});

function phaseRoute(sessionId: string, p: ProgressPhase): RouteLocationRaw {
	switch (p) {
		case "explore":
			return { name: "explore", params: { sessionId } };
		case "prioritize-complete":
		case "prioritize":
			return { name: "findMeaningPrioritize", params: { sessionId } };
		case "swipe":
		case "none":
			return { name: "findMeaning", params: { sessionId } };
	}
}

function onNewSession(): void {
	const newId = vm.createSession();
	void router.push({ name: "findMeaning", params: { sessionId: newId } });
}

function onStartRename(session: SessionMeta): void {
	vm.startRename(session.id, session.name);
	void nextTick(() => {
		const el = renameInputEl.value[0];
		el.focus();
		el.select();
	});
}

function onConfirmRename(id: string): void {
	vm.confirmRename(id);
}

function onCancelRename(id: string): void {
	vm.cancelRename(id);
}

function onRenameKeydown(id: string, event: KeyboardEvent): void {
	if (event.key === "Enter") {
		onConfirmRename(id);
	} else if (event.key === "Escape") {
		onCancelRename(id);
	}
}

function onDelete(id: string): void {
	if (!window.confirm("Delete this session? This cannot be undone.")) return;
	vm.deleteSession(id);
}

function sessionRoute(session: SessionMeta): RouteLocationRaw {
	const phase = vm.phaseForSession(session.id);
	return phaseRoute(session.id, phase);
}

function onOpenSession(session: SessionMeta): void {
	const phase = vm.phaseForSession(session.id);
	capture("session_resumed", { session_id: session.id, phase });
}

function onExport(): void {
	vm.exportSessions();
}

function onLoadFile(): void {
	vm.importSessions().catch((err: unknown) => {
		window.alert(err instanceof Error ? err.message : "Failed to load progress file");
	});
}
</script>

<template>
	<main>
		<header>
			<h1>Impression</h1>
			<p class="subtitle">Explore your sources of meaning</p>
		</header>

		<section>
			<h2>Explore what makes life meaningful</h2>
			<p>Impression is a tool for mapping and exploring your personal sources of meaning. Based on the Sources of Meaning Card Method (SoMeCaM) and its 26 identified sources of meaning across five dimensions — self-transcendence, self-actualization, order, well-being, and relatedness — the method helps you reflect on what matters most in your life.</p>
		</section>

		<section>
			<h2>Your privacy</h2>
			<p>Your data is never stored on our servers. Your responses are saved locally in your browser so you can return to them later. <router-link to="/privacy">Learn more</router-link></p>
		</section>

		<section class="sessions">
			<div v-if="vm.sessions.length === 0" class="cta">
				<AppButton variant="primary" type="button" @click="onNewSession">Start finding meaning</AppButton>
			</div>
			<template v-else>
				<h2>Your sessions</h2>
				<div class="session-list">
					<div v-for="session in vm.sessions" :key="session.id" class="card-hrule">
						<div class="card-title">
							<template v-if="vm.isRenaming(session.id)">
								<input ref="renameInputEl" :value="vm.renameInputFor(session.id)" type="text" @input="vm.setRenameInput(session.id, ($event.target as HTMLInputElement).value)" @keydown="onRenameKeydown(session.id, $event)" />
								<AppButton variant="primary" type="button" @click="onConfirmRename(session.id)">Save</AppButton>
							</template>
							<router-link v-else :to="sessionRoute(session)" class="session-link" @click="onOpenSession(session)">{{ session.name }}</router-link>
						</div>
						<div class="card-meta">
							<!-- eslint-disable vue/no-restricted-html-elements -->
							Created {{ formatSessionDate(new Date(session.createdAt)) }}<template v-if="session.lastUpdatedAt !== session.createdAt"> · Updated {{ formatSessionDate(new Date(session.lastUpdatedAt)) }}</template> · <button type="button" class="text-btn" @click="onStartRename(session)">Rename</button> · <button type="button" class="text-btn text-btn-danger" @click="onDelete(session.id)">Delete</button>
							<!-- eslint-enable vue/no-restricted-html-elements -->
						</div>
					</div>
				</div>
				<div class="cta">
					<AppButton variant="secondary" type="button" @click="onNewSession">Start new session</AppButton>
				</div>
			</template>
		</section>

		<div class="file-actions">
			<!-- eslint-disable vue/no-restricted-html-elements -->
			<button v-if="vm.sessions.length > 0" type="button" class="file-btn" @click="onExport">Export all sessions</button>
			<button type="button" class="file-btn" @click="onLoadFile">Import sessions file</button>
			<!-- eslint-enable vue/no-restricted-html-elements -->
		</div>

		<footer>
			<p class="citation">
				Based on: la Cour, P. &amp; Schnell, T. (2020). Presentation of the Sources of Meaning Card Method: The SoMeCaM.
				<cite>Journal of Humanistic Psychology, 60</cite>(1), 20–42.
				<a href="https://doi.org/10.1177/0022167816669620" target="_blank" rel="noopener">doi:10.1177/0022167816669620</a>
			</p>
			<a class="github-link" href="https://github.com/strager/impression" target="_blank" rel="noopener" aria-label="View source on GitHub">
				<!-- GitHub mark icon from Primer Octicons (mark-github-24)
					 https://github.com/primer/octicons/blob/main/icons/mark-github-24.svg -->
				<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.303 16.652c-2.837-.344-4.835-2.385-4.835-5.028 0-1.074.387-2.235 1.031-3.008-.279-.709-.236-2.214.086-2.837.86-.107 2.02.344 2.708.967.816-.258 1.676-.386 2.728-.386 1.053 0 1.913.128 2.686.365.666-.602 1.848-1.053 2.708-.946.3.581.344 2.085.064 2.815.688.817 1.053 1.913 1.053 3.03 0 2.643-1.998 4.641-4.877 5.006.73.473 1.224 1.504 1.224 2.686v2.235c0 .644.537 1.01 1.182.752 3.889-1.483 6.94-5.372 6.94-10.185 0-6.081-4.942-11.044-11.022-11.044-6.081 0-10.98 4.963-10.98 11.044a10.84 10.84 0 0 0 7.112 10.206c.58.215 1.139-.172 1.139-.752v-1.719a2.768 2.768 0 0 1-1.032.215c-1.418 0-2.256-.773-2.857-2.213-.237-.58-.495-.924-.989-.988-.258-.022-.344-.129-.344-.258 0-.258.43-.451.86-.451.623 0 1.16.386 1.719 1.181.43.623.881.903 1.418.903.537 0 .881-.194 1.375-.688.365-.365.645-.687.903-.902Z" fill="currentColor" /></svg>
			</a>
		</footer>
	</main>
</template>

<style scoped>
main {
	margin: var(--space-12) auto;
	max-width: 36rem;
	padding: 0 var(--space-6);
}

header {
	margin-bottom: var(--space-10);
}

h1 {
	margin: 0 0 var(--space-1);
	letter-spacing: 0.02em;
}

.subtitle {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-style: italic;
	font-weight: 400;
	color: var(--color-gray-600);
	margin: 0;
}

h2 {
	font-size: var(--text-2xl);
	font-weight: 600;
	margin: 0 0 var(--space-2);
}

section {
	margin-bottom: var(--space-8);
}

section p {
	line-height: var(--leading-relaxed);
	margin: 0;
}

.sessions {
	margin-bottom: var(--space-4);
}

.session-link {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	/* Match the input's bottom border so .card-title height stays
	   the same when switching between link and rename input. */
	border-bottom: 1px solid transparent;
}

.card-title {
	display: flex;
	gap: var(--space-2);
	align-items: center;
}

/* Negative vertical margins on the input and save button prevent their
   padding from increasing .card-title's height, avoiding a layout shift
   when switching between the static session name and the rename form. */
.card-title input,
.card-title :deep(button) {
	margin-top: calc(-1 * var(--space-2));
	margin-bottom: calc(-1 * var(--space-2));
}

.card-title input {
	font-family: var(--font-heading);
	font-size: var(--text-xl);
	font-weight: 600;
	line-height: inherit;
	flex: 1;
	min-width: 0;
	/* Compensate for left padding so text aligns with the session name link. */
	margin-left: calc(-1 * var(--space-3));
}

.text-btn {
	background: none;
	font-size: inherit;
	color: inherit;
	text-decoration: underline;
	text-underline-offset: 2px;
	text-decoration-thickness: 1px;
}

.text-btn:hover {
	color: var(--color-gray-600);
}

.text-btn-danger:hover {
	color: var(--color-error);
}

.cta {
	margin: var(--space-10) 0;
}

.file-actions {
	display: flex;
	gap: var(--space-4);
}

.file-btn {
	background: none;
	color: var(--color-gray-400);
	font-size: var(--text-sm);
	text-decoration: underline;
	text-underline-offset: 3px;
	text-decoration-thickness: 1px;
}

.file-btn:hover {
	color: var(--color-gray-600);
}

footer {
	margin-top: var(--space-12);
	padding-top: var(--space-6);
	border-top: var(--border-thin);
}

.citation {
	font-size: var(--text-sm);
	color: var(--color-gray-600);
	line-height: var(--leading-normal);
	margin: 0;
}

.github-link {
	display: inline-block;
	margin-top: var(--space-4);
	color: var(--color-gray-400);
	text-decoration: none;
}

.github-link:hover {
	color: var(--color-black);
}
</style>
