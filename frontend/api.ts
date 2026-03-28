import { solveChallenge } from "altcha-lib";

import { capture } from "./analytics.ts";
import { loadRateLimitToken, saveRateLimitToken } from "./store.ts";

interface ReflectOnAnswerRequest {
	cardId: string;
	questionId: string;
	answer: string;
	suppressGuardrail?: boolean;
}

export interface ReflectOnAnswerResponse {
	type: "guardrail" | "thought_bubble" | "none";
	message: string;
}

interface InferAnswersRequest {
	cardId: string;
	questions: { questionId: string; answer: string }[];
}

interface InferAnswersResponse {
	inferredAnswers: { questionId: string; answer: string }[];
}

interface SynthesizeRequest {
	cardId: string;
	questions: { questionId: string; answer: string }[];
	selectedDescriptions?: string[];
	freeformNote?: string;
	short?: boolean;
}

interface SynthesizeResponse {
	synthesis: string;
}

interface ChallengePayload {
	challengeId: string;
	expiresAt: number;
	altcha: { algorithm: string; challenge: string; maxnumber: number; salt: string; signature: string };
}

function authHeaders(): Record<string, string> {
	const token = loadRateLimitToken();
	if (token !== null) {
		return { Authorization: `Bearer ${token}` };
	}
	return {};
}

function isChallengeRequired(body: unknown): body is { code: string; challenge: ChallengePayload } {
	return typeof body === "object" && body !== null && "code" in body && body.code === "challenge_required" && "challenge" in body;
}

async function solveAndVerify(challenge: ChallengePayload): Promise<void> {
	const { algorithm, challenge: challengeHash, maxnumber, salt, signature } = challenge.altcha;

	const result = solveChallenge(challengeHash, salt, algorithm, maxnumber);
	const solution = await result.promise;
	if (solution === null) {
		throw new Error("Challenge solving failed");
	}

	const payload = btoa(
		JSON.stringify({
			algorithm,
			challenge: challengeHash,
			number: solution.number,
			salt,
			signature,
		}),
	);

	const verifyResponse = await fetch("/api/session/verify", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...authHeaders(),
		},
		body: JSON.stringify({ challengeId: challenge.challengeId, payload }),
	});

	if (!verifyResponse.ok) {
		throw new Error(`Session verify failed (${verifyResponse.status.toString()})`);
	}

	const verifyBody: unknown = await verifyResponse.json();
	if (typeof verifyBody === "object" && verifyBody !== null && "sessionToken" in verifyBody && typeof verifyBody.sessionToken === "string") {
		saveRateLimitToken(verifyBody.sessionToken);
	}
}

let challengeInFlight: Promise<void> | null = null;

async function fetchWithChallenge(endpoint: string, buildInit: () => RequestInit): Promise<Response> {
	for (;;) {
		const response = await fetch(endpoint, buildInit());
		if (response.status !== 429) {
			return response;
		}

		const errorBody: unknown = await response
			.clone()
			.json()
			.catch(() => null);
		if (!isChallengeRequired(errorBody)) {
			return response;
		}

		if (challengeInFlight === null) {
			console.time("Proof-of-work challenge");
			const challengeStart = performance.now();
			challengeInFlight = solveAndVerify(errorBody.challenge).finally(() => {
				challengeInFlight = null;
			});
			await challengeInFlight;
			capture("pow_challenge_completed", {
				endpoint,
				duration_ms: Math.round(performance.now() - challengeStart),
			});
			console.timeEnd("Proof-of-work challenge");
		} else {
			await challengeInFlight;
		}
	}
}

async function postJson<T>(endpoint: string, payload: unknown, failureLabel: string, validate: (raw: unknown) => T): Promise<T> {
	const start = performance.now();

	let response: Response;
	try {
		response = await fetchWithChallenge(endpoint, () => ({
			method: "POST",
			headers: { "Content-Type": "application/json", ...authHeaders() },
			body: JSON.stringify(payload),
		}));
	} catch (error) {
		capture("api_call_failed", { endpoint, error_type: "network_error" });
		throw error;
	}

	if (!response.ok) {
		capture("api_call_failed", { endpoint, error_type: `http_${response.status.toString()}` });
		const text = await response.text();
		throw new Error(`${failureLabel} request failed (${response.status.toString()}): ${text}`);
	}

	try {
		const raw: unknown = await response.json();
		const body = validate(raw);
		capture("api_call_completed", {
			endpoint,
			latency_ms: Math.round(performance.now() - start),
		});
		return body;
	} catch {
		capture("api_call_failed", { endpoint, error_type: "invalid_json" });
		throw new Error(`${failureLabel} request failed: invalid JSON response`);
	}
}

export async function budgetedFetch(endpoint: string, init: Omit<RequestInit, "headers"> & { headers: Record<string, string> }): Promise<Response> {
	return fetchWithChallenge(endpoint, () => ({
		...init,
		headers: { ...init.headers, ...authHeaders() },
	}));
}

function validateReflectOnAnswerResponse(raw: unknown): ReflectOnAnswerResponse {
	if (typeof raw !== "object" || raw === null || !("type" in raw) || typeof raw.type !== "string" || !("message" in raw) || typeof raw.message !== "string") {
		throw new Error("Invalid reflect-on-answer response");
	}
	if (raw.type !== "guardrail" && raw.type !== "thought_bubble" && raw.type !== "none") {
		throw new Error("Invalid reflect-on-answer response");
	}
	return { type: raw.type, message: raw.message };
}

function validateInferAnswersResponse(raw: unknown): InferAnswersResponse {
	if (typeof raw !== "object" || raw === null || !("inferredAnswers" in raw) || !Array.isArray(raw.inferredAnswers)) {
		throw new Error("Invalid infer-answers response");
	}
	const items: unknown[] = raw.inferredAnswers;
	const inferredAnswers: { questionId: string; answer: string }[] = [];
	for (const item of items) {
		if (typeof item === "object" && item !== null && "questionId" in item && typeof item.questionId === "string" && "answer" in item && typeof item.answer === "string") {
			inferredAnswers.push({ questionId: item.questionId, answer: item.answer });
		}
	}
	return { inferredAnswers };
}

function validateSynthesizeResponse(raw: unknown): SynthesizeResponse {
	if (typeof raw !== "object" || raw === null || !("synthesis" in raw) || typeof raw.synthesis !== "string") {
		throw new Error("Invalid synthesize response");
	}
	return { synthesis: raw.synthesis };
}

export async function fetchSynthesis(request: SynthesizeRequest): Promise<SynthesizeResponse> {
	return postJson("/api/synthesize", request, "Synthesize", validateSynthesizeResponse);
}

export async function fetchReflectOnAnswer(request: ReflectOnAnswerRequest): Promise<ReflectOnAnswerResponse> {
	return postJson("/api/reflect-on-answer", request, "Reflect on answer", validateReflectOnAnswerResponse);
}

export async function fetchInferredAnswers(request: InferAnswersRequest): Promise<InferAnswersResponse> {
	return postJson("/api/infer-answers", request, "Infer answers", validateInferAnswersResponse);
}
