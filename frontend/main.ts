import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";

import App from "./App.vue";
import { initAnalytics } from "./analytics.ts";
import "./global.css";
import ExploreCompleteView from "./ExploreCompleteView.vue";
import ExploreMeaningView from "./ExploreMeaningView.vue";
import ExploreView from "./ExploreView.vue";
import FindMeaningManualView from "./FindMeaningManualView.vue";
import FindMeaningRankingView from "./FindMeaningRankingView.vue";
import FindMeaningView from "./FindMeaningView.vue";
import HomeView from "./HomeView.vue";
import PrivacyView from "./PrivacyView.vue";
import ReportView from "./ReportView.vue";

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
			path: "/:profileId/find-meaning",
			name: "findMeaning",
			component: FindMeaningView,
		},
		{
			path: "/:profileId/find-meaning/prioritize",
			name: "findMeaningPrioritize",
			component: FindMeaningRankingView,
		},
		{
			path: "/:profileId/explore",
			name: "explore",
			component: ExploreView,
		},
		{
			path: "/:profileId/find-meaning/manual",
			name: "findMeaningManual",
			component: FindMeaningManualView,
		},
		{
			path: "/:profileId/report",
			name: "report",
			component: ReportView,
		},
		{
			path: "/:profileId/explore/:meaningId",
			name: "exploreMeaning",
			component: ExploreMeaningView,
		},
		{
			path: "/:profileId/explore/:meaningId/complete",
			name: "exploreComplete",
			component: ExploreCompleteView,
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
