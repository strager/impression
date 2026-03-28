import type { Router } from "vue-router";
import { PostHog } from "posthog-js-lite";
import { ANALYTICS_PROXY_TOKEN } from "../shared/analytics-config.ts";

const posthog = new PostHog(ANALYTICS_PROXY_TOKEN, {
	host: "/api/a",
});

let initialized = false;

export function initAnalytics(router: Router): void {
	if (import.meta.env.MODE === "test" || initialized) {
		return;
	}

	Object.assign(window, { posthog });

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			capture("$pageleave");
		}
	});

	router.afterEach((to) => {
		const routeTemplate = to.matched.at(-1)?.path ?? to.path;
		const profileParam = to.params.profileId;
		const sessionId = typeof profileParam === "string" ? profileParam : undefined;

		const routeName = typeof to.name === "string" ? to.name : undefined;
		capture("$pageview", {
			$current_url: window.location.href,
			route_template: routeTemplate,
			...(routeName !== undefined ? { route_name: routeName } : {}),
			...(sessionId !== undefined ? { session_id: sessionId } : {}),
		});
	});

	initialized = true;
}

export function capture(event: string, properties?: Record<string, string | number | boolean>): void {
	if (import.meta.env.MODE === "test") {
		return;
	}
	posthog.capture(event, properties);
}
