// @vitest-environment node

import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProfile, deleteProfile, detectProfilePhase, ensureProfilesInitialized, exportProgressData, formatProfileDate, getActiveProfileId, hasVisitedExamineReflect, importProgressData, listProfiles, loadChosenCardIds, loadExamineData, loadLlmTestState, loadPrioritizeProgress, loadSwipeProgress, lookupCachedSynthesis, markExamineReflectVisited, renameProfile, saveCachedSynthesis, saveChosenCardIds, saveExamineData, saveLlmTestState, savePrioritizeProgress, saveSwipeProgress } from "./store.ts";

function sid(): string {
	return getActiveProfileId();
}
import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";

const DEFAULT_QUESTION_ID = EXAMINE_QUESTIONS[0].id;

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
	ensureProfilesInitialized();
});

afterEach(() => {
	currentWindow?.close();
	currentWindow = null;
});

function activeKey(suffix: string): string {
	return `somecam-${getActiveProfileId()}-${suffix}`;
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

describe("loadExamineData/saveExamineData", () => {
	it("returns null when key is absent", () => {
		expect(loadExamineData(sid())).toBeNull();
	});

	it("returns null for corrupt JSON", () => {
		localStorage.setItem(activeKey("explore"), "{");
		expect(loadExamineData(sid())).toBeNull();
	});

	it("returns null for malformed examine entries", () => {
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
		expect(loadExamineData(sid())).toBeNull();
	});

	it("round-trips saved examine data", () => {
		saveExamineData(sid(), {
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
				descriptionSelections: [],
			},
		});

		expect(loadExamineData(sid())).toEqual({
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
				descriptionSelections: [],
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

		expect(loadExamineData(sid())).toEqual({
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
				descriptionSelections: [],
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

		expect(loadExamineData(sid())).toEqual({
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
				descriptionSelections: [],
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
		expect(loadExamineData(sid())).toBeNull();
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
		expect(loadExamineData(sid())).toBeNull();
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

		const result = loadExamineData(sid());
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

		const result = loadExamineData(sid());
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
		expect(loadExamineData(sid())).toBeNull();
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
		expect(loadExamineData(sid())).toBeNull();
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
		const result = loadExamineData(sid());
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
		expect(loadExamineData(sid())).toBeNull();
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
		expect(loadExamineData(sid())).toBeNull();
	});
});

describe("lookupCachedSynthesis/saveCachedSynthesis", () => {
	it("returns null when key is absent", () => {
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "some fingerprint" })).toBeNull();
	});

	it("returns null on fingerprint mismatch", () => {
		saveCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fingerprint1", synthesis: "My synthesis" });
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "different" })).toBeNull();
	});

	it("round-trips saved synthesis", () => {
		saveCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "my-fingerprint", synthesis: "My synthesis" });
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "my-fingerprint" })).toBe("My synthesis");
	});

	it("short and normal syntheses use separate cache keys", () => {
		saveCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp", synthesis: "Normal", short: false });
		saveCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp", synthesis: "Short", short: true });
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp" })).toBe("Normal");
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp", short: true })).toBe("Short");
	});

	it("short lookup returns null when only normal is cached", () => {
		saveCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp", synthesis: "Normal" });
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp", short: true })).toBeNull();
	});

	it("normal lookup returns null when only short is cached", () => {
		saveCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp", synthesis: "Short", short: true });
		expect(lookupCachedSynthesis({ profileId: sid(), cardId: "self-knowledge", fingerprint: "fp" })).toBeNull();
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
			selectedDescriptions: [],
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
			selectedDescriptions: [],
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
			selectedDescriptions: [],
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
			selectedDescriptions: ["3", "5"],
			freeformNote: "some notes",
		});

		expect(loadLlmTestState()).toEqual({
			cardId: "self-knowledge",
			rows: [
				{ questionId: "interpretation", answer: "answer 1" },
				{ questionId: "importance", answer: "answer 2" },
			],
			selectedDescriptions: ["3", "5"],
			freeformNote: "some notes",
		});
	});
});

describe("freeform notes in ExamineData", () => {
	it("defaults freeformNote to empty string when freeform key is absent", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		const result = loadExamineData(sid());
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
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("");
	});

	it("round-trips freeform notes through ExamineData", () => {
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "Some extra thoughts",
				descriptionSelections: [],
			},
		});
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("Some extra thoughts");
	});

	it("round-trips empty freeformNote", () => {
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				descriptionSelections: [],
			},
		});
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("");
	});
});

describe("exportProgressData/importProgressData", () => {
	it("exportProgressData returns v2 format with empty profile data", () => {
		const result = JSON.parse(exportProgressData());
		expect(result.version).toBe("somecam-v2");
		expect(Array.isArray(result.sessions)).toBe(true);
		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0].data).toEqual({});
	});

	it("exportProgressData includes profile data", () => {
		saveChosenCardIds(sid(), ["self-knowledge", "community"]);
		const result = JSON.parse(exportProgressData());
		expect(result.sessions[0].data.chosen).toEqual(["self-knowledge", "community"]);
	});

	it("exportProgressData exports all profiles", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const secondId = createProfile("Second");
		saveChosenCardIds(sid(), ["community"]);

		const result = JSON.parse(exportProgressData());
		expect(result.sessions).toHaveLength(2);
		const secondSession = result.sessions.find((s: any) => s.id === secondId);
		expect(secondSession).toBeDefined();
		expect(secondSession.data.chosen).toEqual(["community"]);
	});

	it("importProgressData v2 merges profiles by UUID", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const currentId = getActiveProfileId();
		const currentSessions = listProfiles();

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
		const sessions = listProfiles();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].name).toBe("Updated Name");
	});

	it("importProgressData v2 adds new profiles", () => {
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

		const sessions = listProfiles();
		expect(sessions).toHaveLength(2);
		const imported = sessions.find((s) => s.id === "new-session-uuid");
		expect(imported).toBeDefined();
		expect(imported?.name).toBe("Imported Session");
	});

	it("importProgressData v2 round-trips: export → import restores data", () => {
		saveChosenCardIds(sid(), ["self-knowledge", "community"]);
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "notes",
				descriptionSelections: [],
			},
		});

		const exported = exportProgressData();
		const activeId = getActiveProfileId();

		// Clear active profile data
		for (const suffix of ["progress", "narrowdown", "chosen", "explore", "summaries", "freeform", "statements"]) {
			localStorage.removeItem(`somecam-${activeId}-${suffix}`);
		}
		expect(loadChosenCardIds(sid())).toBeNull();

		importProgressData(exported);

		localStorage.setItem("somecam-active-session", activeId);
		expect(loadChosenCardIds(sid())).toEqual(["self-knowledge", "community"]);
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].freeformNote).toBe("notes");
	});

	it("importProgressData v2 clears data keys not present in import", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "notes",
				descriptionSelections: [],
			},
		});
		const currentId = getActiveProfileId();

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
		expect(loadExamineData(sid())).toBeNull();
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

describe("description selections in ExamineData", () => {
	it("defaults descriptionSelections to empty array when descriptions key is absent", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].descriptionSelections).toEqual([]);
	});

	it("defaults descriptionSelections to empty array for corrupt descriptions JSON", () => {
		localStorage.setItem(
			activeKey("explore"),
			JSON.stringify({
				"self-knowledge": [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true }],
			}),
		);
		localStorage.setItem(activeKey("statements"), "{bad");
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].descriptionSelections).toEqual([]);
	});

	it("round-trips description selections through ExamineData", () => {
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				descriptionSelections: ["6", "34"],
			},
		});
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].descriptionSelections).toEqual(["6", "34"]);
	});

	it("exportProgressData includes descriptions data", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				descriptionSelections: ["6", "34"],
			},
		});

		const exported = JSON.parse(exportProgressData());
		expect(exported.sessions[0].data.statements).toEqual({ "self-knowledge": ["6", "34"] });
	});

	it("importProgressData restores descriptions data", () => {
		const currentId = getActiveProfileId();
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
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].descriptionSelections).toEqual(["6", "34"]);
	});

	it("importProgressData clears descriptions when not present in import", () => {
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "",
				descriptionSelections: ["6"],
			},
		});
		const currentId = getActiveProfileId();

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
		const result = loadExamineData(sid());
		expect(result).not.toBeNull();
		expect(result!["self-knowledge"].descriptionSelections).toEqual([]);
	});
});

describe("profile management", () => {
	it("listProfiles hides empty profiles", () => {
		expect(listProfiles()).toHaveLength(0);
		saveChosenCardIds(sid(), ["self-knowledge"]);
		expect(listProfiles()).toHaveLength(1);
	});

	it("listProfiles hides empty profiles among non-empty ones", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		createProfile("Empty Session");
		expect(listProfiles()).toHaveLength(1);
		expect(listProfiles()[0].name).not.toBe("Empty Session");
	});

	it("listProfiles removes empty non-active profiles from localStorage", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const firstId = getActiveProfileId();
		const emptyId = createProfile("Empty");
		// Switch back so the empty profile is not active
		localStorage.setItem("somecam-active-session", firstId);

		listProfiles();

		// The empty profile should be purged from metadata
		const raw = localStorage.getItem("somecam-sessions");
		const meta = JSON.parse(raw ?? "[]");
		expect(meta.find((s: any) => s.id === emptyId)).toBeUndefined();
	});

	it("ensureProfilesInitialized creates one profile", () => {
		expect(getActiveProfileId()).toBeTruthy();
	});

	it("ensureProfilesInitialized is idempotent", () => {
		const id = getActiveProfileId();
		ensureProfilesInitialized();
		ensureProfilesInitialized();
		expect(getActiveProfileId()).toBe(id);
	});

	it("createProfile adds a new profile and makes it active", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const firstId = getActiveProfileId();
		const secondId = createProfile("Test Session");
		saveChosenCardIds(sid(), ["community"]);
		expect(secondId).not.toBe(firstId);
		expect(getActiveProfileId()).toBe(secondId);
		expect(listProfiles()).toHaveLength(2);
	});

	it("createProfile auto-names with formatted date when no name given", () => {
		const id = createProfile();
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const sessions = listProfiles();
		const profile = sessions.find((s) => s.id === id);
		expect(profile).toBeDefined();
		expect(profile?.name).toBe(formatProfileDate(new Date()));
	});

	it("renameProfile updates the profile name", () => {
		const id = getActiveProfileId();
		saveChosenCardIds(sid(), ["self-knowledge"]);
		renameProfile(id, "New Name");
		const profile = listProfiles().find((s) => s.id === id);
		expect(profile).toBeDefined();
		expect(profile?.name).toBe("New Name");
	});

	it("renameProfile throws for unknown id", () => {
		expect(() => {
			renameProfile("nonexistent", "Name");
		}).toThrow(/not found/);
	});

	it("deleteProfile removes profile and its data", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		const firstId = getActiveProfileId();
		createProfile("Second");
		saveChosenCardIds(sid(), ["community"]);
		deleteProfile(firstId);
		expect(listProfiles()).toHaveLength(1);
		expect(localStorage.getItem(`somecam-${firstId}-chosen`)).toBeNull();
	});

	it("deleteProfile switches to another profile when deleting active", () => {
		const firstId = getActiveProfileId();
		const secondId = createProfile("Second");
		localStorage.setItem("somecam-active-session", firstId);
		deleteProfile(firstId);
		expect(getActiveProfileId()).toBe(secondId);
	});

	it("deleteProfile creates new profile when deleting the last one", () => {
		const onlyId = getActiveProfileId();
		deleteProfile(onlyId);
		expect(getActiveProfileId()).not.toBe(onlyId);
	});

	it("deleteProfile throws for unknown id", () => {
		expect(() => {
			deleteProfile("nonexistent");
		}).toThrow(/not found/);
	});
});

describe("profile data isolation", () => {
	it("data saved in one profile is not visible in another", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		saveExamineData(sid(), {
			"self-knowledge": {
				entries: [{ questionId: "interpretation", userAnswer: "answer", prefilledAnswer: "", submitted: true, guardrailText: "", submittedAfterGuardrail: false, thoughtBubbleText: "", thoughtBubbleAcknowledged: false, autoFilledPending: false }],
				freeformNote: "notes from profile 1",
				descriptionSelections: [],
			},
		});

		createProfile("Second");

		expect(loadChosenCardIds(sid())).toBeNull();
		expect(loadExamineData(sid())).toBeNull();
	});
});

describe("loadPrioritizeProgress/savePrioritizeProgress", () => {
	it("returns null when key is absent", () => {
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null when cardIds is missing", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ comparisons: [], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null when cardIds is empty", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: [], comparisons: [], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null when comparisons is missing", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: ["a"], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null when complete is missing", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: ["a"], comparisons: [] }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null for legacy MaxDiff format (triplet set)", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: ["a", "b", "c"], comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null when comparison entry has missing set", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: ["a", "b"], comparisons: [{ best: "a", worst: "b" }], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("returns null when comparison set is too short", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: ["a", "b"], comparisons: [{ set: ["a"], best: "a", worst: "a" }], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});

	it("round-trips saved progress", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			complete: false,
		});
		expect(loadPrioritizeProgress(sid())).toEqual({
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			activeRound: undefined,
			complete: false,
		});
	});

	it("round-trips complete progress", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			complete: true,
		});
		expect(loadPrioritizeProgress(sid())).toEqual({
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			activeRound: undefined,
			complete: true,
		});
	});

	it("round-trips activeRound when within bounds", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [
				{ set: ["a", "b"], best: "a", worst: "b" },
				{ set: ["a", "c"], best: "a", worst: "c" },
			],
			activeRound: 1,
			complete: false,
		});
		const loaded = loadPrioritizeProgress(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBe(1);
	});

	it("ignores activeRound when negative", () => {
		localStorage.setItem(
			activeKey("prioritize"),
			JSON.stringify({
				cardIds: ["a", "b", "c"],
				comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
				activeRound: -1,
				complete: false,
			}),
		);
		const loaded = loadPrioritizeProgress(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBeUndefined();
	});

	it("ignores activeRound when fractional", () => {
		localStorage.setItem(
			activeKey("prioritize"),
			JSON.stringify({
				cardIds: ["a", "b", "c"],
				comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
				activeRound: 0.5,
				complete: false,
			}),
		);
		const loaded = loadPrioritizeProgress(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBeUndefined();
	});

	it("ignores activeRound when greater than comparisons length", () => {
		localStorage.setItem(
			activeKey("prioritize"),
			JSON.stringify({
				cardIds: ["a", "b", "c"],
				comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
				activeRound: 5,
				complete: false,
			}),
		);
		const loaded = loadPrioritizeProgress(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBeUndefined();
	});

	it("accepts activeRound of 0", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			activeRound: 0,
			complete: false,
		});
		const loaded = loadPrioritizeProgress(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBe(0);
	});

	it("accepts activeRound equal to comparisons length", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			activeRound: 1,
			complete: false,
		});
		const loaded = loadPrioritizeProgress(sid());
		expect(loaded).not.toBeNull();
		expect(loaded!.activeRound).toBe(1);
	});

	it("ignores legacy narrowdown-keyed in-progress data", () => {
		// Old MaxDiff data under the legacy key should not be visible via the new accessor.
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b", "c"], comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }], complete: false }));
		expect(loadPrioritizeProgress(sid())).toBeNull();
	});
});

describe("detectProfilePhase", () => {
	it("returns 'none' when no data exists", () => {
		expect(detectProfilePhase(sid())).toBe("none");
	});

	it("returns 'identify' when swipe progress exists", () => {
		saveSwipeProgress(sid(), {
			shuffledCardIds: ["a", "b"],
			swipeHistory: [{ cardId: "a", direction: "agree" }],
		});
		expect(detectProfilePhase(sid())).toBe("identify");
	});

	it("returns 'prioritize' when prioritize data exists and not complete", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			complete: false,
		});
		expect(detectProfilePhase(sid())).toBe("prioritize");
	});

	it("returns 'prioritize-complete' when prioritize is complete", () => {
		savePrioritizeProgress(sid(), {
			cardIds: ["a", "b", "c"],
			comparisons: [{ set: ["a", "b"], best: "a", worst: "b" }],
			complete: true,
		});
		expect(detectProfilePhase(sid())).toBe("prioritize-complete");
	});

	it("returns 'examine' when chosen cards exist", () => {
		saveChosenCardIds(sid(), ["a", "b"]);
		expect(detectProfilePhase(sid())).toBe("examine");
	});

	it("examine takes priority over prioritize data", () => {
		savePrioritizeProgress(sid(), { cardIds: ["a", "b", "c"], comparisons: [], complete: false });
		saveChosenCardIds(sid(), ["a"]);
		expect(detectProfilePhase(sid())).toBe("examine");
	});

	it("prioritize takes priority over swipe progress", () => {
		saveSwipeProgress(sid(), {
			shuffledCardIds: ["a", "b"],
			swipeHistory: [{ cardId: "a", direction: "agree" }],
		});
		savePrioritizeProgress(sid(), { cardIds: ["a", "b", "c"], comparisons: [], complete: false });
		expect(detectProfilePhase(sid())).toBe("prioritize");
	});

	it("returns 'none' for malformed prioritize data", () => {
		localStorage.setItem(activeKey("prioritize"), JSON.stringify({ cardIds: ["a", "b"], swipeHistory: [] }));
		expect(detectProfilePhase(sid())).toBe("none");
	});

	it("ignores legacy narrowdown-keyed in-progress data when detecting phase", () => {
		// Old MaxDiff in-progress data under the legacy key should not be treated as a prioritize phase.
		localStorage.setItem(activeKey("narrowdown"), JSON.stringify({ cardIds: ["a", "b", "c"], comparisons: [{ set: ["a", "b", "c"], best: "a", worst: "c" }], complete: false }));
		expect(detectProfilePhase(sid())).toBe("none");
	});
});

describe("formatProfileDate", () => {
	it("formats a date as 'Month Day, Year'", () => {
		const date = new Date(2026, 1, 13); // Feb 13, 2026
		expect(formatProfileDate(date)).toBe("February 13, 2026");
	});
});

describe("hasVisitedExamineReflect/markExamineReflectVisited", () => {
	it("returns false when no key exists", () => {
		expect(hasVisitedExamineReflect(sid(), "self-knowledge")).toBe(false);
	});

	it("returns true after markExamineReflectVisited", () => {
		markExamineReflectVisited(sid(), "self-knowledge");
		expect(hasVisitedExamineReflect(sid(), "self-knowledge")).toBe(true);
	});

	it("is idempotent (marking twice does not duplicate)", () => {
		markExamineReflectVisited(sid(), "self-knowledge");
		markExamineReflectVisited(sid(), "self-knowledge");
		const raw = JSON.parse(localStorage.getItem(activeKey("complete-visited"))!);
		expect(raw).toEqual(["self-knowledge"]);
	});

	it("tracks multiple cards independently", () => {
		markExamineReflectVisited(sid(), "self-knowledge");
		markExamineReflectVisited(sid(), "community");
		expect(hasVisitedExamineReflect(sid(), "self-knowledge")).toBe(true);
		expect(hasVisitedExamineReflect(sid(), "community")).toBe(true);
		expect(hasVisitedExamineReflect(sid(), "challenge")).toBe(false);
	});

	it("is cleaned up by deleteProfile", () => {
		markExamineReflectVisited(sid(), "self-knowledge");
		const id = getActiveProfileId();
		deleteProfile(id);
		expect(localStorage.getItem(`somecam-${id}-complete-visited`)).toBeNull();
	});

	it("round-trips through export/import", () => {
		saveChosenCardIds(sid(), ["self-knowledge"]);
		markExamineReflectVisited(sid(), "self-knowledge");
		const activeId = getActiveProfileId();

		const exported = exportProgressData();

		// Clear data
		for (const suffix of ["progress", "narrowdown", "chosen", "explore", "summaries", "freeform", "statements", "complete-visited"]) {
			localStorage.removeItem(`somecam-${activeId}-${suffix}`);
		}
		expect(hasVisitedExamineReflect(sid(), "self-knowledge")).toBe(false);

		importProgressData(exported);
		localStorage.setItem("somecam-active-session", activeId);
		expect(hasVisitedExamineReflect(sid(), "self-knowledge")).toBe(true);
	});
});
