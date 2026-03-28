import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";

import App from "./App.vue";
import { initAnalytics } from "./analytics.ts";
import "./global.css";
import ExamineCompleteView from "./ExamineCompleteView.vue";
import ExamineMeaningView from "./ExamineMeaningView.vue";
import ExamineView from "./ExamineView.vue";
import IdentifyManualView from "./IdentifyManualView.vue";
import IdentifyRankingView from "./IdentifyRankingView.vue";
import IdentifyView from "./IdentifyView.vue";
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
			path: "/:profileId/identify/prioritize",
			name: "identifyPrioritize",
			component: IdentifyRankingView,
		},
		{
			path: "/:profileId/examine",
			name: "examine",
			component: ExamineView,
		},
		{
			path: "/:profileId/identify/manual",
			name: "identifyManual",
			component: IdentifyManualView,
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
			path: "/:profileId/examine/:meaningId/complete",
			name: "examineComplete",
			component: ExamineCompleteView,
		},
		{
			path: "/privacy",
			name: "privacy",
			component: PrivacyView,
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

initAnalytics(router);
createApp(App).use(router).mount("#app");
