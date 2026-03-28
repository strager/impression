<script setup lang="ts"></script>

<template>
	<main>
		<nav class="back-nav">
			<router-link to="/">&larr; Back to home</router-link>
		</nav>

		<h1>Privacy</h1>

		<section>
			<h2>Your data stays in your browser</h2>
			<p>Your choices, answers, and profile data are saved in your browser's local storage. There are no accounts or logins; your data belongs to you. They are never stored permanently on my servers.</p>
		</section>

		<section>
			<h2>Third-party services</h2>
			<p>Impression uses third-party services to provide its features. Here is what each service receives and why.</p>

			<h3>Vultr</h3>
			<p><a href="https://www.vultr.com/" rel="external">Vultr</a> provides the server infrastructure that hosts Impression.</p>

			<h3>Grok</h3>
			<p><a href="https://x.ai/" rel="external">Grok by xAI</a> powers the AI-assisted features such as summarization during the examination phase. When you use these features, the prompts and your selected sources of meaning are sent to Grok to generate responses. No other personal data is shared.</p>
			<p><b>Storage:</b> Grok stores your data temporarily. "API requests and responses are temporarily stored on our servers for 30 days in case they need to be audited for potential abuse or misuse. This data is automatically deleted after 30 days."</p>
			<p><b>Training:</b> Grok does not train its AI models on your data.</p>

			<h3>Claude</h3>
			<p><a href="https://claude.ai/" rel="external">Claude by Anthropic</a> powers the AI-assisted features such as summarization during the examination phase. When you use these features, the prompts and your selected sources of meaning are sent to Claude to generate responses. No other personal data is shared.</p>
			<p><b>Storage:</b> Anthropic stores your data temporarily. "[Anthropic] automatically [deletes] inputs and outputs on [their] backend within 30 days of receipt or generation."</p>
			<p><b>Training:</b> Anthropic does not train its AI models on your data. "Retained data is never used for model training [by Anthropic]"</p>

			<h3>DocRaptor</h3>
			<p><a href="https://docraptor.com/" rel="external">DocRaptor</a> converts your profile into a downloadable PDF. When you download a PDF, the rendered profile HTML is sent to DocRaptor's API for conversion. This includes the source of meaning names and any answers you wrote during examination.</p>
			<p><b>Storage:</b> DocRaptor does not store your data. I use the "As short as possible" Data Retention Time. "[DocRaptor] will delete your input immediately after it is used. [DocRaptor] will delete your finished document as soon as you download it."</p>

			<h3>PostHog</h3>
			<p><a href="https://posthog.com/" rel="external">PostHog</a> provides product analytics so I can understand how people use Impression and improve the experience. I collect and store:</p>
			<ul>
				<li>Page view events with route names</li>
				<li>Aggregate counts (e.g. how many sources of meaning were agreed/disagreed, kept/removed)</li>
				<li>Interaction timing (e.g. time spent on a source of meaning, answer length)</li>
				<li>Phase completion events</li>
			</ul>
			<p><b>Storage:</b> This data is stored in PostHog for at least 7 days. PostHog does <em>not</em> receive or store which specific sources of meaning you choose, the text of your answers, or any personally identifiable information.</p>
		</section>

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

.back-nav a:hover {
	color: var(--color-black);
}

h1 {
	margin: 0 0 var(--space-8);
}

h2 {
	font-size: var(--text-2xl);
	font-weight: 600;
	margin: 0 0 var(--space-2);
}

h3 {
	font-size: var(--text-lg);
	font-weight: 600;
	margin: var(--space-6) 0 var(--space-1);
}

section {
	margin-bottom: var(--space-8);
}

section p {
	line-height: var(--leading-relaxed);
	margin: 0 0 var(--space-3);
}
</style>
