import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { createApiMiddleware } from "./api.ts";
import type { AppConfig, RateLimitConfig } from "./config.ts";
import { loadConfig, loadRateLimitConfig } from "./config.ts";
import { createAnalyticsHandler } from "./posthog-proxy.ts";
import { RateLimiter } from "./rate-limit.ts";

function internalErrorBody(): string {
	return JSON.stringify({
		type: "about:blank",
		title: "Internal Server Error",
		status: 500,
		detail: "Unexpected server error.",
	});
}

export async function createApp(overrides?: { rateLimitConfig?: RateLimitConfig }): Promise<Express> {
	const app = express();

	let config: AppConfig | undefined;
	try {
		config = loadConfig();
	} catch {
		console.warn("XAI_API_KEY or ANTHROPIC_API_KEY is not set; AI features will be disabled.");
	}

	const rateLimitConfig = overrides?.rateLimitConfig ?? loadRateLimitConfig();
	const rateLimiter = new RateLimiter(rateLimitConfig);

	app.use("/api/a", createAnalyticsHandler());
	app.use(express.json());
	app.use(express.text());
	app.use(express.urlencoded({ extended: true }));
	app.use("/api", await createApiMiddleware(config, rateLimiter));

	app.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
		console.error("Unhandled application error:", error);
		res.status(500);
		res.type("application/problem+json");
		res.send(internalErrorBody());
	});

	return app;
}
