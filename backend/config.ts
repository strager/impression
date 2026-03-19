// When adding or changing environment variables, update .env.example to match.

import crypto from "node:crypto";

export interface AppConfig {
	xaiApiKey: string;
	anthropicApiKey: string;
	debugPrompt: boolean;
}

export interface RateLimitConfig {
	rateLimitDbPath: string;
	powSecret: string;
	enableCleanup: boolean;
}

export function loadConfig(): AppConfig {
	const xaiApiKey = process.env.XAI_API_KEY;
	if (xaiApiKey === undefined || xaiApiKey === "") {
		throw new Error("XAI_API_KEY environment variable is required but not set.");
	}
	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
	if (anthropicApiKey === undefined || anthropicApiKey === "") {
		throw new Error("ANTHROPIC_API_KEY environment variable is required but not set.");
	}
	return { xaiApiKey, anthropicApiKey, debugPrompt: Boolean(process.env.DEBUG_PROMPT) };
}

export function loadRateLimitConfig(): RateLimitConfig {
	const rateLimitDbPath = process.env.RATE_LIMIT_DB_PATH ?? "./data/rate-limit.sqlite";

	let powSecret = process.env.POW_SECRET;
	if (powSecret === undefined || powSecret === "") {
		powSecret = crypto.randomBytes(32).toString("hex");
		console.warn("POW_SECRET is not set; using random startup secret. Unresolved challenges will be invalid on restart.");
	}

	const enableCleanup = Boolean(process.env.RATE_LIMIT_CLEANUP);

	return { rateLimitDbPath, powSecret, enableCleanup };
}
