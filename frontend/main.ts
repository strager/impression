import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";

import App from "./App.vue";
import { initAnalytics } from "./analytics.ts";
import "./global.css";
import { onMatchMedia } from "./on-match-media.ts";
import ExamineMeaningView from "./ExamineMeaningView.vue";
import ExamineReflectView from "./ExamineReflectView.vue";
import ExamineView from "./ExamineView.vue";
import IdentifyView from "./IdentifyView.vue";
import PrioritizeView from "./PrioritizeView.vue";
import ReconsiderView from "./ReconsiderView.vue";
import HomeView from "./HomeView.vue";
import PrivacyView from "./PrivacyView.vue";
import ProfileView from "./ProfileView.vue";

const router = createRouter({
	history: createWebHistory(),
	scrollBehavior(_to, _from, savedPosition) {
		if (savedPosition !== null) {
			return savedPosition;
		}
		return { top: 0 };
	},
	routes: [
		{
			path: "/",
			name: "home",
			component: HomeView,
		},
		{
			path: "/:profileId/identify",
			name: "identify",
			component: IdentifyView,
		},
		{
			path: "/:profileId/prioritize",
			name: "prioritize",
			component: PrioritizeView,
		},
		{
			path: "/:profileId/reconsider",
			name: "reconsider",
			component: ReconsiderView,
		},
		{
			path: "/:profileId/examine",
			name: "examine",
			component: ExamineView,
		},
		{
			path: "/:profileId/profile",
			name: "profile",
			component: ProfileView,
		},
		{
			path: "/:profileId/examine/:meaningId",
			name: "examineMeaning",
			component: ExamineMeaningView,
		},
		{
			path: "/:profileId/examine/:meaningId/reflect",
			name: "examineReflect",
			component: ExamineReflectView,
		},
		{
			path: "/privacy",
			name: "privacy",
			component: PrivacyView,
		},
		{
			path: "/licenses",
			name: "licenses",
			component: () => import("./LicensesView.vue"),
		},
		{
			path: "/llm-test",
			name: "llmTest",
			component: () => import("./LlmTestView.vue"),
		},
		{
			path: "/style-guide",
			name: "styleGuide",
			component: () => import("./StyleGuideView.vue"),
		},
		{
			path: "/ranking-convergence",
			name: "rankingConvergence",
			component: () => import("./RankingConvergenceView.vue"),
		},
	],
});

onMatchMedia("(hover: hover)", (matches) => {
	document.documentElement.classList.toggle("has-hover", matches);
});

initAnalytics(router);
createApp(App).use(router).mount("#app");
