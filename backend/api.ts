import type { Request as ExpressRequest, RequestHandler, Response } from "express";
import { OpenAPIBackend, type Context, type Request as OpenApiRequest, type ValidationResult } from "openapi-backend";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "./config.ts";
import { isAllowedOrigin, shouldCheckOrigin } from "./origin-check.ts";
import { callDocRaptor, renderReportHtml } from "./pdf-report.ts";
import { ChallengeError, MAX_PDF_DOWNLOADS_PER_DAY, type RateLimiter } from "./rate-limit.ts";
import { createChatCompletion } from "./xai-client.ts";
import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import { MEANING_STATEMENTS } from "../shared/meaning-statements.ts";

interface ApiProblemDetails {
	type: string;
	title: string;
	status: number;
	detail: string;
	errors?: unknown[];
}

interface ApiResponse {
	statusCode: number;
	body?: unknown;
	headers?: Record<string, string>;
}

const OPENAPI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.yaml");

const api = new OpenAPIBackend({
	definition: OPENAPI_PATH,
	strict: true,
	validate: true,
});

let initializePromise: Promise<unknown> | undefined;
let appConfig: AppConfig | undefined;
let rateLimiter: RateLimiter | undefined;

const problemJsonHeader = {
	"content-type": "application/problem+json",
};

const safeErrorDetails = {
	responseValidation: "Handler returned a response that could not be validated.",
	challengeVerificationFailed: "Challenge verification failed.",
	challengeReplayed: "Challenge has already been consumed.",
	upstreamAiService: "Upstream AI service error.",
	invalidSessionData: "Invalid session data.",
	pdfGenerationService: "PDF generation service error.",
};

function createProblemDetails(status: number, title: string, detail: string, errors?: unknown[]): ApiProblemDetails {
	return {
		type: "about:blank",
		title,
		status,
		detail,
		...(errors !== undefined ? { errors } : {}),
	};
}

function firstErrorMessage(errors: unknown[]): string {
	const firstError = errors[0];
	if (typeof firstError === "object" && firstError !== null && "message" in firstError && typeof firstError.message === "string" && firstError.message.length > 0) {
		return firstError.message;
	}
	return "Request validation failed.";
}

function normalizeApiResponse(value: unknown): ApiResponse {
	if (value === undefined) {
		return { statusCode: 204 };
	}

	if (typeof value === "object" && value !== null && "statusCode" in value && typeof value.statusCode === "number") {
		const result: ApiResponse = {
			statusCode: value.statusCode,
			body: "body" in value ? value.body : undefined,
		};
		if ("headers" in value && typeof value.headers === "object" && value.headers !== null) {
			const headers: Record<string, string> = {};
			for (const [k, v] of Object.entries(value.headers)) {
				if (typeof v === "string") headers[k] = v;
			}
			result.headers = headers;
		}
		return result;
	}

	return {
		statusCode: 200,
		body: value,
	};
}

function extractValidationErrors(context: Context): unknown[] {
	if (!Array.isArray(context.validation.errors)) {
		return [];
	}
	return context.validation.errors;
}

function collectResponseValidationErrors(validationResult: ValidationResult): unknown[] {
	if (!Array.isArray(validationResult.errors)) {
		return [];
	}
	return validationResult.errors;
}

function challengeErrorDetail(code: string): string {
	if (code === "challenge_replayed") {
		return safeErrorDetails.challengeReplayed;
	}
	return safeErrorDetails.challengeVerificationFailed;
}

function validateOperationResponse(context: Context, response: ApiResponse): ApiResponse {
	if (response.body === undefined) {
		return response;
	}

	try {
		const validationResult = api.validateResponse(response.body, context.operation, response.statusCode);
		const errors = collectResponseValidationErrors(validationResult);
		if (errors.length === 0) {
			return response;
		}

		return {
			statusCode: 500,
			headers: problemJsonHeader,
			body: createProblemDetails(500, "Response Validation Failed", "Handler returned a response that does not match the OpenAPI spec.", errors),
		};
	} catch {
		return {
			statusCode: 500,
			headers: problemJsonHeader,
			body: createProblemDetails(500, "Response Validation Failed", safeErrorDetails.responseValidation),
		};
	}
}

function sendApiResponse(res: Response, response: ApiResponse): void {
	res.status(response.statusCode);

	if (response.headers !== undefined) {
		for (const [headerName, headerValue] of Object.entries(response.headers)) {
			res.setHeader(headerName, headerValue);
		}
	}

	if (response.body === undefined) {
		res.end();
		return;
	}

	if (typeof response.body === "string" || Buffer.isBuffer(response.body)) {
		res.send(response.body);
		return;
	}

	if (res.getHeader("content-type") === undefined) {
		res.type("application/json");
	}

	res.send(JSON.stringify(response.body));
}

function toOpenApiRequest(req: ExpressRequest): OpenApiRequest {
	const headers: OpenApiRequest["headers"] = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (typeof value === "string" || Array.isArray(value)) {
			headers[name] = value;
		}
	}

	const reqBody: unknown = req.body;
	return {
		method: req.method,
		path: req.url,
		headers,
		body: reqBody,
	};
}

async function checkBudget(context: Context, req: ExpressRequest): Promise<ApiResponse | null> {
	if (rateLimiter === undefined) return null;

	const operation: Record<string, unknown> = context.operation;
	const cost: unknown = operation["x-impression-budget-cost"];
	if (typeof cost !== "number" || cost === 0) return null;

	const authHeader = req.headers.authorization;
	const result = await rateLimiter.budgetGuard(authHeader, cost);
	if (result.ok) return null;

	return {
		statusCode: 429,
		headers: problemJsonHeader,
		body: {
			type: "about:blank",
			title: "Too Many Requests",
			status: 429,
			detail: "Budget insufficient. Solve the challenge to obtain credits.",
			code: "challenge_required",
			challenge: result.challenge,
		},
	};
}

api.register({
	getHealth: (): ApiResponse => ({
		statusCode: 200,
		body: { status: "ok" },
		headers: { "content-type": "application/json" },
	}),
	postSessionVerify: async (context: Context, req: ExpressRequest): Promise<ApiResponse> => {
		if (rateLimiter === undefined) {
			return {
				statusCode: 500,
				headers: problemJsonHeader,
				body: createProblemDetails(500, "Internal Server Error", "Rate limiting is not configured."),
			};
		}

		const body: unknown = context.request.requestBody;
		if (typeof body !== "object" || body === null || !("challengeId" in body) || typeof body.challengeId !== "string" || !("payload" in body) || typeof body.payload !== "string") {
			return {
				statusCode: 400,
				headers: problemJsonHeader,
				body: createProblemDetails(400, "Bad Request", "Invalid request body."),
			};
		}

		try {
			const result = await rateLimiter.verifyChallenge(body.challengeId, body.payload, req.headers.authorization);
			return {
				statusCode: 200,
				body: { sessionToken: result.sessionToken },
			};
		} catch (error) {
			if (error instanceof ChallengeError) {
				return {
					statusCode: error.statusCode,
					headers: problemJsonHeader,
					body: {
						type: "about:blank",
						title: error.statusCode === 409 ? "Conflict" : "Bad Request",
						status: error.statusCode,
						detail: challengeErrorDetail(error.code),
						code: error.code,
					},
				};
			}
			throw error;
		}
	},
	postSummarize: async (context: Context, req: ExpressRequest): Promise<ApiResponse> => {
		const budgetBlock = await checkBudget(context, req);
		if (budgetBlock !== null) return budgetBlock;

		if (appConfig === undefined) {
			return {
				statusCode: 500,
				headers: problemJsonHeader,
				body: createProblemDetails(500, "Internal Server Error", "AI summarization is not configured."),
			};
		}

		const body: unknown = context.request.requestBody;
		if (typeof body !== "object" || body === null || !("cardId" in body) || typeof body.cardId !== "string" || !("answer" in body) || typeof body.answer !== "string") {
			throw new Error("Invalid request body for postSummarize");
		}
		const cardId = body.cardId;
		const questionId = "questionId" in body && typeof body.questionId === "string" ? body.questionId : undefined;
		const answer = body.answer;

		const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));

		const card = cardsById.get(cardId);
		if (card === undefined) {
			return {
				statusCode: 400,
				headers: problemJsonHeader,
				body: createProblemDetails(400, "Bad Request", `Unknown card ID: ${cardId}`),
			};
		}

		let systemContent: string;
		if (questionId !== undefined && questionId !== "") {
			const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));
			const question = questionsById.get(questionId);
			if (question === undefined) {
				return {
					statusCode: 400,
					headers: problemJsonHeader,
					body: createProblemDetails(400, "Bad Request", `Unknown question ID: ${questionId}`),
				};
			}
			systemContent = `You are a reflective coach helping someone explore their sources of meaning. Summarize their answer.\n\n- 4 to 10 words\n- Do not ask questions\n- Match the vocabulary of the user's answer\n- Do not use the word '${question.topic}' in any form\n\nTopic: ${card.source} — ${card.description}\n\nQuestion given to user: ${question.text}`;
		} else {
			systemContent = `You are a reflective coach helping someone explore their sources of meaning. Summarize their personal notes.\n\n- 4 to 10 words\n- Do not ask questions\n- Match the vocabulary of the user's notes\n\nTopic: ${card.source} — ${card.description}\n\nThese are the user's personal notes about this source of meaning.`;
		}

		try {
			const content = await createChatCompletion({
				apiKey: appConfig.xaiApiKey,
				model: "grok-4-1-fast-reasoning",
				messages: [
					{
						role: "system",
						content: systemContent,
					},
					{
						role: "user",
						content: answer,
					},
				],
				maxTokens: 30,
				temperature: 0.7,
				debugPrompt: appConfig.debugPrompt,
			});

			return { statusCode: 200, body: { summary: content } };
		} catch {
			return {
				statusCode: 502,
				headers: problemJsonHeader,
				body: createProblemDetails(502, "Bad Gateway", safeErrorDetails.upstreamAiService),
			};
		}
	},
	postInferAnswers: async (context: Context, req: ExpressRequest): Promise<ApiResponse> => {
		const budgetBlock = await checkBudget(context, req);
		if (budgetBlock !== null) return budgetBlock;

		if (appConfig === undefined) {
			return {
				statusCode: 500,
				headers: problemJsonHeader,
				body: createProblemDetails(500, "Internal Server Error", "AI inference is not configured."),
			};
		}

		const body: unknown = context.request.requestBody;
		if (typeof body !== "object" || body === null || !("cardId" in body) || typeof body.cardId !== "string" || !("questions" in body) || !Array.isArray(body.questions)) {
			throw new Error("Invalid request body for postInferAnswers");
		}
		const cardId = body.cardId;
		const items: unknown[] = body.questions;
		const questions: { questionId: string; answer: string }[] = [];
		for (const q of items) {
			if (typeof q === "object" && q !== null && "questionId" in q && typeof q.questionId === "string" && "answer" in q && typeof q.answer === "string") {
				questions.push({ questionId: q.questionId, answer: q.answer });
			}
		}

		const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
		const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));

		const card = cardsById.get(cardId);
		if (card === undefined) {
			return {
				statusCode: 400,
				headers: problemJsonHeader,
				body: createProblemDetails(400, "Bad Request", `Unknown card ID: ${cardId}`),
			};
		}

		for (const q of questions) {
			if (!questionsById.has(q.questionId)) {
				return {
					statusCode: 400,
					headers: problemJsonHeader,
					body: createProblemDetails(400, "Bad Request", `Unknown question ID: ${q.questionId}`),
				};
			}
		}

		const answeredById = new Map(questions.map((q) => [q.questionId, q.answer]));

		const promptQuestions = EXPLORE_QUESTIONS.map((q) => ({
			questionId: q.id,
			topic: q.topic,
			text: q.text,
			answer: answeredById.get(q.id) ?? "",
		}));

		const userMessage = JSON.stringify(promptQuestions);

		try {
			const content = await createChatCompletion({
				apiKey: appConfig.xaiApiKey,
				model: "grok-4-fast-non-reasoning",
				messages: [
					{
						role: "system",
						content: "You are a reflective coach helping someone explore their sources of meaning. " + `The user is reflecting on a source of meaning in their life: "${card.source}" — ${card.description}. ` + "The user will provide a JSON array of question objects about this topic. " + 'Questions with a non-empty "answer" have been answered by the user. ' + 'Questions with an empty "answer" are unanswered. ' + "Determine which unanswered questions are already addressed by the user's existing answers. " + "For each addressed question, write a short answer (1-3 sentences) mimicking the user's writing style. " + 'Return a JSON array of objects with "questionId" and "answer" fields. ' + "Only include questions that are clearly addressed. If none are addressed, return an empty array. " + "Return ONLY the JSON array, no other text.",
					},
					{
						role: "user",
						content: userMessage,
					},
				],
				maxTokens: 500,
				temperature: 0.7,
				debugPrompt: appConfig.debugPrompt,
			});

			try {
				const parsed: unknown = JSON.parse(content);
				if (!Array.isArray(parsed)) {
					return { statusCode: 200, body: { inferredAnswers: [] } };
				}
				const items: unknown[] = parsed;
				const inferredAnswers: { questionId: string; answer: string }[] = [];
				for (const item of items) {
					if (typeof item === "object" && item !== null && "questionId" in item && typeof item.questionId === "string" && "answer" in item && typeof item.answer === "string") {
						inferredAnswers.push({
							questionId: item.questionId,
							answer: item.answer,
						});
					}
				}
				return { statusCode: 200, body: { inferredAnswers } };
			} catch {
				return { statusCode: 200, body: { inferredAnswers: [] } };
			}
		} catch {
			return {
				statusCode: 502,
				headers: problemJsonHeader,
				body: createProblemDetails(502, "Bad Gateway", safeErrorDetails.upstreamAiService),
			};
		}
	},
	postReflectOnAnswer: async (context: Context, req: ExpressRequest): Promise<ApiResponse> => {
		const budgetBlock = await checkBudget(context, req);
		if (budgetBlock !== null) return budgetBlock;

		if (appConfig === undefined) {
			return {
				statusCode: 500,
				headers: problemJsonHeader,
				body: createProblemDetails(500, "Internal Server Error", "AI reflection is not configured."),
			};
		}

		const reflectBody: unknown = context.request.requestBody;
		if (typeof reflectBody !== "object" || reflectBody === null || !("cardId" in reflectBody) || typeof reflectBody.cardId !== "string" || !("questionId" in reflectBody) || typeof reflectBody.questionId !== "string" || !("answer" in reflectBody) || typeof reflectBody.answer !== "string") {
			throw new Error("Invalid request body for postReflectOnAnswer");
		}
		const reflectCardId = reflectBody.cardId;
		const questionId = reflectBody.questionId;
		const answer = reflectBody.answer;
		const suppressGuardrail = "suppressGuardrail" in reflectBody && typeof reflectBody.suppressGuardrail === "boolean" ? reflectBody.suppressGuardrail : false;

		const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
		const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));

		const card = cardsById.get(reflectCardId);
		if (card === undefined) {
			return {
				statusCode: 400,
				headers: problemJsonHeader,
				body: createProblemDetails(400, "Bad Request", `Unknown card ID: ${reflectCardId}`),
			};
		}

		const question = questionsById.get(questionId);
		if (question === undefined) {
			return {
				statusCode: 400,
				headers: problemJsonHeader,
				body: createProblemDetails(400, "Bad Request", `Unknown question ID: ${questionId}`),
			};
		}

		const responseFormat = {
			type: "json_schema" as const,
			json_schema: {
				name: "reflect_on_answer",
				strict: true,
				schema: {
					type: "object",
					properties: {
						type: {
							type: "string",
							enum: suppressGuardrail ? ["thought_bubble", "none"] : ["guardrail", "thought_bubble", "none"],
						},
						message: { type: "string" },
					},
					required: ["type", "message"],
					additionalProperties: false,
				},
			},
		};

		const systemContent = suppressGuardrail
			? `You are a reflective coach helping someone explore their sources of meaning. You have just read someone's answer to a reflective question.

Classify the answer into one of two categories:

1. "thought_bubble" — The answer is substantive and contains an interesting thread worth pulling on. Write a brief, warm Socratic follow-up question that references something the user actually wrote. The goal is to help them go deeper into their own thinking.

2. "none" — The answer is fine as-is and no follow-up is warranted.

If type is "thought_bubble", message should be the follow-up question. If type is "none", set message to "".`
			: `You are a reflective coach helping someone explore their sources of meaning. You have just read someone's answer to a reflective question.

Classify the answer into one of three categories:

1. "guardrail" — The answer is dismissive, vague, evasive, or essentially empty. Examples: "I don't know", "Sure", "It's important to me", "Yes"/"No" with nothing else. Write a brief, warm follow-up nudge that encourages the person to share a bit more.

2. "thought_bubble" — The answer is substantive and contains an interesting thread worth pulling on. Write a brief, warm Socratic follow-up question that references something the user actually wrote. The goal is to help them go deeper into their own thinking.

3. "none" — The answer is substantive and no follow-up is warranted.

When in doubt between "guardrail" and "none", lean toward "none". The guardrail is only for clearly throwaway responses.
When in doubt between "thought_bubble" and "none", lean toward "thought_bubble". Offering a thoughtful follow-up is almost always welcome.

If type is "guardrail" or "thought_bubble", message should be the follow-up question/nudge. If type is "none", set message to "".`;

		try {
			const content = await createChatCompletion({
				apiKey: appConfig.xaiApiKey,
				model: "grok-4-fast-non-reasoning",
				messages: [
					{
						role: "system",
						content: systemContent,
					},
					{
						role: "user",
						content: `Card: ${card.source} — ${card.description}\nQuestion topic: ${question.topic}\nQuestion: ${question.text}\nAnswer: ${answer}`,
					},
				],
				maxTokens: 200,
				temperature: 0.7,
				responseFormat,
				debugPrompt: appConfig.debugPrompt,
			});

			try {
				const parsed: unknown = JSON.parse(content);
				if (typeof parsed !== "object" || parsed === null) {
					return { statusCode: 200, body: { type: "none", message: "" } };
				}
				let type = "type" in parsed && typeof parsed.type === "string" ? parsed.type : "none";
				let message = "message" in parsed && typeof parsed.message === "string" ? parsed.message : "";

				if (type !== "guardrail" && type !== "thought_bubble" && type !== "none") {
					type = "none";
					message = "";
				}

				if ((type === "guardrail" || type === "thought_bubble") && message.trim() === "") {
					type = "none";
					message = "";
				}

				if (type === "none") {
					message = "";
				}

				return { statusCode: 200, body: { type, message } };
			} catch {
				return { statusCode: 200, body: { type: "none", message: "" } };
			}
		} catch {
			return {
				statusCode: 502,
				headers: problemJsonHeader,
				body: createProblemDetails(502, "Bad Gateway", safeErrorDetails.upstreamAiService),
			};
		}
	},
	postSynthesize: async (context: Context, req: ExpressRequest): Promise<ApiResponse> => {
		const budgetBlock = await checkBudget(context, req);
		if (budgetBlock !== null) return budgetBlock;

		if (appConfig === undefined) {
			return {
				statusCode: 500,
				headers: problemJsonHeader,
				body: createProblemDetails(500, "Internal Server Error", "AI synthesis is not configured."),
			};
		}

		const body: unknown = context.request.requestBody;
		if (typeof body !== "object" || body === null || !("cardId" in body) || typeof body.cardId !== "string" || !("questions" in body) || !Array.isArray(body.questions)) {
			throw new Error("Invalid request body for postSynthesize");
		}
		const cardId = body.cardId;
		const items: unknown[] = body.questions;
		const questions: { questionId: string; answer: string }[] = [];
		for (const q of items) {
			if (typeof q === "object" && q !== null && "questionId" in q && typeof q.questionId === "string" && "answer" in q && typeof q.answer === "string") {
				questions.push({ questionId: q.questionId, answer: q.answer });
			}
		}

		const selectedStatementIds: string[] = [];
		if ("selectedStatements" in body && Array.isArray(body.selectedStatements)) {
			for (const s of body.selectedStatements) {
				if (typeof s === "string") {
					selectedStatementIds.push(s);
				}
			}
		}

		const freeformNote = "freeformNote" in body && typeof body.freeformNote === "string" ? body.freeformNote.trim() : "";

		const cardsById = new Map(MEANING_CARDS.map((c) => [c.id, c]));
		const questionsById = new Map(EXPLORE_QUESTIONS.map((q) => [q.id, q]));

		const card = cardsById.get(cardId);
		if (card === undefined) {
			return {
				statusCode: 400,
				headers: problemJsonHeader,
				body: createProblemDetails(400, "Bad Request", `Unknown card ID: ${cardId}`),
			};
		}

		for (const q of questions) {
			if (!questionsById.has(q.questionId)) {
				return {
					statusCode: 400,
					headers: problemJsonHeader,
					body: createProblemDetails(400, "Bad Request", `Unknown question ID: ${q.questionId}`),
				};
			}
		}

		const selectedStatementSet = new Set(selectedStatementIds);
		const cardStatements = MEANING_STATEMENTS.filter((s) => s.meaningId === cardId);
		let checkedDescriptions = cardStatements.filter((s) => selectedStatementSet.has(s.id)).map((s) => s.statement);
		if (checkedDescriptions.length === 0) {
			checkedDescriptions = [card.description];
		}

		const topicContext = `The user is reflecting the following statements related to ${card.source.toLowerCase()}:\n${checkedDescriptions.map((d) => `- ${d}`).join("\n")}`;

		const answeredPairs: string[] = [];
		for (const q of questions) {
			if (q.answer.trim() === "") continue;
			const question = questionsById.get(q.questionId);
			if (question === undefined) continue;
			answeredPairs.push(`${question.topic}: ${question.text}\nAnswer: ${q.answer}`);
		}

		if (freeformNote !== "") {
			answeredPairs.push(`Additional notes:\n${freeformNote}`);
		}

		const userMessage = answeredPairs.join("\n\n");

		try {
			const content = await createChatCompletion({
				apiKey: appConfig.xaiApiKey,
				model: "grok-4.20-beta-0309-reasoning",
				messages: [
					{
						role: "system",
						content: "You are a reflective coach helping someone explore their sources of meaning. " + topicContext + "\n\nWrite down the main points from this personal conversation, focusing on insights, opportunities, and possible ways of action or decision. " + "Be concise and direct. " + "Focus on important ideas and concepts, not including every single detail. " + "Write in the first person, as if the user is writing about themselves. " + "Do not refer to 'this statement' or 'my choices'; focus on what the user is conveying. " + "Do not ask questions. Do not use bullet points or numbered lists — write in flowing prose. " + "4 to 7 sentences.",
					},
					{
						role: "user",
						content: userMessage,
					},
				],
				maxTokens: 500,
				temperature: 0.7,
				debugPrompt: appConfig.debugPrompt,
				reasoningEffort: "low",
			});

			return { statusCode: 200, body: { synthesis: content } };
		} catch {
			return {
				statusCode: 502,
				headers: problemJsonHeader,
				body: createProblemDetails(502, "Bad Gateway", safeErrorDetails.upstreamAiService),
			};
		}
	},
	postReportHtml: async (context: Context, req: ExpressRequest, res: Response): Promise<void> => {
		const sessionExport: unknown = req.body;
		if (typeof sessionExport !== "string" || sessionExport === "") {
			res
				.status(400)
				.type("application/problem+json")
				.send(JSON.stringify(createProblemDetails(400, "Bad Request", "Request body must be a non-empty session export string.")));
			return;
		}

		let html: string;
		try {
			html = await renderReportHtml(req.app.locals.vite, sessionExport);
		} catch {
			res
				.status(400)
				.type("application/problem+json")
				.send(JSON.stringify(createProblemDetails(400, "Bad Request", safeErrorDetails.invalidSessionData)));
			return;
		}

		res.status(200).type("text/html").setHeader("Content-Disposition", 'attachment; filename="impression-report.html"').send(html);
	},
	postReportPdf: async (context: Context, req: ExpressRequest, res: Response): Promise<void> => {
		// Daily PDF limit check (before budget, to avoid wasting credits)
		let pdfRemaining: number | null = null;
		if (rateLimiter !== undefined) {
			const limitResult = rateLimiter.checkPdfDailyLimit(req.headers.authorization);
			pdfRemaining = limitResult.remaining;
			if (!limitResult.allowed) {
				const retryAfterSeconds = Math.ceil(limitResult.retryAfterMs / 1000);
				res
					.status(429)
					.type("application/problem+json")
					.setHeader("X-Impression-PDF-Downloads-Remaining", "0")
					.setHeader("Retry-After", retryAfterSeconds.toString())
					.send(
						JSON.stringify({
							type: "about:blank",
							title: "Too Many Requests",
							status: 429,
							detail: `You have reached the daily limit of ${MAX_PDF_DOWNLOADS_PER_DAY.toString()} successful PDF downloads.`,
							code: "daily_limit_exceeded",
						}),
					);
				return;
			}
		}

		const budgetBlock = await checkBudget(context, req);
		if (budgetBlock !== null) {
			if (rateLimiter === undefined || pdfRemaining === null) {
				sendApiResponse(res, budgetBlock);
				return;
			}
			const responseWithHeaders: ApiResponse = {
				...budgetBlock,
				headers: { ...(budgetBlock.headers ?? {}), "X-Impression-PDF-Downloads-Remaining": pdfRemaining.toString() },
			};
			sendApiResponse(res, responseWithHeaders);
			return;
		}

		const apiKey = process.env.DOCRAPTOR_API_KEY;
		if (apiKey === undefined || apiKey === "") {
			const response = res.status(500).type("application/problem+json");
			if (pdfRemaining !== null) {
				response.setHeader("X-Impression-PDF-Downloads-Remaining", pdfRemaining.toString());
			}
			response.send(JSON.stringify(createProblemDetails(500, "Internal Server Error", "PDF generation is not configured.")));
			return;
		}

		const sessionExport: unknown = req.body;
		if (typeof sessionExport !== "string" || sessionExport === "") {
			const response = res.status(400).type("application/problem+json");
			if (pdfRemaining !== null) {
				response.setHeader("X-Impression-PDF-Downloads-Remaining", pdfRemaining.toString());
			}
			response.send(JSON.stringify(createProblemDetails(400, "Bad Request", "Request body must be a non-empty session export string.")));
			return;
		}

		let html: string;
		try {
			html = await renderReportHtml(req.app.locals.vite, sessionExport);
		} catch {
			const response = res.status(400).type("application/problem+json");
			if (pdfRemaining !== null) {
				response.setHeader("X-Impression-PDF-Downloads-Remaining", pdfRemaining.toString());
			}
			response.send(JSON.stringify(createProblemDetails(400, "Bad Request", safeErrorDetails.invalidSessionData)));
			return;
		}

		const liveMode = process.env.DOCRAPTOR_LIVE;
		const testMode = liveMode === undefined || liveMode === "";

		try {
			const pdf = await callDocRaptor(html, apiKey, testMode);
			if (rateLimiter !== undefined) {
				pdfRemaining = rateLimiter.recordPdfDownload(req.headers.authorization);
			}
			const response = res.status(200).type("application/pdf").setHeader("Content-Disposition", 'attachment; filename="impression-report.pdf"');
			if (pdfRemaining !== null) {
				response.setHeader("X-Impression-PDF-Downloads-Remaining", pdfRemaining.toString());
			}
			response.send(pdf);
		} catch {
			const response = res.status(502).type("application/problem+json");
			if (pdfRemaining !== null) {
				response.setHeader("X-Impression-PDF-Downloads-Remaining", pdfRemaining.toString());
			}
			response.send(JSON.stringify(createProblemDetails(502, "Bad Gateway", safeErrorDetails.pdfGenerationService)));
		}
	},
	validationFail: (context: Context): ApiResponse => {
		const errors = extractValidationErrors(context);
		return {
			statusCode: 400,
			headers: problemJsonHeader,
			body: createProblemDetails(400, "Bad Request", firstErrorMessage(errors), errors),
		};
	},
	notFound: (): ApiResponse => ({
		statusCode: 404,
		headers: problemJsonHeader,
		body: createProblemDetails(404, "Not Found", "No API endpoint matched this request."),
	}),
	methodNotAllowed: (): ApiResponse => ({
		statusCode: 405,
		headers: problemJsonHeader,
		body: createProblemDetails(405, "Method Not Allowed", "The endpoint does not allow this HTTP method."),
	}),
	postResponseHandler: (context: Context): ApiResponse => {
		const response = normalizeApiResponse(context.response);
		return validateOperationResponse(context, response);
	},
});

async function ensureApiInitialized(): Promise<void> {
	initializePromise ??= api.init();
	await initializePromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function validateBudgetCosts(): void {
	const doc: unknown = api.document;
	if (!isRecord(doc)) return;
	const paths = doc.paths;
	if (!isRecord(paths)) return;
	for (const [pathKey, methods] of Object.entries(paths)) {
		if (!isRecord(methods)) continue;
		for (const [method, operation] of Object.entries(methods)) {
			if (!isRecord(operation) || !("operationId" in operation)) continue;
			const cost: unknown = operation["x-impression-budget-cost"];
			if (cost === undefined) {
				throw new Error(`Operation ${method.toUpperCase()} ${pathKey} is missing x-impression-budget-cost`);
			}
			if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 0) {
				throw new Error(`Operation ${method.toUpperCase()} ${pathKey} has invalid x-impression-budget-cost: ${JSON.stringify(cost)}`);
			}
		}
	}
}

export async function createApiMiddleware(config?: AppConfig, limiter?: RateLimiter): Promise<RequestHandler> {
	appConfig = config;
	rateLimiter = limiter;
	await ensureApiInitialized();

	validateBudgetCosts();

	const configuredOrigin = process.env.ORIGIN;

	return async (req: ExpressRequest, res: Response, next): Promise<void> => {
		try {
			if (shouldCheckOrigin(req.method) && !isAllowedOrigin(req, configuredOrigin)) {
				res
					.status(403)
					.type("application/problem+json")
					.send(
						JSON.stringify({
							...createProblemDetails(403, "Forbidden", "Origin not allowed."),
							code: "origin_not_allowed",
						}),
					);
				return;
			}

			const result: unknown = await api.handleRequest(toOpenApiRequest(req), req, res);
			if (res.headersSent) {
				return;
			}

			sendApiResponse(res, normalizeApiResponse(result));
		} catch (error) {
			next(error);
		}
	};
}
