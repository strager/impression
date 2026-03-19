// Our createApp() creates an Express app, not a Vue app. Suppress false
// positive from eslint-plugin-vue mistaking it for Vue's createApp().
/* eslint-disable vue/one-component-per-file */
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { solveChallenge } from "altcha-lib";
import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.ts";
import { MAX_PDF_DOWNLOADS_PER_DAY, rateLimitTunables } from "./rate-limit.ts";

// Use trivial PoW difficulty in tests so challenges solve instantly.
rateLimitTunables.powMaxNumber = 100;

// Set a fixed origin for origin-check validation (read at createApp() time).
const TEST_ORIGIN = "http://test.local";
process.env.ORIGIN = TEST_ORIGIN;

const mswServer = setupServer(http.all(/^http:\/\/127\.0\.0\.1/, () => passthrough()));

beforeAll(() => {
	mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
	mswServer.resetHandlers();
});

afterAll(() => {
	mswServer.close();
});

interface ChallengeResponse {
	code: string;
	challenge: {
		challengeId: string;
		expiresAt: number;
		altcha: {
			algorithm: string;
			challenge: string;
			maxnumber: number;
			salt: string;
			signature: string;
		};
	};
}

function isChallengeResponse(body: unknown): body is ChallengeResponse {
	return typeof body === "object" && body !== null && "code" in body && body.code === "challenge_required" && "challenge" in body && typeof body.challenge === "object" && body.challenge !== null;
}

function expectChallengeResponse(body: unknown): ChallengeResponse {
	if (!isChallengeResponse(body)) {
		throw new Error("Expected challenge_required response");
	}
	return body;
}

async function buildChallengePayload(challengeBody: ChallengeResponse): Promise<{ challengeId: string; payload: string }> {
	const { challengeId, altcha } = challengeBody.challenge;
	const result = solveChallenge(altcha.challenge, altcha.salt, altcha.algorithm, altcha.maxnumber);
	const solution = await result.promise;
	if (solution === null) throw new Error("Failed to solve challenge");

	const payload = btoa(
		JSON.stringify({
			algorithm: altcha.algorithm,
			challenge: altcha.challenge,
			number: solution.number,
			salt: altcha.salt,
			signature: altcha.signature,
		}),
	);

	return { challengeId, payload };
}

async function solveAndVerify(baseUrl: string, challengeBody: ChallengeResponse, existingToken?: string): Promise<string> {
	const { challengeId, payload } = await buildChallengePayload(challengeBody);

	const headers: Record<string, string> = { "Content-Type": "application/json", Origin: TEST_ORIGIN };
	if (existingToken !== undefined) {
		headers.Authorization = `Bearer ${existingToken}`;
	}

	const response = await fetch(`${baseUrl}/api/session/verify`, {
		method: "POST",
		headers,
		body: JSON.stringify({ challengeId, payload }),
	});

	expect(response.status).toBe(200);
	const body: unknown = await response.json();
	expect(body).toHaveProperty("sessionToken");
	if (typeof body !== "object" || body === null || !("sessionToken" in body) || typeof body.sessionToken !== "string") {
		throw new Error("Expected sessionToken in response");
	}
	expect(body.sessionToken).toMatch(/^[a-z]{32}$/);
	return body.sessionToken;
}

async function obtainSessionToken(baseUrl: string): Promise<string> {
	// Hit a budgeted endpoint to trigger a challenge
	const challengeResponse = await fetch(`${baseUrl}/api/summarize`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
		body: JSON.stringify({
			cardId: "self-knowledge",
			questionId: "interpretation",
			answer: "test",
		}),
	});
	expect(challengeResponse.status).toBe(429);
	const challengeBody: unknown = await challengeResponse.json();
	if (!isChallengeResponse(challengeBody)) {
		throw new Error("Expected challenge_required response");
	}
	return solveAndVerify(baseUrl, challengeBody);
}

describe("API", () => {
	let server: Server | undefined;
	let baseUrl = "";

	beforeAll(async () => {
		const dbPath = path.join(os.tmpdir(), `rate-limit-test-${crypto.randomUUID()}.sqlite`);
		const app = await createApp({ rateLimitConfig: { rateLimitDbPath: dbPath, powSecret: crypto.randomUUID(), enableCleanup: false } });
		app.locals.vite = {
			ssrLoadModule: (): Promise<unknown> =>
				Promise.resolve({
					renderPdfHtml: (): Promise<string> => Promise.resolve("<html><body>Report</body></html>"),
				}),
			moduleGraph: {
				getModuleByUrl: (): Promise<undefined> => Promise.resolve(undefined),
			},
			transformRequest: (): Promise<null> => Promise.resolve(null),
		};

		await new Promise<void>((resolve, reject) => {
			const candidate = app.listen(0, "127.0.0.1", () => {
				server = candidate;
				resolve();
			});
			candidate.on("error", reject);
		});

		if (server === undefined) {
			throw new Error("Server failed to start.");
		}

		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected server to listen on a TCP port.");
		}

		baseUrl = `http://127.0.0.1:${address.port.toString()}`;
	});

	afterAll(async () => {
		if (server === undefined) {
			return;
		}
		const runningServer = server;

		await new Promise<void>((resolve, reject) => {
			runningServer.close((error) => {
				if (error !== undefined) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	});

	it("returns API health", async () => {
		const response = await fetch(`${baseUrl}/api/health`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("returns 200 for analytics proxy when POSTHOG_KEY is not set", async () => {
		const response = await fetch(`${baseUrl}/api/a/capture`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ event: "test_event" }),
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	it("returns 400 for POST /api/summarize with missing fields", async () => {
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ cardId: "self-knowledge" }),
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("type", "about:blank");
		expect(body).toHaveProperty("title", expect.any(String));
		expect(body).toHaveProperty("status", 400);
		expect(body).toHaveProperty("detail", expect.any(String));
	});

	it("returns 500 for POST /api/summarize when config is not set", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "Family gives me a sense of belonging.",
			}),
		});
		expect(response.status).toBe(500);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toEqual(
			expect.objectContaining({
				type: "about:blank",
				title: "Internal Server Error",
				status: 500,
				detail: "AI summarization is not configured.",
			}),
		);
	});

	it("returns 500 for POST /api/summarize without questionId when config is not set", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				answer: "These are my personal reflections on self-knowledge.",
			}),
		});
		expect(response.status).toBe(500);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toEqual(
			expect.objectContaining({
				type: "about:blank",
				title: "Internal Server Error",
				status: 500,
				detail: "AI summarization is not configured.",
			}),
		);
	});

	it("returns 400 for POST /api/infer-answers with missing fields", async () => {
		const response = await fetch(`${baseUrl}/api/infer-answers`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ cardId: "self-knowledge" }),
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("type", "about:blank");
		expect(body).toHaveProperty("title", expect.any(String));
		expect(body).toHaveProperty("status", 400);
		expect(body).toHaveProperty("detail", expect.any(String));
	});

	it("returns 500 for POST /api/infer-answers when config is not set", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/infer-answers`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questions: [
					{ questionId: "interpretation", answer: "I want to understand my motivations." },
					{ questionId: "significance", answer: "" },
					{ questionId: "importance", answer: "" },
				],
			}),
		});
		expect(response.status).toBe(500);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toEqual(
			expect.objectContaining({
				type: "about:blank",
				title: "Internal Server Error",
				status: 500,
				detail: "AI inference is not configured.",
			}),
		);
	});

	it("returns 400 for POST /api/synthesize with missing fields", async () => {
		const response = await fetch(`${baseUrl}/api/synthesize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ cardId: "self-knowledge" }),
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("type", "about:blank");
		expect(body).toHaveProperty("title", expect.any(String));
		expect(body).toHaveProperty("status", 400);
		expect(body).toHaveProperty("detail", expect.any(String));
	});

	it("returns 500 for POST /api/synthesize when config is not set", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/synthesize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questions: [
					{ questionId: "interpretation", answer: "I want to understand my motivations." },
					{ questionId: "significance", answer: "It helps me make better decisions." },
				],
			}),
		});
		expect(response.status).toBe(500);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toEqual(
			expect.objectContaining({
				type: "about:blank",
				title: "Internal Server Error",
				status: 500,
				detail: "AI synthesis is not configured.",
			}),
		);
	});

	it("returns 400 for POST /api/reflect-on-answer with missing fields", async () => {
		const response = await fetch(`${baseUrl}/api/reflect-on-answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ cardId: "self-knowledge" }),
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("type", "about:blank");
		expect(body).toHaveProperty("title", expect.any(String));
		expect(body).toHaveProperty("status", 400);
		expect(body).toHaveProperty("detail", expect.any(String));
	});

	it("returns 500 for POST /api/reflect-on-answer when config is not set", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/reflect-on-answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "It means a lot to me.",
			}),
		});
		expect(response.status).toBe(500);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toEqual(
			expect.objectContaining({
				type: "about:blank",
				title: "Internal Server Error",
				status: 500,
				detail: "AI reflection is not configured.",
			}),
		);
	});

	it("returns 500 for POST /api/report-pdf when DOCRAPTOR_API_KEY is not set", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: "some session data",
		});
		expect(response.status).toBe(500);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toEqual(
			expect.objectContaining({
				type: "about:blank",
				title: "Internal Server Error",
				status: 500,
				detail: "PDF generation is not configured.",
			}),
		);
	});

	it("returns 400 for POST /api/report-html with empty body", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/report-html`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: "",
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");
	});

	it("returns 400 for POST /api/report-html with invalid session data", async () => {
		const token = await obtainSessionToken(baseUrl);
		const response = await fetch(`${baseUrl}/api/report-html`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: "not valid json",
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");
		const body: unknown = await response.json();
		expect(body).toHaveProperty("detail", "Invalid session data.");
		expect(JSON.stringify(body)).not.toContain("Unexpected");
	});

	it("returns 400 for POST /api/report-pdf with empty body", async () => {
		const token = await obtainSessionToken(baseUrl);
		const savedKey = process.env.DOCRAPTOR_API_KEY;
		process.env.DOCRAPTOR_API_KEY = "test-key";
		try {
			const response = await fetch(`${baseUrl}/api/report-pdf`, {
				method: "POST",
				headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: "",
			});
			expect(response.status).toBe(400);
			expect(response.headers.get("content-type")).toContain("application/problem+json");
		} finally {
			if (savedKey === undefined) {
				delete process.env.DOCRAPTOR_API_KEY;
			} else {
				process.env.DOCRAPTOR_API_KEY = savedKey;
			}
		}
	});

	it("returns 400 for POST /api/report-pdf with invalid session data", async () => {
		const token = await obtainSessionToken(baseUrl);
		const savedKey = process.env.DOCRAPTOR_API_KEY;
		process.env.DOCRAPTOR_API_KEY = "test-key";
		try {
			const response = await fetch(`${baseUrl}/api/report-pdf`, {
				method: "POST",
				headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: "not valid json",
			});
			expect(response.status).toBe(400);
			expect(response.headers.get("content-type")).toContain("application/problem+json");
			const body: unknown = await response.json();
			expect(body).toHaveProperty("detail", "Invalid session data.");
			expect(JSON.stringify(body)).not.toContain("Unexpected");
		} finally {
			if (savedKey === undefined) {
				delete process.env.DOCRAPTOR_API_KEY;
			} else {
				process.env.DOCRAPTOR_API_KEY = savedKey;
			}
		}
	});

	it("returns RFC 9457 problem details for validation failures", async () => {
		const response = await fetch(`${baseUrl}/api/health?timeoutSeconds=invalid`);
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("type", "about:blank");
		expect(body).toHaveProperty("title", expect.any(String));
		expect(body).toHaveProperty("status", 400);
		expect(body).toHaveProperty("detail", expect.any(String));
		expect(body).toHaveProperty("errors");
	});

	it("returns 403 for POST without Origin header", async () => {
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});
		expect(response.status).toBe(403);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "origin_not_allowed");
	});

	it("returns 403 for POST with wrong Origin header", async () => {
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});
		expect(response.status).toBe(403);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "origin_not_allowed");
	});

	it("allows POST with matching Referer when Origin is absent", async () => {
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Referer: `${TEST_ORIGIN}/some-page` },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});
		// Should pass origin check and reach the handler (429 because no session token)
		expect(response.status).toBe(429);
		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "challenge_required");
	});
});

describe("Error sanitization", () => {
	let server: Server | undefined;
	let baseUrl = "";
	let originalXaiApiKey: string | undefined;
	let originalAnthropicApiKey: string | undefined;

	beforeAll(async () => {
		originalXaiApiKey = process.env.XAI_API_KEY;
		process.env.XAI_API_KEY = "test-xai-api-key";
		originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "test-anthropic-api-key";

		const dbPath = path.join(os.tmpdir(), `rate-limit-test-${crypto.randomUUID()}.sqlite`);
		const app = await createApp({ rateLimitConfig: { rateLimitDbPath: dbPath, powSecret: crypto.randomUUID(), enableCleanup: false } });

		await new Promise<void>((resolve, reject) => {
			const candidate = app.listen(0, "127.0.0.1", () => {
				server = candidate;
				resolve();
			});
			candidate.on("error", reject);
		});

		if (server === undefined) {
			throw new Error("Server failed to start.");
		}

		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected server to listen on a TCP port.");
		}

		baseUrl = `http://127.0.0.1:${address.port.toString()}`;
	});

	afterAll(async () => {
		if (server !== undefined) {
			const runningServer = server;
			await new Promise<void>((resolve, reject) => {
				runningServer.close((error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}

		if (originalXaiApiKey === undefined) {
			delete process.env.XAI_API_KEY;
		} else {
			process.env.XAI_API_KEY = originalXaiApiKey;
		}
		if (originalAnthropicApiKey === undefined) {
			delete process.env.ANTHROPIC_API_KEY;
		} else {
			process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
		}
	});

	it("never forwards raw upstream AI error messages to clients", async () => {
		const token = await obtainSessionToken(baseUrl);
		const upstreamErrorText = "provider rejected request: api_key=test-xai-api-key";

		mswServer.use(
			http.post("https://api.x.ai/v1/chat/completions", () => {
				return new HttpResponse(upstreamErrorText, { status: 500 });
			}),
		);

		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "Tell me what this means in my life.",
			}),
		});

		expect(response.status).toBe(502);
		expect(response.headers.get("content-type")).toContain("application/problem+json");
		const body: unknown = await response.json();
		expect(body).toHaveProperty("detail", "Upstream AI service error.");
		expect(JSON.stringify(body)).not.toContain(upstreamErrorText);
	});
});

describe("Rate limiting", () => {
	let server: Server | undefined;
	let baseUrl = "";

	beforeAll(async () => {
		const dbPath = path.join(os.tmpdir(), `rate-limit-test-${crypto.randomUUID()}.sqlite`);
		const app = await createApp({ rateLimitConfig: { rateLimitDbPath: dbPath, powSecret: crypto.randomUUID(), enableCleanup: false } });

		await new Promise<void>((resolve, reject) => {
			const candidate = app.listen(0, "127.0.0.1", () => {
				server = candidate;
				resolve();
			});
			candidate.on("error", reject);
		});

		if (server === undefined) {
			throw new Error("Server failed to start.");
		}

		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected server to listen on a TCP port.");
		}

		baseUrl = `http://127.0.0.1:${address.port.toString()}`;
	});

	afterAll(async () => {
		if (server === undefined) {
			return;
		}
		const runningServer = server;

		await new Promise<void>((resolve, reject) => {
			runningServer.close((error) => {
				if (error !== undefined) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	});

	it("returns 429 challenge_required for budgeted endpoint without token", async () => {
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});

		expect(response.status).toBe(429);
		expect(response.headers.get("content-type")).toContain("application/problem+json");

		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "challenge_required");
		expect(body).toHaveProperty("challenge");

		const challenge = expectChallengeResponse(body).challenge;
		expect(challenge).toHaveProperty("challengeId");
		expect(challenge).toHaveProperty("expiresAt");
		expect(challenge).toHaveProperty("altcha");
		expect(challenge.altcha).toHaveProperty("algorithm");
		expect(challenge.altcha).toHaveProperty("challenge");
		expect(challenge.altcha).toHaveProperty("salt");
		expect(challenge.altcha).toHaveProperty("signature");
		expect(challenge.altcha).toHaveProperty("maxnumber");
	});

	it("returns 200 with token after solving challenge and verifying", async () => {
		// Get a challenge
		const challengeResponse = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});

		expect(challengeResponse.status).toBe(429);
		const challengeBody = expectChallengeResponse(await challengeResponse.json());

		const token = await solveAndVerify(baseUrl, challengeBody);
		expect(token).toMatch(/^[a-z]{32}$/);
	});

	it("retrying original request with token succeeds after obtaining session", async () => {
		const token = await obtainSessionToken(baseUrl);

		// Retry with token — should reach the handler (500 because no AI config)
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test answer for rate limit test",
			}),
		});

		// 500 means it got past the rate limiter and reached the handler
		expect(response.status).toBe(500);
		const body: unknown = await response.json();
		expect(body).toHaveProperty("detail", "AI summarization is not configured.");
	});

	it("returns 409 challenge_replayed when reusing a solved challenge", async () => {
		// Get a challenge
		const challengeResponse = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});
		expect(challengeResponse.status).toBe(429);
		const challengeBody = expectChallengeResponse(await challengeResponse.json());

		// Solve the challenge
		const { challengeId, altcha } = challengeBody.challenge;
		const result = solveChallenge(altcha.challenge, altcha.salt, altcha.algorithm, altcha.maxnumber);
		const solution = await result.promise;
		if (solution === null) throw new Error("Failed to solve");

		const payload = btoa(
			JSON.stringify({
				algorithm: altcha.algorithm,
				challenge: altcha.challenge,
				number: solution.number,
				salt: altcha.salt,
				signature: altcha.signature,
			}),
		);

		// First verify — should succeed
		const firstVerify = await fetch(`${baseUrl}/api/session/verify`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ challengeId, payload }),
		});
		expect(firstVerify.status).toBe(200);

		// Replay the same verify — should fail with 409
		const replayVerify = await fetch(`${baseUrl}/api/session/verify`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ challengeId, payload }),
		});
		expect(replayVerify.status).toBe(409);

		const replayBody: unknown = await replayVerify.json();
		expect(replayBody).toHaveProperty("code", "challenge_replayed");
	});

	it("allows only one successful verify across three concurrent replay attempts", async () => {
		const challengeResponse = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "concurrent replay test",
			}),
		});
		expect(challengeResponse.status).toBe(429);
		const challengeBody = expectChallengeResponse(await challengeResponse.json());
		const { challengeId, payload } = await buildChallengePayload(challengeBody);

		const attempts = await Promise.all(
			Array.from({ length: 3 }, async () =>
				fetch(`${baseUrl}/api/session/verify`, {
					method: "POST",
					headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
					body: JSON.stringify({ challengeId, payload }),
				}),
			),
		);

		const statuses = attempts.map((response) => response.status);
		expect(statuses.filter((status) => status === 200)).toHaveLength(1);
		expect(statuses.filter((status) => status === 409)).toHaveLength(2);

		for (const response of attempts) {
			if (response.status === 200) {
				const body: unknown = await response.json();
				expect(body).toHaveProperty("sessionToken");
				continue;
			}
			const body: unknown = await response.json();
			expect(body).toHaveProperty("code", "challenge_replayed");
		}
	});

	it("returns 400 for invalid challenge ID", async () => {
		const response = await fetch(`${baseUrl}/api/session/verify`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ challengeId: "nonexistent-id", payload: "bogus" }),
		});

		expect(response.status).toBe(400);
		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "challenge_invalid");
	});

	it("deducts budget before handler execution", async () => {
		const token = await obtainSessionToken(baseUrl);

		// Use up budget with many 5-credit calls (bootstrap gives 100 credits)
		// 100 / 5 = 20 calls should exhaust the budget
		for (let i = 0; i < 20; i++) {
			const response = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "budget test",
				}),
			});
			// Should be 500 (reaches handler, no AI config)
			expect(response.status).toBe(500);
		}

		// 21st call should get 429 — budget exhausted
		const exhaustedResponse = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "budget test",
			}),
		});
		expect(exhaustedResponse.status).toBe(429);
	});

	it("refreshing an existing session preserves the token", async () => {
		const token = await obtainSessionToken(baseUrl);

		// Exhaust budget
		for (let i = 0; i < 20; i++) {
			await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "refresh test",
				}),
			});
		}

		// Get new challenge
		const challengeResponse = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "refresh test",
			}),
		});
		expect(challengeResponse.status).toBe(429);
		const challengeBody = expectChallengeResponse(await challengeResponse.json());

		// Verify with existing token — should refresh the same session
		const refreshedToken = await solveAndVerify(baseUrl, challengeBody, token);
		expect(refreshedToken).toBe(token);
	});

	it("/api/health is accessible without any auth", async () => {
		const response = await fetch(`${baseUrl}/api/health`);
		expect(response.status).toBe(200);
	});

	it("budget cap prevents accumulation beyond 150 units", async () => {
		// Get first session with 100 credits
		const token = await obtainSessionToken(baseUrl);

		// Trigger a refresh while we still have budget
		// First, use 1 call to leave 95 credits
		await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "cap test",
			}),
		});

		// Now trigger a challenge from a different endpoint perspective — go get a challenge from /api/report-pdf which costs 100
		const pdfResponse = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: "cap test",
		});
		// 95 credits < 100 cost, so we get a challenge
		expect(pdfResponse.status).toBe(429);
		const challengeBody = expectChallengeResponse(await pdfResponse.json());

		// Solve and verify to add credits (should cap at 150)
		await solveAndVerify(baseUrl, challengeBody, token);

		// Now we should have min(95 + 100, 150) = 150 credits
		// We should be able to do the PDF now (costs 100)
		const pdfRetry = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: "cap test",
		});
		// 500 because DOCRAPTOR_API_KEY not set — but we passed the budget check
		expect(pdfRetry.status).toBe(500);

		// After PDF we have 50 credits left. Do 10 more summarize calls (5 each = 50)
		for (let i = 0; i < 10; i++) {
			const resp = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "cap exhaust",
				}),
			});
			expect(resp.status).toBe(500); // reaches handler
		}

		// Now at 0 credits — should get 429
		const finalResponse = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "should fail",
			}),
		});
		expect(finalResponse.status).toBe(429);
	});

	it("invalid bearer token triggers challenge flow, not 401", async () => {
		const response = await fetch(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer invalidtokenthatisnottherightformat",
				Origin: TEST_ORIGIN,
			},
			body: JSON.stringify({
				cardId: "self-knowledge",
				questionId: "interpretation",
				answer: "test",
			}),
		});

		expect(response.status).toBe(429);
		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "challenge_required");
	});

	it("session/verify returns 400 for malformed request body", async () => {
		const response = await fetch(`${baseUrl}/api/session/verify`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
			body: JSON.stringify({ wrong: "fields" }),
		});

		expect(response.status).toBe(400);
	});

	it("different challenges issue different challenge IDs", async () => {
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const response = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "uniqueness test",
				}),
			});
			expect(response.status).toBe(429);
			const body = expectChallengeResponse(await response.json());
			ids.push(body.challenge.challengeId);
		}

		// All challenge IDs should be unique
		expect(new Set(ids).size).toBe(3);
	});

	it("budget credits expire after 30 minutes", async () => {
		vi.useFakeTimers({ toFake: ["Date", "performance", "hrtime"] });
		vi.setSystemTime(new Date(1_700_000_000_000));
		try {
			const token = await obtainSessionToken(baseUrl);

			const initialUse = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "budget ttl check",
				}),
			});
			expect(initialUse.status).toBe(500);

			vi.setSystemTime(new Date(Date.now() + 30 * 60 * 1000 + 1));

			const expiredUse = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "budget ttl check",
				}),
			});
			expect(expiredUse.status).toBe(429);
			const body: unknown = await expiredUse.json();
			expect(body).toHaveProperty("code", "challenge_required");
		} finally {
			vi.useRealTimers();
		}
	});

	it("session expires after 24 hours and verify returns a new token", async () => {
		vi.useFakeTimers({ toFake: ["Date", "performance", "hrtime"] });
		vi.setSystemTime(new Date(1_800_000_000_000));
		try {
			const originalToken = await obtainSessionToken(baseUrl);

			const beforeExpiry = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${originalToken}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "session ttl check",
				}),
			});
			expect(beforeExpiry.status).toBe(500);

			vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1));

			const challengeResponse = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${originalToken}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "session ttl check",
				}),
			});
			expect(challengeResponse.status).toBe(429);

			const challengeBody = expectChallengeResponse(await challengeResponse.json());
			const refreshedToken = await solveAndVerify(baseUrl, challengeBody, originalToken);
			expect(refreshedToken).not.toBe(originalToken);

			const withRefreshed = await fetch(`${baseUrl}/api/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshedToken}`, Origin: TEST_ORIGIN },
				body: JSON.stringify({
					cardId: "self-knowledge",
					questionId: "interpretation",
					answer: "session ttl check",
				}),
			});
			expect(withRefreshed.status).toBe(500);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("PDF daily limit", () => {
	let server: Server | undefined;
	let baseUrl = "";
	let originalDocraptorApiKey: string | undefined;

	const validSessionExport = JSON.stringify({
		version: "somecam-v2",
		sessions: [
			{
				id: "test-session",
				name: "Test",
				createdAt: "2025-01-01T00:00:00Z",
				lastUpdatedAt: "2025-01-01T00:00:00Z",
				data: {
					chosen: ["self-knowledge"],
				},
			},
		],
	});

	beforeAll(async () => {
		originalDocraptorApiKey = process.env.DOCRAPTOR_API_KEY;
		process.env.DOCRAPTOR_API_KEY = "test-docraptor-key";

		const dbPath = path.join(os.tmpdir(), `rate-limit-test-${crypto.randomUUID()}.sqlite`);
		const app = await createApp({ rateLimitConfig: { rateLimitDbPath: dbPath, powSecret: crypto.randomUUID(), enableCleanup: false } });
		app.locals.vite = {
			ssrLoadModule: (): Promise<unknown> =>
				Promise.resolve({
					renderPdfHtml: (): Promise<string> => Promise.resolve("<html><body>Report</body></html>"),
				}),
			moduleGraph: {
				getModuleByUrl: (): Promise<undefined> => Promise.resolve(undefined),
			},
			transformRequest: (): Promise<null> => Promise.resolve(null),
		};

		await new Promise<void>((resolve, reject) => {
			const candidate = app.listen(0, "127.0.0.1", () => {
				server = candidate;
				resolve();
			});
			candidate.on("error", reject);
		});

		if (server === undefined) {
			throw new Error("Server failed to start.");
		}

		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected server to listen on a TCP port.");
		}

		baseUrl = `http://127.0.0.1:${address.port.toString()}`;
	});

	beforeEach(() => {
		mswServer.use(
			http.post("https://api.docraptor.com/docs", () => {
				return new HttpResponse(Buffer.from("%PDF-1.4 fake"), {
					status: 200,
					headers: { "Content-Type": "application/pdf" },
				});
			}),
		);
	});

	afterAll(async () => {
		if (server !== undefined) {
			const runningServer = server;

			await new Promise<void>((resolve, reject) => {
				runningServer.close((error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}

		if (originalDocraptorApiKey === undefined) {
			delete process.env.DOCRAPTOR_API_KEY;
		} else {
			process.env.DOCRAPTOR_API_KEY = originalDocraptorApiKey;
		}
	});

	async function doPdfDownloadAndRefresh(token: string, sessionExport = validSessionExport): Promise<{ response: Response; token: string }> {
		const response = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
			body: sessionExport,
		});

		if (response.status === 429) {
			const body: unknown = await response
				.clone()
				.json()
				.catch(() => null);
			if (isChallengeResponse(body)) {
				// Budget exhausted — solve challenge and retry
				const refreshedToken = await solveAndVerify(baseUrl, body, token);
				const retryResponse = await fetch(`${baseUrl}/api/report-pdf`, {
					method: "POST",
					headers: { "Content-Type": "text/plain", Authorization: `Bearer ${refreshedToken}`, Origin: TEST_ORIGIN },
					body: sessionExport,
				});
				return { response: retryResponse, token: refreshedToken };
			}
		}

		return { response, token };
	}

	it("returns daily_limit_exceeded after 3 successful downloads", async () => {
		const token = await obtainSessionToken(baseUrl);
		let currentToken = token;

		for (let i = 0; i < MAX_PDF_DOWNLOADS_PER_DAY; i++) {
			const result = await doPdfDownloadAndRefresh(currentToken);
			expect(result.response.status).toBe(200);
			currentToken = result.token;
		}

		const limitedResponse = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${currentToken}`, Origin: TEST_ORIGIN },
			body: validSessionExport,
		});

		expect(limitedResponse.status).toBe(429);
		const body: unknown = await limitedResponse.json();
		expect(body).toHaveProperty("code", "daily_limit_exceeded");
		expect(body).not.toHaveProperty("remaining");
		expect(body).not.toHaveProperty("retryAfter");
		expect(limitedResponse.headers.get("Retry-After")).not.toBeNull();
		expect(limitedResponse.headers.get("X-Impression-PDF-Downloads-Remaining")).toBe("0");
	});

	it("remaining header decrements correctly", async () => {
		const token = await obtainSessionToken(baseUrl);
		let currentToken = token;
		const remainingValues: number[] = [];

		for (let i = 0; i < MAX_PDF_DOWNLOADS_PER_DAY; i++) {
			const result = await doPdfDownloadAndRefresh(currentToken);
			expect(result.response.status).toBe(200);
			const remaining = result.response.headers.get("X-Impression-PDF-Downloads-Remaining");
			expect(remaining).not.toBeNull();
			remainingValues.push(parseInt(remaining!, 10));
			currentToken = result.token;
		}

		expect(remainingValues).toEqual([2, 1, 0]);
	});

	it("failed PDF attempts do not consume the daily limit", async () => {
		const token = await obtainSessionToken(baseUrl);
		let currentToken = token;

		const failedAttempt = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${currentToken}`, Origin: TEST_ORIGIN },
			body: "not valid json",
		});
		expect(failedAttempt.status).toBe(400);
		expect(failedAttempt.headers.get("X-Impression-PDF-Downloads-Remaining")).toBe(MAX_PDF_DOWNLOADS_PER_DAY.toString());

		for (let i = 0; i < MAX_PDF_DOWNLOADS_PER_DAY; i++) {
			const result = await doPdfDownloadAndRefresh(currentToken);
			expect(result.response.status).toBe(200);
			currentToken = result.token;
		}

		const limitedResponse = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${currentToken}`, Origin: TEST_ORIGIN },
			body: validSessionExport,
		});
		expect(limitedResponse.status).toBe(429);
		const body: unknown = await limitedResponse.json();
		expect(body).toHaveProperty("code", "daily_limit_exceeded");
	});

	it("upstream PDF generation failure does not consume the daily limit", async () => {
		const token = await obtainSessionToken(baseUrl);
		let currentToken = token;

		// Make DocRaptor fail with 502
		mswServer.use(
			http.post("https://api.docraptor.com/docs", () => {
				return new HttpResponse("Service Unavailable", { status: 503 });
			}),
		);

		const failedAttempt = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${currentToken}`, Origin: TEST_ORIGIN },
			body: validSessionExport,
		});
		expect(failedAttempt.status).toBe(502);
		expect(failedAttempt.headers.get("X-Impression-PDF-Downloads-Remaining")).toBe(MAX_PDF_DOWNLOADS_PER_DAY.toString());

		// Restore DocRaptor to succeed
		mswServer.resetHandlers();
		mswServer.use(
			http.post("https://api.docraptor.com/docs", () => {
				return new HttpResponse(Buffer.from("%PDF-1.4 fake"), {
					status: 200,
					headers: { "Content-Type": "application/pdf" },
				});
			}),
		);

		// All 3 downloads should still succeed
		for (let i = 0; i < MAX_PDF_DOWNLOADS_PER_DAY; i++) {
			const result = await doPdfDownloadAndRefresh(currentToken);
			expect(result.response.status).toBe(200);
			currentToken = result.token;
		}

		const limitedResponse = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${currentToken}`, Origin: TEST_ORIGIN },
			body: validSessionExport,
		});
		expect(limitedResponse.status).toBe(429);
		const body: unknown = await limitedResponse.json();
		expect(body).toHaveProperty("code", "daily_limit_exceeded");
	});

	it("daily limit check runs before budget check", async () => {
		const token = await obtainSessionToken(baseUrl);
		let currentToken = token;

		// Exhaust the daily limit
		for (let i = 0; i < MAX_PDF_DOWNLOADS_PER_DAY; i++) {
			const result = await doPdfDownloadAndRefresh(currentToken);
			expect(result.response.status).toBe(200);
			currentToken = result.token;
		}

		// Now try with empty budget — should get daily_limit_exceeded, not challenge_required.
		const response = await fetch(`${baseUrl}/api/report-pdf`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${currentToken}`, Origin: TEST_ORIGIN },
			body: validSessionExport,
		});

		expect(response.status).toBe(429);
		const body: unknown = await response.json();
		expect(body).toHaveProperty("code", "daily_limit_exceeded");
	});
});
