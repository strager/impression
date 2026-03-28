<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { RouteLocationRaw } from "vue-router";
import AppButton from "./AppButton.vue";
import { capture } from "./analytics.ts";
import { HomeViewModel } from "./HomeViewModel.ts";
import type { ProgressPhase, ProfileMeta } from "./store.ts";
import { formatProfileDate } from "./store.ts";

const router = useRouter();
const vm = new HomeViewModel();
const renameInputEl = ref<HTMLInputElement[]>([]);

onMounted(() => {
	vm.initialize();
});

function phaseRoute(profileId: string, p: ProgressPhase): RouteLocationRaw {
	switch (p) {
		case "examine":
			return { name: "examine", params: { profileId } };
		case "prioritize-complete":
		case "prioritize":
			return { name: "prioritize", params: { profileId } };
		case "identify":
		case "none":
			return { name: "identify", params: { profileId } };
	}
}

function onNewProfile(): void {
	const newId = vm.createProfile();
	void router.push({ name: "identify", params: { profileId: newId } });
}

function onStartRename(profile: ProfileMeta): void {
	vm.startRename(profile.id, profile.name);
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
	if (!window.confirm("Delete this profile? This cannot be undone.")) return;
	vm.deleteProfile(id);
}

function profileRoute(profile: ProfileMeta): RouteLocationRaw {
	const phase = vm.phaseForProfile(profile.id);
	return phaseRoute(profile.id, phase);
}

function onOpenProfile(profile: ProfileMeta): void {
	const phase = vm.phaseForProfile(profile.id);
	capture("session_resumed", { session_id: profile.id, phase });
}

function onExport(): void {
	vm.exportProfiles();
}

function onLoadFile(): void {
	vm.importProfiles().catch((err: unknown) => {
		window.alert(err instanceof Error ? err.message : "Failed to load progress file");
	});
}
</script>

<template>
	<main>
		<header>
			<h1>Impression</h1>
			<p class="subtitle">A structured path to answering life's biggest question: <br style="user-select: none" />&ldquo;what gives my life meaning?&rdquo;</p>
		</header>

		<section>
			<p>Uncover what makes life meaningful, step by step:</p>
			<ol class="checkmark-list">
				<li><strong>Identify</strong> which sources of meaning feel right to you.</li>
				<li><strong>Examine</strong> how meaning shows up in your life.</li>
				<li><strong>Refine</strong> your thinking with personalized reflections.</li>
			</ol>
			<p>The result: a clear, written account of what's meaningful to you.</p>
			<p>Impression is opinionated and deliberate. It's not for everyone. But if you're willing to sit with the question, Impression will help you answer it.</p>
		</section>

		<section class="profiles">
			<div v-if="vm.profiles.length === 0" class="cta">
				<AppButton variant="primary" type="button" @click="onNewProfile">Start my meaning profile</AppButton>
			</div>
			<template v-else>
				<h2>Your profiles</h2>
				<div class="profile-list">
					<div v-for="profile in vm.profiles" :key="profile.id" class="card-hrule">
						<div class="card-title">
							<template v-if="vm.isRenaming(profile.id)">
								<input ref="renameInputEl" :value="vm.renameInputFor(profile.id)" type="text" @input="vm.setRenameInput(profile.id, ($event.target as HTMLInputElement).value)" @keydown="onRenameKeydown(profile.id, $event)" />
								<AppButton variant="primary" type="button" @click="onConfirmRename(profile.id)">Save</AppButton>
							</template>
							<router-link v-else :to="profileRoute(profile)" class="profile-link" @click="onOpenProfile(profile)">{{ profile.name }}</router-link>
						</div>
						<div class="card-meta">
							<!-- eslint-disable vue/no-restricted-html-elements -->
							Created {{ formatProfileDate(new Date(profile.createdAt)) }}<template v-if="profile.lastUpdatedAt !== profile.createdAt"> · Updated {{ formatProfileDate(new Date(profile.lastUpdatedAt)) }}</template> · <button type="button" class="text-btn" @click="onStartRename(profile)">Rename</button> · <button type="button" class="text-btn text-btn-danger" @click="onDelete(profile.id)">Delete</button>
							<!-- eslint-enable vue/no-restricted-html-elements -->
						</div>
					</div>
				</div>
				<div class="cta">
					<AppButton variant="secondary" type="button" @click="onNewProfile">Start new profile</AppButton>
				</div>
			</template>

			<div class="file-actions">
				<!-- eslint-disable vue/no-restricted-html-elements -->
				<button v-if="vm.profiles.length > 0" type="button" class="file-btn" @click="onExport">Export all profiles</button>
				<button type="button" class="file-btn" @click="onLoadFile">Import profiles file</button>
				<!-- eslint-enable vue/no-restricted-html-elements -->
			</div>
		</section>

		<section>
			<h2>Why Impression?</h2>
			<p>Most people go their entire lives without being able to answer the question &ldquo;What gives my life meaning?&rdquo;. Not because they don't care, but because the question is too big to know where to start. Answering this question shouldn't require a therapist, a crisis, or a lucky moment of clarity; it should be something anyone can sit down and work through.</p>
			<p>Impression is built on the belief that structure is the answer to overwhelm; the right process, followed patiently, can make even the most complex and existential question answerable.</p>
		</section>

		<section>
			<h2>The research behind Impression</h2>
			<p>Impression is built on the Sources of Meaning Card Method (SoMeCaM), developed by psychologists Tatjana Schnell and Peter la Cour. The method draws on Schnell's research into the structure of meaning in life, which identified 26 distinct sources of meaning, from self-knowledge and creativity to community and care. These aren't arbitrary categories; they come from a 151-item questionnaire validated across thousands of participants across several studies.</p>
			<p>SoMeCaM was originally designed as a therapeutic tool; it's a structured conversation between a client and a facilitator, using physical cards to guide reflection. The facilitator helps the client sort the cards, examine their top sources, and articulate what matters most. Impression adapts this process into a guided, self-directed experience, with an AI taking the role of the patient facilitator who reads back what you've said and helps you refine your thinking.</p>
			<p>The method is peer-reviewed and has been tested in clinical settings. It works, but it's not widely known. I believe this research deserves a wider audience. Anyone willing to sit with the question should have access to the structure that makes it answerable.</p>
		</section>

		<section>
			<h2>Who built Impression?</h2>

			<p>I'm <a href="https://strager.net/" rel="external">strager</a>, a programmer. I built Impression to help me figure out what comes next in my life. I was (and am) dealing with depression and wanted a structured way to truly understand what actually matters to me. I found the research behind SoMeCaM and immediately got to work.</p>
			<p>I hope this app can help someone else figure out what matters most to them. In fact, that would be quite meaningful to me. =]</p>
		</section>

		<section>
			<h2>Your privacy</h2>
			<p>Your data is never stored on my servers. Your profile is saved locally in your browser so you can return to it later. <router-link to="/privacy">Learn more</router-link></p>
		</section>

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
	line-height: var(--leading-normal);
	color: var(--color-gray-600);
	margin: 0;
}

h2 {
	font-size: var(--text-2xl);
	font-weight: 600;
	margin: 0 0 var(--space-2);
}

section {
	margin-bottom: var(--space-10);
}

section p {
	margin-bottom: var(--space-4);
}

.profile-link {
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
   when switching between the static profile name and the rename form. */
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
	/* Compensate for left padding so text aligns with the profile name link. */
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
	margin: var(--space-10) 0 var(--space-2) 0;
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
