import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { assembleReportData, callDocRaptor } from "./pdf-report.ts";
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";

// --- assembleReportData ---

function makeSessionExport(data: Record<string, unknown>): string {
	return JSON.stringify({
		version: "somecam-v2",
		sessions: [{ id: "test-session", name: "Test", createdAt: "2025-01-01T00:00:00Z", lastUpdatedAt: "2025-01-01T00:00:00Z", data }],
	});
}

describe("assembleReportData", () => {
	it("builds reports from a valid session export", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
			explore: {
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "Understanding myself", prefilledAnswer: "", submitted: true }],
			},
			summaries: {
				"self-knowledge:interpretation": { answer: "Understanding myself", summary: "Self-understanding" },
			},
			freeform: {
				"self-knowledge": "My personal notes",
			},
		});

		const reports = assembleReportData(json);

		expect(reports).toHaveLength(1);
		expect(reports[0].card.id).toBe("self-knowledge");
		expect(reports[0].card.source).toBe("Self-knowledge");
		expect(reports[0].freeformNote).toBe("My personal notes");

		const interpretationQ = reports[0].questions.find((q) => q.topic === "Interpretation");
		expect(interpretationQ?.answer).toBe("Understanding myself");

		expect(reports[0].questions).toHaveLength(EXPLORE_QUESTIONS.length);
	});

	it("skips unknown card IDs", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge", "nonexistent-card"],
		});

		const reports = assembleReportData(json);
		expect(reports).toHaveLength(1);
		expect(reports[0].card.id).toBe("self-knowledge");
	});

	it("handles missing explore/summaries/freeform gracefully", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
		});

		const reports = assembleReportData(json);
		expect(reports).toHaveLength(1);
		expect(reports[0].freeformNote).toBe("");
		for (const q of reports[0].questions) {
			expect(q.answer).toBe("");
		}
	});

	it("throws on invalid JSON", () => {
		expect(() => assembleReportData("not json")).toThrow();
	});

	it("throws on wrong version", () => {
		expect(() => assembleReportData(JSON.stringify({ version: "somecam-v1", sessions: [] }))).toThrow("Invalid session export format.");
	});

	it("throws on empty sessions array", () => {
		expect(() => assembleReportData(JSON.stringify({ version: "somecam-v2", sessions: [] }))).toThrow("Invalid session export format.");
	});

	it("throws when chosen is missing", () => {
		expect(() => assembleReportData(makeSessionExport({}))).toThrow("Session has no chosen cards.");
	});

	it("includes selected descriptions in report", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
			explore: {
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "Understanding myself", prefilledAnswer: "", submitted: true }],
			},
			statements: {
				"self-knowledge": ["6", "34"],
			},
		});

		const reports = assembleReportData(json);
		expect(reports[0].selectedDescriptions).toEqual(["To understand myself and my behaviour is important for me", "Viewing myself critically is important to me"]);
	});

	it("returns empty selectedDescriptions when descriptions data is missing", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
		});

		const reports = assembleReportData(json);
		expect(reports[0].selectedDescriptions).toEqual([]);
	});

	it("includes synthesis when cached fingerprint matches", () => {
		const fingerprint = "Understanding myself";
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
			explore: {
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "Understanding myself", prefilledAnswer: "", submitted: true }],
			},
			summaries: {
				"self-knowledge:synthesis": { answer: fingerprint, summary: "A beautiful synthesis" },
			},
		});

		const reports = assembleReportData(json);
		expect(reports[0].synthesis).toBe("A beautiful synthesis");
	});

	it("returns empty synthesis when fingerprint does not match", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
			explore: {
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "New answer", prefilledAnswer: "", submitted: true }],
			},
			summaries: {
				"self-knowledge:synthesis": { answer: "Old answer", summary: "Stale synthesis" },
			},
		});

		const reports = assembleReportData(json);
		expect(reports[0].synthesis).toBe("");
	});

	it("returns empty synthesis when no synthesis cache entry exists", () => {
		const json = makeSessionExport({
			chosen: ["self-knowledge"],
		});

		const reports = assembleReportData(json);
		expect(reports[0].synthesis).toBe("");
	});
});

// --- callDocRaptor ---

const mswServer = setupServer(http.all(/^http:\/\/127\.0\.0\.1/, () => passthrough()));

describe("callDocRaptor", () => {
	beforeAll(() => {
		mswServer.listen({ onUnhandledRequest: "error" });
	});
	afterEach(() => {
		mswServer.resetHandlers();
	});
	afterAll(() => {
		mswServer.close();
	});

	it("sends correct request structure and auth", async () => {
		let capturedRequest: Request | undefined;
		let capturedBody: unknown;

		mswServer.use(
			http.post("https://api.docraptor.com/docs", async ({ request }) => {
				capturedRequest = request;
				capturedBody = await request.json();
				return new HttpResponse(Buffer.from("%PDF-1.4 fake"), {
					headers: { "Content-Type": "application/pdf" },
				});
			}),
		);

		const result = await callDocRaptor("<html>test</html>", "my-api-key", false);

		expect(capturedRequest).toBeDefined();
		expect(capturedRequest!.headers.get("Content-Type")).toBe("application/json");

		const authHeader = capturedRequest!.headers.get("Authorization");
		const decoded = Buffer.from(authHeader!.replace("Basic ", ""), "base64").toString();
		expect(decoded).toBe("my-api-key:");

		expect(capturedBody).toEqual({
			type: "pdf",
			test: false,
			document_content: "<html>test</html>",
			prince_options: { media: "print" },
		});

		expect(Buffer.isBuffer(result)).toBe(true);
	});

	it("sends test: true in test mode", async () => {
		let capturedBody: unknown;

		mswServer.use(
			http.post("https://api.docraptor.com/docs", async ({ request }) => {
				capturedBody = await request.json();
				return new HttpResponse(Buffer.from("%PDF-1.4 fake"), {
					headers: { "Content-Type": "application/pdf" },
				});
			}),
		);

		await callDocRaptor("<html>test</html>", "key", true);
		expect(capturedBody).toHaveProperty("test", true);
	});

	it("throws on non-OK response", async () => {
		mswServer.use(
			http.post("https://api.docraptor.com/docs", () => {
				return new HttpResponse("Unprocessable Entity", { status: 422 });
			}),
		);

		await expect(callDocRaptor("<html>bad</html>", "key", true)).rejects.toThrow("DocRaptor returned 422");
	});
});
