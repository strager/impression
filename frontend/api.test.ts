// @vitest-environment node

import { createChallenge } from "altcha-lib";
import { Window } from "happy-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { budgetedFetch, fetchReflectOnAnswer, fetchInferredAnswers } from "./api.ts";
import { loadRateLimitToken, saveRateLimitToken } from "./store.ts";

const TEST_HMAC_KEY = "test-hmac-key-for-challenges";
const TEST_SESSION_TOKEN = "abcdefghijklmnopqrstuvwxyzabcdef";

async function makeChallenge(): Promise<{
	type: string;
	title: string;
	status: number;
	detail: string;
	code: string;
	challenge: {
		challengeId: string;
		expiresAt: number;
		altcha: { algorithm: string; challenge: string; maxnumber?: number; salt: string; signature: string };
	};
}> {
	const altcha = await createChallenge({ hmacKey: TEST_HMAC_KEY, maxnumber: 100 });
	return {
		type: "about:blank",
		title: "Too Many Requests",
		status: 429,
		detail: "Rate limit exceeded. Solve the challenge to continue.",
		code: "challenge_required",
		challenge: {
			challengeId: crypto.randomUUID(),
			expiresAt: Date.now() + 300_000,
			altcha,
		},
	};
}

let currentWindow: Window | null = null;

function setGlobalDom(win: Window): void {
	Object.defineProperty(globalThis, "window", { value: win, configurable: true });
	Object.defineProperty(globalThis, "document", { value: win.document, configurable: true });
	Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });
}

const server = setupServer();

// MSW's Node.js interceptor cannot handle relative URLs (e.g. "/api/reflect-on-answer").
// Wrap globalThis.fetch after MSW patches it so relative paths resolve to absolute URLs.
beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
	const mswFetch = globalThis.fetch;
	globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		if (typeof input === "string" && input.startsWith("/")) {
			return mswFetch(`http://localhost${input}`, init);
		}
		return mswFetch(input, init);
	};
});

beforeEach(() => {
	currentWindow = new Window({ url: "http://localhost" });
	setGlobalDom(currentWindow);
});

afterEach(() => {
	server.resetHandlers();
	currentWindow?.close();
	currentWindow = null;
});

afterAll(() => {
	server.close();
});

// --- budgetedFetch (tests shared fetchWithChallenge behavior) ---

describe("budgetedFetch", () => {
	it("returns response on 200", async () => {
		server.use(
			http.post("*/api/report-pdf", () => {
				return new HttpResponse("fake-pdf-content", {
					status: 200,
					headers: { "Content-Type": "application/pdf" },
				});
			}),
		);

		const response = await budgetedFetch("/api/report-pdf", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "session data",
		});

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toBe("fake-pdf-content");
	});

	it("handles 429 → solve → verify → retry", async () => {
		let callCount = 0;
		const challengeBody = await makeChallenge();

		server.use(
			http.post("*/api/report-pdf", () => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json(challengeBody, { status: 429 });
				}
				return new HttpResponse("real-pdf", {
					status: 200,
					headers: { "Content-Type": "application/pdf" },
				});
			}),
			http.post("*/api/session/verify", () => {
				return HttpResponse.json({ sessionToken: TEST_SESSION_TOKEN });
			}),
		);

		const response = await budgetedFetch("/api/report-pdf", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "session data",
		});

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toBe("real-pdf");
		expect(loadRateLimitToken()).toBe(TEST_SESSION_TOKEN);
	});

	it("returns error response on non-429 failure", async () => {
		server.use(
			http.post("*/api/report-pdf", () => {
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
		);

		const response = await budgetedFetch("/api/report-pdf", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "data",
		});

		expect(response.status).toBe(500);
	});

	it("throws when verify fails", async () => {
		const challengeBody = await makeChallenge();

		server.use(
			http.post("*/api/report-pdf", () => {
				return HttpResponse.json(challengeBody, { status: 429 });
			}),
			http.post("*/api/session/verify", () => {
				return new HttpResponse("Bad Request", { status: 400 });
			}),
		);

		await expect(
			budgetedFetch("/api/report-pdf", {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "data",
			}),
		).rejects.toThrow(/verify failed/i);
	});

	it("sends existing Authorization header", async () => {
		let capturedAuth: string | null = null;

		server.use(
			http.post("*/api/report-pdf", ({ request }) => {
				capturedAuth = request.headers.get("Authorization");
				return new HttpResponse("ok", { status: 200 });
			}),
		);

		saveRateLimitToken("existing-token");
		await budgetedFetch("/api/report-pdf", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "data",
		});
		expect(capturedAuth).toBe("Bearer existing-token");
	});

	it("sends new token on retry after challenge", async () => {
		let callCount = 0;
		let retryAuth: string | null = null;
		const challengeBody = await makeChallenge();

		server.use(
			http.post("*/api/report-pdf", ({ request }) => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json(challengeBody, { status: 429 });
				}
				retryAuth = request.headers.get("Authorization");
				return new HttpResponse("ok", { status: 200 });
			}),
			http.post("*/api/session/verify", () => {
				return HttpResponse.json({ sessionToken: TEST_SESSION_TOKEN });
			}),
		);

		await budgetedFetch("/api/report-pdf", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "data",
		});
		expect(retryAuth).toBe(`Bearer ${TEST_SESSION_TOKEN}`);
	});

	it("deduplicates concurrent 429 challenges into one verify call", async () => {
		const challengeBody = await makeChallenge();
		let verifyCount = 0;
		const callCounts: Record<string, number> = { "infer-answers": 0, "reflect-on-answer": 0 };
		const retryAuths: string[] = [];

		server.use(
			http.post("*/api/infer-answers", ({ request }) => {
				callCounts["infer-answers"]++;
				if (callCounts["infer-answers"] === 1) {
					return HttpResponse.json(challengeBody, { status: 429 });
				}
				retryAuths.push(request.headers.get("Authorization") ?? "");
				return HttpResponse.json({ inferredAnswers: [] });
			}),
			http.post("*/api/reflect-on-answer", ({ request }) => {
				callCounts["reflect-on-answer"]++;
				if (callCounts["reflect-on-answer"] === 1) {
					return HttpResponse.json(challengeBody, { status: 429 });
				}
				retryAuths.push(request.headers.get("Authorization") ?? "");
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/session/verify", () => {
				verifyCount++;
				return HttpResponse.json({ sessionToken: TEST_SESSION_TOKEN });
			}),
		);

		const [inferred, depth] = await Promise.all([fetchInferredAnswers({ cardId: "c", questions: [{ questionId: "q", answer: "a" }] }), fetchReflectOnAnswer({ cardId: "c", questionId: "q", answer: "a" })]);

		expect(inferred).toEqual({ inferredAnswers: [] });
		expect(depth).toEqual({ type: "none", message: "" });
		expect(verifyCount).toBe(1);
		expect(loadRateLimitToken()).toBe(TEST_SESSION_TOKEN);
		expect(retryAuths).toEqual([`Bearer ${TEST_SESSION_TOKEN}`, `Bearer ${TEST_SESSION_TOKEN}`]);
	});

	it("sends correct Content-Type and body", async () => {
		let capturedContentType: string | null = null;
		let capturedBody: string | null = null;

		server.use(
			http.post("*/api/report-pdf", async ({ request }) => {
				capturedContentType = request.headers.get("Content-Type");
				capturedBody = await request.text();
				return new HttpResponse("ok", { status: 200 });
			}),
		);

		await budgetedFetch("/api/report-pdf", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "my session data",
		});

		expect(capturedContentType).toBe("text/plain");
		expect(capturedBody).toBe("my session data");
	});
});

// --- postJson error handling (tested via fetchInferredAnswers) ---

describe("postJson error handling (via fetchInferredAnswers)", () => {
	it("throws on non-429 error (500)", async () => {
		server.use(
			http.post("*/api/infer-answers", () => {
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
		);

		await expect(fetchInferredAnswers({ cardId: "c", questions: [{ questionId: "q", answer: "a" }] })).rejects.toThrow(/500/);
	});

	it("throws when retry after solve still fails", async () => {
		let callCount = 0;
		const challengeBody = await makeChallenge();

		server.use(
			http.post("*/api/infer-answers", () => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json(challengeBody, { status: 429 });
				}
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
			http.post("*/api/session/verify", () => {
				return HttpResponse.json({ sessionToken: TEST_SESSION_TOKEN });
			}),
		);

		await expect(fetchInferredAnswers({ cardId: "c", questions: [{ questionId: "q", answer: "a" }] })).rejects.toThrow(/500/);
	});

	it("retries when concurrent retry receives a second 429 challenge response", async () => {
		const firstChallengeBody = await makeChallenge();
		const secondChallengeBody = await makeChallenge();
		let verifyCount = 0;
		const callCounts: Record<string, number> = { "infer-answers": 0, "reflect-on-answer": 0 };
		const depthRetryAuths: string[] = [];
		const firstToken = "abcdefghijklmnopqrstuvwxyzabcdef";
		const secondToken = "bcdefghijklmnopqrstuvwxyzaabcde";

		server.use(
			http.post("*/api/infer-answers", () => {
				callCounts["infer-answers"]++;
				if (callCounts["infer-answers"] === 1) {
					return HttpResponse.json(firstChallengeBody, { status: 429 });
				}
				return HttpResponse.json({ inferredAnswers: [] });
			}),
			http.post("*/api/reflect-on-answer", ({ request }) => {
				callCounts["reflect-on-answer"]++;
				if (callCounts["reflect-on-answer"] === 1) {
					return HttpResponse.json(firstChallengeBody, { status: 429 });
				}
				depthRetryAuths.push(request.headers.get("Authorization") ?? "");
				if (callCounts["reflect-on-answer"] === 2) {
					return HttpResponse.json(secondChallengeBody, { status: 429 });
				}
				return HttpResponse.json({ type: "none", message: "" });
			}),
			http.post("*/api/session/verify", () => {
				verifyCount++;
				if (verifyCount === 1) {
					return HttpResponse.json({ sessionToken: firstToken });
				}
				return HttpResponse.json({ sessionToken: secondToken });
			}),
		);

		const [inferred, depth] = await Promise.all([fetchInferredAnswers({ cardId: "c", questions: [{ questionId: "q", answer: "a" }] }), fetchReflectOnAnswer({ cardId: "c", questionId: "q", answer: "a" })]);

		expect(inferred).toEqual({ inferredAnswers: [] });
		expect(depth).toEqual({ type: "none", message: "" });
		expect(depthRetryAuths).toEqual([`Bearer ${firstToken}`, `Bearer ${secondToken}`]);
		expect(verifyCount).toBe(2);
		expect(loadRateLimitToken()).toBe(secondToken);
	});

	it("throws on 409 when response is not challenge_required", async () => {
		server.use(
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json(
					{
						type: "about:blank",
						title: "Conflict",
						status: 409,
						code: "challenge_replayed",
						detail: "Challenge has already been consumed.",
					},
					{ status: 409 },
				);
			}),
		);

		await expect(fetchInferredAnswers({ cardId: "c", questions: [{ questionId: "q", answer: "a" }] })).rejects.toThrow(/409/);
	});
});

// --- fetchReflectOnAnswer ---

describe("fetchReflectOnAnswer", () => {
	it("succeeds on 200", async () => {
		server.use(
			http.post("*/api/reflect-on-answer", () => {
				return HttpResponse.json({ type: "none", message: "" });
			}),
		);

		const result = await fetchReflectOnAnswer({ cardId: "c", questionId: "q", answer: "a" });
		expect(result).toEqual({ type: "none", message: "" });
	});
});

// --- fetchInferredAnswers ---

describe("fetchInferredAnswers", () => {
	it("succeeds on 200", async () => {
		server.use(
			http.post("*/api/infer-answers", () => {
				return HttpResponse.json({
					inferredAnswers: [{ questionId: "q1", answer: "inferred" }],
				});
			}),
		);

		const result = await fetchInferredAnswers({ cardId: "c", questions: [{ questionId: "q1", answer: "a" }] });
		expect(result).toEqual({ inferredAnswers: [{ questionId: "q1", answer: "inferred" }] });
	});
});
