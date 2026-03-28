<!-- Props-only profile component used both by ProfileView.vue (browser) and
     pdf-entry.ts (server-side rendering for PDF generation). Contains no
     router, localStorage, or analytics dependencies. -->

<script setup lang="ts">
import type { CardProfile } from "../shared/profile-types.ts";

defineProps<{
	cards: CardProfile[];
}>();
</script>

<template>
	<main>
		<header>
			<h1>Impression profile</h1>
			<h2>Your sources of meaning</h2>
			<p class="intro">Impression is a tool for mapping and examining your personal sources of meaning. Based on the Sources of Meaning Card Method (SoMeCaM) and its 26 identified sources of meaning across five dimensions — self-transcendence, self-actualization, order, well-being, and relatedness — the method helps you reflect on what matters most in your life.</p>
			<p class="citation">Based on: la Cour, P. &amp; Schnell, T. (2020). Presentation of the Sources of Meaning Card Method: The SoMeCaM. <cite>Journal of Humanistic Psychology, 60</cite>(1), 20–42. <a href="https://doi.org/10.1177/0022167816669620" target="_blank" rel="noopener">doi:10.1177/0022167816669620</a></p>
			<slot name="header-actions" />
		</header>

		<section class="summary-section">
			<h2>What is meaningful to me?</h2>
			<div v-for="card in cards" :key="card.card.id" class="profile-card">
				<h4 style="--chip-parent-cap: 1cap">{{ card.card.source }} <span class="chip chip-ai">AI-generated</span></h4>
				<template v-if="card.synthesis">
					<p v-for="(paragraph, i) in card.synthesis.split('\n\n')" :key="i" class="synthesis-paragraph">{{ paragraph }}</p>
				</template>
				<template v-else-if="card.synthesisError">
					<div class="alert alert-error">Could not load summary.</div>
					<slot name="card-synthesis-error" :card="card" />
				</template>
				<p v-else-if="card.synthesisLoading" class="summary-loading">Generating summary...</p>
				<p v-else class="qa-unanswered">No self reflections</p>
			</div>
		</section>

		<section class="detail-section">
			<h2>Self reflections</h2>
			<div v-for="card in cards" :key="card.card.id" class="profile-card">
				<h3>{{ card.card.source }}</h3>
				<div v-if="card.freeformNote" class="qa-block">
					<p class="qa-freeform-answer">{{ card.freeformNote }}</p>
				</div>
				<div class="qa-block">
					<h4 class="qa-topic">Expressions that feel right</h4>
					<ul v-if="card.selectedDescriptions.length > 0">
						<li v-for="s in card.selectedDescriptions" :key="s">{{ s }}</li>
					</ul>
					<ul v-else>
						<li>{{ card.card.description }}</li>
					</ul>
				</div>
				<div v-for="q in card.questions" :key="q.topic" class="qa-block">
					<h4 class="qa-topic">{{ q.question }}</h4>
					<p v-if="q.answer" class="qa-answer">{{ q.answer }}</p>
					<p v-else class="qa-unanswered">Not yet answered.</p>
				</div>
			</div>
		</section>
	</main>
</template>

<style scoped>
main {
	margin: 32px auto;
	max-width: 42rem;
	padding: 0 24px;
	color: #1a1a1a;
}

header {
	margin-bottom: 32px;
}

h1 {
	margin: 0 0 4px;
}

header h2 {
	font-size: 18px;
	font-weight: 400;
	font-style: italic;
	color: #555555;
	margin: 0 0 16px;
}

h1,
h2,
h3,
h4 {
	break-after: avoid;
}

.intro {
	font-size: 16px;
	line-height: 1.7;
	color: #333333;
	margin: 0 0 12px;
}

.citation {
	font-size: 13px;
	color: #737373;
	line-height: 1.5;
	margin: 0 0 16px;
}

section h2 {
	margin: 32px 0 16px;
}

.synthesis-paragraph {
	margin: 8px 0 0;
	font-size: 16px;
	line-height: 1.5;
	color: #333333;
}

.qa-block h4 {
	margin-top: 12px;
	padding-top: 12px;
}

h4 {
	font-size: 18px;
}

.qa-answer,
.qa-freeform-answer {
	margin: 4px 0 0;
	font-size: 16px;
	line-height: 1.5;
	white-space: pre-wrap;
}

.summary-loading {
	margin: 4px 0 0;
	font-size: 13px;
	font-style: italic;
	color: #737373;
}

.qa-unanswered {
	margin: 4px 0 0;
	font-size: 13px;
	font-style: italic;
	color: #737373;
}

.summary-section .profile-card {
	margin-top: 32px;
}
.detail-section .profile-card {
	margin-top: 64px;
}
.summary-section h2 + .profile-card,
.detail-section h2 + .profile-card {
	margin-top: 0;
}
</style>
