<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { getSessionName } from "./store.ts";

const route = useRoute();

const showNav = computed(() => route.name !== "home");

const sessionId = computed(() => {
	const param = route.params.sessionId;
	return typeof param === "string" ? param : null;
});

const sessionName = computed(() => {
	if (sessionId.value === null) return null;
	return getSessionName(sessionId.value);
});

const phaseLabel = computed(() => {
	switch (route.name) {
		case "findMeaning":
			return "Find meaning";
		case "findMeaningPrioritize":
			return "Prioritize";
		case "findMeaningManual":
			return null; // handled as Explore sub-page
		case "explore":
			return "Explore";
		case "exploreMeaning":
			return null; // handled separately with Explore link + card name
		case "report":
			return "Report";
		case "llmTest":
			return "LLM test";
		case "styleGuide":
			return "Style guide";
		default:
			return null;
	}
});

const meaningCardName = computed(() => {
	if (route.name === "findMeaningManual") return "Edit selection";
	if (route.name !== "exploreMeaning") return null;
	const meaningId = route.params.meaningId;
	if (typeof meaningId !== "string") return null;
	const card = MEANING_CARDS.find((c) => c.id === meaningId);
	return card?.source ?? meaningId;
});

const exploreRoute = computed(() => {
	if (sessionId.value === null) return null;
	return { name: "explore", params: { sessionId: sessionId.value } };
});
</script>

<template>
	<nav v-if="showNav" class="nav-bar">
		<div class="nav-content">
			<RouterLink to="/" class="nav-home">Impression</RouterLink>
			<template v-if="phaseLabel !== null">
				<span class="nav-separator">/</span>
				<span class="nav-phase">{{ phaseLabel }}</span>
			</template>
			<template v-if="meaningCardName !== null">
				<span class="nav-separator">/</span>
				<RouterLink v-if="exploreRoute" :to="exploreRoute" class="nav-link">Explore</RouterLink>
				<span class="nav-separator">/</span>
				<span class="nav-phase">{{ meaningCardName }}</span>
			</template>
			<span v-if="sessionName !== null" class="nav-session">{{ sessionName }}</span>
		</div>
	</nav>
</template>

<style scoped>
.nav-bar {
	border-bottom: 1px solid #e5e7eb;
	padding: 0.5rem 1rem;
}

.nav-content {
	max-width: 42rem;
	margin: 0 auto;
	display: flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 0.9rem;
	overflow: hidden;
}

.nav-home,
.nav-link {
	white-space: nowrap;
	flex-shrink: 0;
}

.nav-separator {
	color: #9ca3af;
	flex-shrink: 0;
}

.nav-phase {
	color: #6b7280;
	white-space: nowrap;
	flex-shrink: 0;
}

.nav-session {
	color: #6b7280;
	margin-left: auto;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

@media print {
	.nav-bar {
		display: none;
	}
}
</style>
