// @vitest-environment node

import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession, deleteSession, detectSessionPhase, ensureSessionsInitialized, exportProgressData, formatSessionDate, getActiveSessionId, hasVisitedExploreComplete, importProgressData, listSessions, loadChosenCardIds, loadExploreData, loadLlmTestState, loadRanking, loadSwipeProgress, lookupCachedSummary, lookupCachedSynthesis, markExploreCompleteVisited, renameSession, saveCachedSummary, saveCachedSynthesis, saveChosenCardIds, saveExploreData, saveLlmTestState, saveRanking, saveSwipeProgress } from "./store.ts";

function sid(): string {
	return getActiveSessionId();
}
import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";

const DEFAULT_QUESTION_ID = EXPLORE_QUESTIONS[0].id;

let currentWindow: Window | null = null;

function setGlobalDom(win: Window): void {
	Object.defineProperty(globalThis, "window", {
		value: win,
		configurable: true,
	});
	Object.defineProperty(globalThis, "document", {
		value: win.document,
		configurable: true,
	});
	Object.defineProperty(globalThis, "localStorage", {
		value: win.localStorage,
		configurable: true,
	});
}

beforeEach(() => {
	currentWindow = new Window({ url: "http://localhost" });
	setGlobalDom(currentWindow);
	ensureSessionsInitialized();
});

afterEach(() => {
	currentWindow?.close();
	currentWindow = null;
});

function activeKey(suffix: string): string {
	return `somecam-${getActiveSessionId()}-${suffix}`;
}

describe("loadChosenCardIds/saveChosenCardIds", () => {
	it("returns null when key is absent", () => {
		expect(loadChosenCardIds(sid())).toBeNull();
	});

	it("returns null for corrupt JSON", () => {
		localStorage.setItem(activeKey("chosen"), "{");
		expect(loadChosenCardIds(sid())).toBeNull();
	});

	it("returns null for empty array", () => {
		localStorage.setItem(activeKey("chosen"), JSON.stringify([]));
		expect(loadChosenCardIds(sid())).toBeNull();
	});

	it("returns null for non-array JSON", () => {
		localStorage.setItem(activeKey("chosen"), JSON.stringify("not-an-array"));
		expect(loadChosenCardIds(sid())).toBeNull();
	});

	it("returns null for arrays with non-string values", () => {
		localStorage.setItem(activeKey("chosen"), JSON.stringify(["self-knowledge", 42]));
		expect(loadChosenCardIds(sid())).toBeNull();
	});

	it("round-trips a saved array of card IDs", () => {
		saveChosenCardIds(sid(), ["self-knowledge", "community"]);
		expect(loadChosenCardIds(sid())).toEqual(["self-knowledge", "community"]);
	});

	it("preserves order of IDs", () => {
		saveChosenCardIds(sid(), ["community", "self-knowledge", "challenge"]);
		expect(loadChosenCardIds(sid())).toEqual(["community", "self-knowledge", "challenge"]);
	});
});

describe("loadSwipeProgress/saveSwipeProgress", () => {
	it("returns null when key is absent", () => {
		expect(loadSwipeProgress(sid())).toBeNull();
	});

	it("returns null when shuffledCardIds is missing", () => {
		localStorage.setItem(
			activeKey("progress"),
			JSON.stringify({
				swipeHistory: [],
			}),
		);
		expect(loadSwipeProgress(sid())).toBeNull();
	});

	it("returns null when shuffledCardIds is empty", () => {
		localStorage.setItem(
			activeKey("progress"),
			JSON.stringify({
				shuffledCardIds: [],
				swipeHistory: [],
			}),
		);
		expect(loadSwipeProgress(sid())).toBeNull();
	});

	it("returns null when swipeHistory is missing", () => {
		localStorage.setItem(
			activeKey("progress"),
			JSON.stringify({
				shuffledCardIds: ["self-knowledge"],
			}),
		);
		expect(loadSwipeProgress(sid())).toBeNull();
	});

	it("returns null when swipeHistory has invalid direction", () => {
		localStorage.setItem(
			activeKey("progress"),
			JSON.stringify({
				shuffledCardIds: ["self-knowledge"],
				swipeHistory: [{ cardId: "self-knowledge", direction: "keep" }],
			}),
		);
		expect(loadSwipeProgress(sid())).toBeNull();
	});

	it("returns null when swipeHistory has non-string cardId", () => {
		localStorage.setItem(
			activeKey("progress"),
			JSON.stringify({
				shuffledCardIds: ["self-knowledge"],
				swipeHistory: [{ cardId: 123, direction: "agree" }],
			}),
		);
		expect(loadSwipeProgress(sid())).toBeNull();
	});

	it("round-trips saved progress", () => {
		saveSwipeProgress(sid(), {
			shuffledCardIds: ["self-knowledge", "community"],
			swipeHistory: [{ cardId: "self-knowledge", direction: "agree" }],
		});

		expect(loadSwipeProgress(sid())).toEqual({
			shuffledCardIds: ["self-knowledge", "community"],
			swipeHistory: [{ cardId: "self-knowledge", direction: "agree" }],
		});
	});
});

describe("loadExploreData/saveExploreData", () => {
	it("returns null when key is absent", () => {
		expect(loadExploreData(sid())).toBeNull();
	});

	it("returns null for corrupt JSON", () => {
		localStorage.setItem(activeKey("explore"), "{");
		expect(loadExploreData(sid())).toBeNull();
	});

	it("returns null for malformed explore entries", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: "true",
					},
				],
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("round-trips saved explore data", () => {
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [
					{
						questionId: "interpretation",
						userAnswer: "My answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: "",
						submittedAfterGuardrail: false,
						thoughtBubbleText: "",
						thoughtBubbleAcknowledged: false,
						autoFilledPending: false,
					},
				],
				freeformNote: "",
				statementSelections: [],
			},
		});

		expect(loadExploreData(sid())).toEqual({
			"self-knowledge": {
				entries: [
					{
						questionId: "interpretation",
						userAnswer: "My answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: "",
						submittedAfterGuardrail: false,
						thoughtBubbleText: "",
						thoughtBubbleAcknowledged: false,
						autoFilledPending: false,
					},
				],
				freeformNote: "",
				statementSelections: [],
			},
		});
	});

	it("fills defaults for entries that lack reflection fields", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
					},
				],
			}),
		);

		expect(loadExploreData(sid())).toEqual({
			"self-knowledge": {
				entries: [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: "",
						submittedAfterGuardrail: false,
						thoughtBubbleText: "",
						thoughtBubbleAcknowledged: false,
						autoFilledPending: false,
					},
				],
				freeformNote: "",
				statementSelections: [],
			},
		});
	});

	it("preserves existing guardrail fields", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: "Can you go deeper?",
						submittedAfterGuardrail: true,
						thoughtBubbleText: "What about X?",
						thoughtBubbleAcknowledged: true,
					},
				],
			}),
		);

		expect(loadExploreData(sid())).toEqual({
			"self-knowledge": {
				entries: [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: "Can you go deeper?",
						submittedAfterGuardrail: true,
						thoughtBubbleText: "What about X?",
						thoughtBubbleAcknowledged: true,
						autoFilledPending: false,
					},
				],
				freeformNote: "",
				statementSelections: [],
			},
		});
	});

	it("returns null when guardrailText is not a string", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						guardrailText: 123,
					},
				],
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("returns null when submittedAfterGuardrail is not a boolean", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						submittedAfterGuardrail: "yes",
					},
				],
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("preserves existing thoughtBubbleText", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						thoughtBubbleText: "What about your relationship with X?",
					},
				],
			}),
		);

		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].entries[0].thoughtBubbleText).toBe("What about your relationship with X?");
	});

	it("preserves existing thoughtBubbleAcknowledged", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						thoughtBubbleAcknowledged: true,
					},
				],
			}),
		);

		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].entries[0].thoughtBubbleAcknowledged).toBe(true);
	});

	it("returns null when thoughtBubbleText is not a string", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						thoughtBubbleText: 123,
					},
				],
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("returns null when thoughtBubbleAcknowledged is not a boolean", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						thoughtBubbleAcknowledged: "yes",
					},
				],
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("defaults autoFilledPending to false when absent", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
					},
				],
			}),
		);
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].entries[0].autoFilledPending).toBe(false);
	});

	it("returns null when autoFilledPending is not a boolean", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [
					{
						questionId: "interpretation",
						userAnswer: "answer",
						prefilledAnswer: "",
						submitted: true,
						autoFilledPending: "yes",
					},
				],
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("returns null when a card entry bucket is not an array", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": {
					questionId: "interpretation",
				},
			}),
		);
		expect(loadExploreData(sid())).toBeNull();
	});
});

describe("lookupCachedSummary/saveCachedSummary", () => {
	it("returns null when key is absent", () => {
		expect(lookupCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", questionId: "interpretation" })).toBeNull();
	});

	it("returns null for corrupt JSON", () => {
		localStorage.setItem(activeKey("summaries"), "{");
		expect(lookupCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", questionId: "interpretation" })).toBeNull();
	});

	it("returns null on answer mismatch", () => {
		saveCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", summary: "My summary", questionId: "interpretation" });
		expect(lookupCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "Different answer", questionId: "interpretation" })).toBeNull();
	});

	it("round-trips saved summary", () => {
		saveCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", summary: "My summary", questionId: "interpretation" });
		expect(lookupCachedSummary({ sessionId: sid(), cardId: "self-knowledge", answer: "My answer", questionId: "interpretation" })).toBe("My summary");
	});
});

describe("lookupCachedSynthesis/saveCachedSynthesis", () => {
	it("returns null when key is absent", () => {
		expect(lookupCachedSynthesis({ sessionId: sid(), cardId: "self-knowledge", fingerprint: "some fingerprint" })).toBeNull();
	});

	it("returns null on fingerprint mismatch", () => {
		saveCachedSynthesis({ sessionId: sid(), cardId: "self-knowledge", fingerprint: "fingerprint1", synthesis: "My synthesis" });
		expect(lookupCachedSynthesis({ sessionId: sid(), cardId: "self-knowledge", fingerprint: "different" })).toBeNull();
	});

	it("round-trips saved synthesis", () => {
		saveCachedSynthesis({ sessionId: sid(), cardId: "self-knowledge", fingerprint: "my-fingerprint", synthesis: "My synthesis" });
		expect(lookupCachedSynthesis({ sessionId: sid(), cardId: "self-knowledge", fingerprint: "my-fingerprint" })).toBe("My synthesis");
	});
});

describe("loadLlmTestState/saveLlmTestState", () => {
	it("returns null when key is absent", () => {
		expect(loadLlmTestState()).toBeNull();
	});

	it("returns null when cardId is not a string", () => {
		localStorage.setItem(
			"somecam-llm-test",
			JSON.stringify({
				cardId: 42,
				rows: [{ questionId: "interpretation", answer: "answer" }],
			}),
		);
		expect(loadLlmTestState()).toBeNull();
	});

	it("returns null when rows is missing", () => {
		localStorage.setItem(
			"somecam-llm-test",
			JSON.stringify({
				cardId: "self-knowledge",
			}),
		);
		expect(loadLlmTestState()).toBeNull();
	});

	it("returns null when rows is empty", () => {
		localStorage.setItem(
			"somecam-llm-test",
			JSON.stringify({
				cardId: "self-knowledge",
				rows: [],
			}),
		);
		expect(loadLlmTestState()).toBeNull();
	});

	it("normalizes non-object rows", () => {
		localStorage.setItem(
			"somecam-llm-test",
			JSON.stringify({
				cardId: "self-knowledge",
				rows: [null],
			}),
		);
		expect(loadLlmTestState()).toEqual({
			cardId: "self-knowledge",
			rows: [{ questionId: DEFAULT_QUESTION_ID, answer: "" }],
			selectedStatements: [],
			freeformNote: "",
		});
	});

	it("normalizes rows with non-string questionId", () => {
		localStorage.setItem(
			"somecam-llm-test",
			JSON.stringify({
				cardId: "self-knowledge",
				rows: [{ questionId: 99, answer: "answer" }],
			}),
		);
		expect(loadLlmTestState()).toEqual({
			cardId: "self-knowledge",
			rows: [{ questionId: DEFAULT_QUESTION_ID, answer: "answer" }],
			selectedStatements: [],
			freeformNote: "",
		});
	});

	it("normalizes rows with non-string answer", () => {
		localStorage.setItem(
			"somecam-llm-test",
			JSON.stringify({
				cardId: "self-knowledge",
				rows: [{ questionId: "interpretation", answer: 99 }],
			}),
		);
		expect(loadLlmTestState()).toEqual({
			cardId: "self-knowledge",
			rows: [{ questionId: "interpretation", answer: "" }],
			selectedStatements: [],
			freeformNote: "",
		});
	});

	it("round-trips saved state", () => {
		saveLlmTestState({
			cardId: "self-knowledge",
			rows: [
				{ questionId: "interpretation", answer: "answer 1" },
				{ questionId: "importance", answer: "answer 2" },
			],
			selectedStatements: ["3", "5"],
			freeformNote: "some notes",
		});

		expect(loadLlmTestState()).toEqual({
			cardId: "self-knowledge",
			rows: [
				{ questionId: "interpretation", answer: "answer 1" },
				{ questionId: "importance", answer: "answer 2" },
			],
			selectedStatements: ["3", "5"],
			freeformNote: "some notes",
		});
	});
});

describe("freeform notes in ExploreData", () => {
	it("defaults freeformNote to empty string when freeform key is absent", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("");
	});

	it("defaults freeformNote to empty string for corrupt freeform JSON", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		localStorage.setItem(activeKey("freeform"), "{");
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("");
	});

	it("round-trips freeform notes through ExploreData", () => {
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "Some extra thoughts",
				statementSelections: [],
			},
		});
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("Some extra thoughts");
	});

	it("round-trips empty freeformNote", () => {
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				statementSelections: [],
			},
		});
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("");
	});
});

describe("exportProgressData/importProgressData", () => {
	it("exportProgressData returns v2 format with empty session data", () => {
		const result = JSON.parse(exportProgressData());
		expect(result.version).toBe("somecam-v2");
		expect(Array.isArray(result.sessions)).toBe(true);
		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0].data).toEqual({});
	});

	it("exportProgressData includes session data", () => {
		saveChosenCardIds(sid(), ["self-knowledge", "community"]);
		const result = JSON.parse(exportProgressData());
		expect(result.sessions[0].data.chosen).toEqual(["self-knowledge", "community"]);
	});

	it("exportProgressData exports all sessions", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const secondId = createSession("Second");
		saveChosenCardIds(sid(), ["community"]);

		const result = JSON.parse(exportProgressData());
		expect(result.sessions).toHaveLength(2);
		const secondSession = result.sessions.find((s: any) => s.id === secondId);
		expect(secondSession).toBeDefined();
		expect(secondSession.data.chosen).toEqual(["community"]);
	});

	it("importProgressData v2 merges sessions by UUID", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const currentId = getActiveSessionId();
		const currentSessions = listSessions();

		const v2Data = JSON.stringify({
			version: "somecam-v2",
			sessions: [
				{
					id: currentId,
					name: "Updated Name",
					createdAt: currentSessions[0].createdAt,
					data: {
						chosen: ["community", "challenge"],
					},
				},
			],
		});

		importProgressData(v2Data);

		expect(loadChosenCardIds(sid())).toEqual(["community", "challenge"]);
		const sessions = listSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].name).toBe("Updated Name");
	});

	it("importProgressData v2 adds new sessions", () => {
		saveChosenCardIds(sid(), ["existing-card"]);

		const v2Data = JSON.stringify({
			version: "somecam-v2",
			sessions: [
				{
					id: "new-session-uuid",
					name: "Imported Session",
					createdAt: "2026-01-01T00:00:00.000Z",
					data: {
						chosen: ["creativity"],
					},
				},
			],
		});

		importProgressData(v2Data);

		const sessions = listSessions();
		expect(sessions).toHaveLength(2);
		const imported = sessions.find((s) => s.id === "new-session-uuid");
		expect(imported).toBeDefined();
		expect(imported?.name).toBe("Imported Session");
	});

	it("importProgressData v2 round-trips: export → import restores data", () => {
		saveChosenCardIds(sid(), ["self-knowledge", "community"]);
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "notes",
				statementSelections: [],
			},
		});

		const exported = exportProgressData();
		const activeId = getActiveSessionId();

		// Clear active session data
		for (const suffix of ["progress", "narrowdown", "chosen", "explore", "summaries", "freeform", "statements"]) {
			localStorage.removeItem(`somecam-${activeId}-${suffix}`);
		}
		expect(loadChosenCardIds(sid())).toBeNull();

		importProgressData(exported);

		localStorage.setItem("somecam-active-session", activeId);
		expect(loadChosenCardIds(sid())).toEqual(["self-knowledge", "community"]);
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("notes");
	});

	it("importProgressData v2 clears data keys not present in import", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "notes",
				statementSelections: [],
			},
		});
		const currentId = getActiveSessionId();

		const v2Data = JSON.stringify({
			version: "somecam-v2",
			sessions: [
				{
					id: currentId,
					name: "Updated",
					createdAt: new Date().toISOString(),
					data: {
						chosen: ["community"],
					},
				},
			],
		});

		importProgressData(v2Data);

		expect(loadChosenCardIds(sid())).toEqual(["community"]);
		expect(loadExploreData(sid())).toBeNull();
	});

	it("importProgressData throws on invalid JSON", () => {
		expect(() => {
			importProgressData("{");
		}).toThrow();
	});

	it("importProgressData throws on unsupported version", () => {
		expect(() => {
			importProgressData(JSON.stringify({ version: "somecam-v99" }));
		}).toThrow(/version/);
	});

	it("importProgressData throws when version field is missing", () => {
		expect(() => {
			importProgressData(JSON.stringify({ "somecam-chosen": [] }));
		}).toThrow(/version/);
	});
});

describe("statement selections in ExploreData", () => {
	it("defaults statementSelections to empty array when statements key is absent", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].statementSelections).toEqual([]);
	});

	it("defaults statementSelections to empty array for corrupt statements JSON", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		localStorage.setItem(activeKey("statements"), "{bad");
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].statementSelections).toEqual([]);
	});

	it("round-trips statement selections through ExploreData", () => {
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				statementSelections: ["6", "34"],
			},
		});
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].statementSelections).toEqual(["6", "34"]);
	});

	it("exportProgressData includes statements data", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				statementSelections: ["6", "34"],
			},
		});

		const exported = JSON.parse(exportProgressData());
		expect(exported.sessions[0].data.statements).toEqual({ "self-knowledge": ["6", "34"] });
	});

	it("importProgressData restores statements data", () => {
		const currentId = getActiveSessionId();
		const v2Data = JSON.stringify({
			version: "somecam-v2",
			sessions: [
				{
					id: currentId,
					name: "Test",
					createdAt: new Date().toISOString(),
					data: {
						chosen: ["self-knowledge"],
						explore: {
							"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
						},
						statements: { "self-knowledge": ["6", "34"] },
					},
				},
			],
		});

		importProgressData(v2Data);
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].statementSelections).toEqual(["6", "34"]);
	});

	it("importProgressData clears statements when not present in import", () => {
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				statementSelections: ["6"],
			},
		});
		const currentId = getActiveSessionId();

		const v2Data = JSON.stringify({
			version: "somecam-v2",
			sessions: [
				{
					id: currentId,
					name: "Test",
					createdAt: new Date().toISOString(),
					data: {
						chosen: ["self-knowledge"],
						explore: {
							"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
						},
					},
				},
			],
		});

		importProgressData(v2Data);
		const result = loadExploreData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].statementSelections).toEqual([]);
	});
});

describe("session management", () => {
	it("listSessions hides empty sessions", () => {
		expect(listSessions()).toHaveLength(0);
		saveChosenCardIds(sid(), ["self-knowledge"]);
		expect(listSessions()).toHaveLength(1);
	});

	it("listSessions hides empty sessions among non-empty ones", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		createSession("Empty Session");
		expect(listSessions()).toHaveLength(1);
		expect(listSessions()[0].name).not.toBe("Empty Session");
	});

	it("listSessions removes empty non-active sessions from localStorage", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const firstId = getActiveSessionId();
		const emptyId = createSession("Empty");
		// Switch back so the empty session is not active
		localStorage.setItem("somecam-active-session", firstId);

		listSessions();

		// The empty session should be purged from metadata
		const raw = localStorage.getItem("somecam-sessions");
		const meta = JSON.parse(raw ?? "[]");
		expect(meta.find((s: any) => s.id === emptyId)).toBeUndefined();
	});

	it("ensureSessionsInitialized creates one session", () => {
		expect(getActiveSessionId()).toBeTruthy();
	});

	it("ensureSessionsInitialized is idempotent", () => {
		const id = getActiveSessionId();
		ensureSessionsInitialized();
		ensureSessionsInitialized();
		expect(getActiveSessionId()).toBe(id);
	});

	it("createSession adds a new session and makes it active", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const firstId = getActiveSessionId();
		const secondId = createSession("Test Session");
		saveChosenCardIds(sid(), ["community"]);
		expect(secondId).not.toBe(firstId);
		expect(getActiveSessionId()).toBe(secondId);
		expect(listSessions()).toHaveLength(2);
	});

	it("createSession auto-names with formatted date when no name given", () => {
		const id = createSession();
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const sessions = listSessions();
		const session = sessions.find((s) => s.id === id);
		expect(session).toBeDefined();
		expect(session?.name).toBe(formatSessionDate(new Date()));
	});

	it("renameSession updates the session name", () => {
		const id = getActiveSessionId();
		saveChosenCardIds(sid(), ["self-knowledge"]);
		renameSession(id, "New Name");
		const session = listSessions().find((s) => s.id === id);
		expect(session).toBeDefined();
		expect(session?.name).toBe("New Name");
	});

	it("renameSession throws for unknown id", () => {
		expect(() => {
			renameSession("nonexistent", "Name");
		}).toThrow(/not found/);
	});

	it("deleteSession removes session and its data", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const firstId = getActiveSessionId();
		createSession("Second");
		saveChosenCardIds(sid(), ["community"]);
		deleteSession(firstId);
		expect(listSessions()).toHaveLength(1);
		expect(localStorage.getItem(`somecam-${firstId}-chosen`)).toBeNull();
	});

	it("deleteSession switches to another session when deleting active", () => {
		const firstId = getActiveSessionId();
		const secondId = createSession("Second");
		localStorage.setItem("somecam-active-session", firstId);
		deleteSession(firstId);
		expect(getActiveSessionId()).toBe(secondId);
	});

	it("deleteSession creates new session when deleting the last one", () => {
		const onlyId = getActiveSessionId();
		deleteSession(onlyId);
		expect(getActiveSessionId()).not.toBe(onlyId);
	});

	it("deleteSession throws for unknown id", () => {
		expect(() => {
			deleteSession("nonexistent");
		}).toThrow(/not found/);
	});
});

describe("session data isolation", () => {
	it("data saved in one session is not visible in another", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		saveExploreData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "notes from session 1",
				statementSelections: [],
			},
		});

		createSession("Second");

		expect(loadChosenCardIds(sid())).toBeNull();
		expect(loadExploreData(sid())).toBeNull();
	});
});

describe("loadRanking/saveRanking", () => {
	it("returns null when key is absent", () => {
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null when cardIds is missing", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ comparisons: [], complete: false }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null when cardIds is empty", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: [], comparisons: [], complete: false }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null when comparisons is missing", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a"], complete: false }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null when complete is missing", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a"], comparisons: [] }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null for old PrioritizeProgress format (no comparisons field)", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b"], swipeHistory: [] }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null for old pairwise format (winner/loser)", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b"], comparisons: [{ winner: "a", loser: "b" }], complete: false }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null when comparison entry has missing set", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b", "c"], comparisons: [{ best: "a", worst: "c" }], complete: false }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("returns null when comparison set is too short", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b", "c"], comparisons: [{ set: ["a"], best: "a", worst: "a" }], complete: false }));
		expect(loadRanking(sid())).toBeNull();
	});

	it("round-trips saved ranking data", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			complete: false,
		});
		expect(loadRanking(sid())).toEqual({
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			activeRound: undefined,
			complete: false,
		});
	});

	it("round-trips complete ranking", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			complete: true,
		});
		expect(loadRanking(sid())).toEqual({
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			activeRound: undefined,
			complete: true,
		});
	});

	it("round-trips activeRound when within bounds", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [
				{ set: ["a", "b", "c"], best: "a", worst: "c" },
				{ set: ["a", "b", "c"], best: "b", worst: "c" },
			],
			activeRound: 1,
			complete: false,
		});
		const loaded = loadRanking(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBe(1);
	});

	it("ignores activeRound when negative", () => {
		localStorage.setItem(
			activeKey("narrowdown"),
			JSON.stringify({
				cardIds: ["a", "b", "c"],
				comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
				activeRound: -1,
				complete: false,
			}),
		);
		const loaded = loadRanking(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBeUndefined();
	});

	it("ignores activeRound when fractional", () => {
		localStorage.setItem(
			activeKey("narrowdown"),
			JSON.stringify({
				cardIds: ["a", "b", "c"],
				comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
				activeRound: 0.5,
				complete: false,
			}),
		);
		const loaded = loadRanking(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBeUndefined();
	});

	it("ignores activeRound when greater than comparisons length", () => {
		localStorage.setItem(
			activeKey("narrowdown"),
			JSON.stringify({
				cardIds: ["a", "b", "c"],
				comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
				activeRound: 5,
				complete: false,
			}),
		);
		const loaded = loadRanking(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBeUndefined();
	});

	it("accepts activeRound of 0", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			activeRound: 0,
			complete: false,
		});
		const loaded = loadRanking(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBe(0);
	});

	it("accepts activeRound equal to comparisons length", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			activeRound: 1,
			complete: false,
		});
		const loaded = loadRanking(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBe(1);
	});
});

describe("detectSessionPhase", () => {
	it("returns 'none' when no data exists", () => {
		expect(detectSessionPhase(sid())).toBe("none");
	});

	it("returns 'swipe' when swipe progress exists", () => {
		saveSwipeProgress(sid(), {
			shuffledCardIds: ["a", "b"],
			swipeHistory: [{ cardId: "a", direction: "agree" }],
		});
		expect(detectSessionPhase(sid())).toBe("swipe");
	});

	it("returns 'prioritize' when ranking data exists and not complete", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			complete: false,
		});
		expect(detectSessionPhase(sid())).toBe("prioritize");
	});

	it("returns 'prioritize-complete' when ranking is complete", () => {
		saveRanking(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }],
			complete: true,
		});
		expect(detectSessionPhase(sid())).toBe("prioritize-complete");
	});

	it("returns 'explore' when chosen cards exist", () => {
		saveChosenCardIds(sid(), ["a", "b"]);
		expect(detectSessionPhase(sid())).toBe("explore");
	});

	it("explore takes priority over ranking data", () => {
		saveRanking(sid(), { cardIds: ["a", "b", "c"], comparisons: [], complete: false });
		saveChosenCardIds(sid(), ["a"]);
		expect(detectSessionPhase(sid())).toBe("explore");
	});

	it("ranking takes priority over swipe progress", () => {
		saveSwipeProgress(sid(), {
			shuffledCardIds: ["a", "b"],
			swipeHistory: [{ cardId: "a", direction: "agree" }],
		});
		saveRanking(sid(), { cardIds: ["a", "b", "c"], comparisons: [], complete: false });
		expect(detectSessionPhase(sid())).toBe("prioritize");
	});

	it("returns 'none' for old PrioritizeProgress format", () => {
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b"], swipeHistory: [] }));
		expect(detectSessionPhase(sid())).toBe("none");
	});
});

describe("formatSessionDate", () => {
	it("formats a date as 'Month Day, Year'", () => {
		const date = new Date(2026, 1, 13); // Feb 13, 2026
		expect(formatSessionDate(date)).toBe("February 13, 2026");
	});
});

describe("hasVisitedExploreComplete/markExploreCompleteVisited", () => {
	it("returns false when no key exists", () => {
		expect(hasVisitedExploreComplete(sid(), "self-knowledge")).toBe(false);
	});

	it("returns true after markExploreCompleteVisited", () => {
		markExploreCompleteVisited(sid(), "self-knowledge");
		expect(hasVisitedExploreComplete(sid(), "self-knowledge")).toBe(true);
	});

	it("is idempotent (marking twice does not duplicate)", () => {
		markExploreCompleteVisited(sid(), "self-knowledge");
		markExploreCompleteVisited(sid(), "self-knowledge");
		const raw = JSON.parse(localStorage.getItem(activeKey("complete-visited"))!);
		expect(raw).toEqual(["self-knowledge"]);
	});

	it("tracks multiple cards independently", () => {
		markExploreCompleteVisited(sid(), "self-knowledge");
		markExploreCompleteVisited(sid(), "community");
		expect(hasVisitedExploreComplete(sid(), "self-knowledge")).toBe(true);
		expect(hasVisitedExploreComplete(sid(), "community")).toBe(true);
		expect(hasVisitedExploreComplete(sid(), "challenge")).toBe(false);
	});

	it("is cleaned up by deleteSession", () => {
		markExploreCompleteVisited(sid(), "self-knowledge");
		const id = getActiveSessionId();
		deleteSession(id);
		expect(localStorage.getItem(`somecam-${id}-complete-visited`)).toBeNull();
	});

	it("round-trips through export/import", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		markExploreCompleteVisited(sid(), "self-knowledge");
		const activeId = getActiveSessionId();

		const exported = exportProgressData();

		// Clear data
		for (const suffix of ["progress", "narrowdown", "chosen", "explore", "summaries", "freeform", "statements", "complete-visited"]) {
			localStorage.removeItem(`somecam-${activeId}-${suffix}`);
		}
		expect(hasVisitedExploreComplete(sid(), "self-knowledge")).toBe(false);

		importProgressData(exported);
		localStorage.setItem("somecam-active-session", activeId);
		expect(hasVisitedExploreComplete(sid(), "self-knowledge")).toBe(true);
	});
});
