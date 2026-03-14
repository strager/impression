import { EXPLORE_QUESTIONS } from "../shared/explore-questions.ts";
import type { SwipeDirection } from "../shared/meaning-cards.ts";
import { fetchSummary } from "./api.ts";
import { capture } from "./analytics.ts";
import { hashStrings } from "./deterministic-hash.ts";

const SESSIONS_KEY = "somecam-sessions";
const ACTIVE_SESSION_KEY = "somecam-active-session";
const LLM_TEST_KEY = "somecam-llm-test";
const PERSIST_REQUESTED_KEY = "somecam-persist-requested";
const RATE_LIMIT_SESSION_KEY = "somecam-api-session-id";

const SESSION_DATA_SUFFIXES = ["progress", "narrowdown", "chosen", "explore", "summaries", "freeform", "statements"] as const;

const DEFAULT_QUESTION_ID = EXPLORE_QUESTIONS[0]?.id ?? "";

export interface ImportProgressStats {
	sessions: number;
	finalSessionsAdded: number;
	sessionsOverridden: number;
}

function importErrorType(error: unknown): string {
	if (error instanceof SyntaxError) {
		return "invalid_json";
	}
	if (error instanceof Error) {
		return error.name !== "" ? error.name : "import_error";
	}
	return "import_error";
}

export interface SessionMeta {
	id: string;
	name: string;
	createdAt: string;
	lastUpdatedAt: string;
}

export interface SwipeRecord {
	cardId: string;
	direction: SwipeDirection;
}

export interface SwipeProgress {
	shuffledCardIds: string[];
	swipeHistory: SwipeRecord[];
}

export interface MaxDiffComparison {
	set: string[];
	best: string;
	worst: string;
}

export interface RankingProgress {
	cardIds: string[];
	comparisons: MaxDiffComparison[];
	activeRound?: number;
	complete: boolean;
}

export interface ExploreEntry {
	questionId: string;
	userAnswer: string;
	prefilledAnswer: string;
	submitted: boolean;
	guardrailText: string;
	submittedAfterGuardrail: boolean;
	thoughtBubbleText: string;
	thoughtBubbleAcknowledged: boolean;
	autoFilledPending: boolean;
}

export interface CardExploreData {
	entries: ExploreEntry[];
	freeformNote: string;
	statementSelections: string[];
}
export type ExploreData = Record<string, CardExploreData>;
type SummaryCache = Record<string, { answer: string; summary: string }>;
type FreeformNotes = Partial<Record<string, string>>;
type StatementSelections = Partial<Record<string, string[]>>;

interface LlmTestRow {
	questionId: string;
	answer: string;
}

export interface LlmTestState {
	cardId: string;
	rows: LlmTestRow[];
}

// --- Session management ---

function generateUUID(): string {
	return crypto.randomUUID();
}

export function formatSessionDate(date: Date): string {
	return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function loadSessionsMeta(): SessionMeta[] {
	const parsed = parseJsonFromStorage(SESSIONS_KEY);
	if (!Array.isArray(parsed)) {
		return [];
	}
	const result: SessionMeta[] = [];
	for (const entry of parsed) {
		if (!isObjectRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.createdAt !== "string") {
			continue;
		}
		result.push({
			id: entry.id,
			name: entry.name,
			createdAt: entry.createdAt,
			lastUpdatedAt: typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt : entry.createdAt,
		});
	}
	return result;
}

function saveSessionsMeta(sessions: SessionMeta[]): void {
	localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function ensureSessionsInitialized(): void {
	if (localStorage.getItem(SESSIONS_KEY) !== null) {
		return;
	}
	const id = generateUUID();
	const now = new Date().toISOString();
	const meta: SessionMeta = {
		id,
		name: formatSessionDate(new Date()),
		createdAt: now,
		lastUpdatedAt: now,
	};
	saveSessionsMeta([meta]);
	localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

export function getActiveSessionId(): string {
	ensureSessionsInitialized();
	const id = localStorage.getItem(ACTIVE_SESSION_KEY);
	if (id !== null) {
		return id;
	}
	const sessions = loadSessionsMeta();
	if (sessions.length > 0) {
		localStorage.setItem(ACTIVE_SESSION_KEY, sessions[0].id);
		return sessions[0].id;
	}
	ensureSessionsInitialized();
	// ensureSessionsInitialized always creates a session and sets the active key
	const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
	if (activeId === null) {
		throw new Error("ensureSessionsInitialized failed to create a session");
	}
	return activeId;
}

function sessionHasData(id: string): boolean {
	return SESSION_DATA_SUFFIXES.some((suffix) => localStorage.getItem(`somecam-${id}-${suffix}`) !== null);
}

export function listSessions(): SessionMeta[] {
	ensureSessionsInitialized();
	const all = loadSessionsMeta();
	const nonEmpty = all.filter((s) => sessionHasData(s.id));
	if (nonEmpty.length < all.length) {
		saveSessionsMeta(all.filter((s) => sessionHasData(s.id) || s.id === localStorage.getItem(ACTIVE_SESSION_KEY)));
	}
	return nonEmpty;
}

export function createSession(name?: string): string {
	ensureSessionsInitialized();
	const id = generateUUID();
	const now = new Date().toISOString();
	const meta: SessionMeta = {
		id,
		name: name ?? formatSessionDate(new Date()),
		createdAt: now,
		lastUpdatedAt: now,
	};
	const sessions = loadSessionsMeta();
	sessions.push(meta);
	saveSessionsMeta(sessions);
	localStorage.setItem(ACTIVE_SESSION_KEY, id);
	return id;
}

export function renameSession(id: string, newName: string): void {
	const sessions = loadSessionsMeta();
	const session = sessions.find((s) => s.id === id);
	if (session === undefined) {
		throw new Error(`Session not found: ${id}`);
	}
	session.name = newName;
	saveSessionsMeta(sessions);
}

export function getSessionName(id: string): string | null {
	const sessions = loadSessionsMeta();
	const session = sessions.find((s) => s.id === id);
	return session?.name ?? null;
}

export function deleteSession(id: string): void {
	const sessions = loadSessionsMeta();
	const index = sessions.findIndex((s) => s.id === id);
	if (index === -1) {
		throw new Error(`Session not found: ${id}`);
	}

	for (const suffix of SESSION_DATA_SUFFIXES) {
		localStorage.removeItem(`somecam-${id}-${suffix}`);
	}

	sessions.splice(index, 1);

	if (sessions.length === 0) {
		const newId = generateUUID();
		const now = new Date().toISOString();
		const meta: SessionMeta = {
			id: newId,
			name: formatSessionDate(new Date()),
			createdAt: now,
			lastUpdatedAt: now,
		};
		sessions.push(meta);
		localStorage.setItem(ACTIVE_SESSION_KEY, newId);
	} else if (localStorage.getItem(ACTIVE_SESSION_KEY) === id) {
		localStorage.setItem(ACTIVE_SESSION_KEY, sessions[sessions.length - 1].id);
	}

	saveSessionsMeta(sessions);
}

function touchSession(sessionId: string): void {
	const sessions = loadSessionsMeta();
	const session = sessions.find((s) => s.id === sessionId);
	if (session !== undefined) {
		session.lastUpdatedAt = new Date().toISOString();
		saveSessionsMeta(sessions);
	}
}

// --- Dynamic key resolution ---

function sessionKey(sessionId: string, suffix: string): string {
	return `somecam-${sessionId}-${suffix}`;
}

function progressKey(sessionId: string): string {
	return sessionKey(sessionId, "progress");
}
function narrowdownKey(sessionId: string): string {
	return sessionKey(sessionId, "narrowdown");
}
function chosenKey(sessionId: string): string {
	return sessionKey(sessionId, "chosen");
}
function exploreKey(sessionId: string): string {
	return sessionKey(sessionId, "explore");
}
function summariesKey(sessionId: string): string {
	return sessionKey(sessionId, "summaries");
}
function freeformKey(sessionId: string): string {
	return sessionKey(sessionId, "freeform");
}
function statementsKey(sessionId: string): string {
	return sessionKey(sessionId, "statements");
}

// --- Internal helpers ---

function parseJsonFromStorage(key: string): unknown {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) {
			return null;
		}
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSwipeDirection(value: unknown): value is SwipeDirection {
	return value === "agree" || value === "disagree" || value === "unsure";
}

function isSwipeRecord(value: unknown): value is SwipeRecord {
	if (!isObjectRecord(value)) {
		return false;
	}
	return typeof value.cardId === "string" && isSwipeDirection(value.direction);
}

function toExploreEntry(value: unknown): ExploreEntry | null {
	if (!isObjectRecord(value)) {
		return null;
	}

	if (typeof value.questionId !== "string" || typeof value.userAnswer !== "string" || typeof value.prefilledAnswer !== "string" || typeof value.submitted !== "boolean") {
		return null;
	}

	if (value.guardrailText !== undefined && typeof value.guardrailText !== "string") {
		return null;
	}
	if (value.submittedAfterGuardrail !== undefined && typeof value.submittedAfterGuardrail !== "boolean") {
		return null;
	}
	if (value.thoughtBubbleText !== undefined && typeof value.thoughtBubbleText !== "string") {
		return null;
	}
	if (value.thoughtBubbleAcknowledged !== undefined && typeof value.thoughtBubbleAcknowledged !== "boolean") {
		return null;
	}
	if (value.autoFilledPending !== undefined && typeof value.autoFilledPending !== "boolean") {
		return null;
	}

	return {
		questionId: value.questionId,
		userAnswer: value.userAnswer,
		prefilledAnswer: value.prefilledAnswer,
		submitted: value.submitted,
		guardrailText: value.guardrailText ?? "",
		submittedAfterGuardrail: value.submittedAfterGuardrail ?? false,
		thoughtBubbleText: value.thoughtBubbleText ?? "",
		thoughtBubbleAcknowledged: value.thoughtBubbleAcknowledged ?? false,
		autoFilledPending: value.autoFilledPending ?? false,
	};
}

function isSummaryCacheEntry(value: unknown): value is { answer: string; summary: string } {
	if (!isObjectRecord(value)) {
		return false;
	}
	return typeof value.answer === "string" && typeof value.summary === "string";
}

// --- Session-scoped load/save ---

export function loadSwipeProgress(sessionId: string): SwipeProgress | null {
	const parsed = parseJsonFromStorage(progressKey(sessionId));
	if (!isObjectRecord(parsed)) {
		return null;
	}
	if (!isStringArray(parsed.shuffledCardIds) || parsed.shuffledCardIds.length === 0) {
		return null;
	}
	if (!Array.isArray(parsed.swipeHistory) || !parsed.swipeHistory.every((entry) => isSwipeRecord(entry))) {
		return null;
	}
	return {
		shuffledCardIds: parsed.shuffledCardIds,
		swipeHistory: parsed.swipeHistory,
	};
}

export function saveSwipeProgress(sessionId: string, data: SwipeProgress): void {
	localStorage.setItem(progressKey(sessionId), JSON.stringify(data));
	touchSession(sessionId);
}

export function loadRanking(sessionId: string): RankingProgress | null {
	const parsed = parseJsonFromStorage(narrowdownKey(sessionId));
	if (!isObjectRecord(parsed)) {
		return null;
	}
	if (!isStringArray(parsed.cardIds) || parsed.cardIds.length === 0) {
		return null;
	}
	if (!Array.isArray(parsed.comparisons)) {
		return null;
	}
	if (typeof parsed.complete !== "boolean") {
		return null;
	}
	const comparisons: MaxDiffComparison[] = [];
	for (const entry of parsed.comparisons) {
		if (!isObjectRecord(entry) || !isStringArray(entry.set) || entry.set.length < 2 || typeof entry.best !== "string" || typeof entry.worst !== "string") {
			return null;
		}
		comparisons.push({ set: entry.set, best: entry.best, worst: entry.worst });
	}
	const ar = parsed.activeRound;
	const activeRound = typeof ar === "number" && Number.isInteger(ar) && ar >= 0 && ar <= comparisons.length ? ar : undefined;
	return {
		cardIds: parsed.cardIds,
		comparisons,
		activeRound,
		complete: parsed.complete,
	};
}

export function saveRanking(sessionId: string, data: RankingProgress): void {
	localStorage.setItem(narrowdownKey(sessionId), JSON.stringify(data));
	touchSession(sessionId);
}

export function loadChosenCardIds(sessionId: string): string[] | null {
	const parsed = parseJsonFromStorage(chosenKey(sessionId));
	if (!isStringArray(parsed) || parsed.length === 0) {
		return null;
	}
	return parsed;
}

export function saveChosenCardIds(sessionId: string, ids: string[]): void {
	localStorage.setItem(chosenKey(sessionId), JSON.stringify(ids));
	touchSession(sessionId);
}

export function selectCandidateCards(sessionId: string): string[] {
	const progress = loadSwipeProgress(sessionId);
	if (progress === null) return [];
	const agreeCardIds = progress.swipeHistory.filter((r) => r.direction === "agree").map((r) => r.cardId);
	const unsureCardIds = progress.swipeHistory.filter((r) => r.direction === "unsure").map((r) => r.cardId);
	return agreeCardIds.length < 3 ? agreeCardIds.concat(unsureCardIds) : agreeCardIds;
}

export function needsPrioritization(sessionId: string): boolean {
	const ranking = loadRanking(sessionId);
	if (ranking !== null) {
		return ranking.cardIds.length > 5;
	}
	return selectCandidateCards(sessionId).length > 5;
}

export function loadExploreData(sessionId: string): ExploreData | null {
	const parsed = parseJsonFromStorage(exploreKey(sessionId));
	if (!isObjectRecord(parsed)) {
		return null;
	}

	const freeformNotes = loadFreeformNotesInternal(sessionId);
	const statementSelections = loadStatementSelectionsInternal(sessionId);

	const result: ExploreData = {};
	for (const [cardId, entries] of Object.entries(parsed)) {
		if (!Array.isArray(entries)) {
			return null;
		}

		const validEntries: ExploreEntry[] = [];
		for (const entry of entries) {
			const validEntry = toExploreEntry(entry);
			if (validEntry === null) {
				return null;
			}
			validEntries.push(validEntry);
		}
		const nonBlank = validEntries.filter((e) => e.userAnswer.trim() !== "");
		result[cardId] = {
			entries: nonBlank.length > 0 ? nonBlank : validEntries.slice(0, 1),
			freeformNote: freeformNotes[cardId] ?? "",
			statementSelections: statementSelections[cardId] ?? [],
		};
	}

	return result;
}

export function saveExploreData(sessionId: string, data: ExploreData): void {
	const entriesRecord: Record<string, ExploreEntry[]> = {};
	const freeformRecord: FreeformNotes = {};
	const statementsRecord: StatementSelections = {};
	for (const [cardId, cardData] of Object.entries(data)) {
		entriesRecord[cardId] = cardData.entries;
		if (cardData.freeformNote !== "") {
			freeformRecord[cardId] = cardData.freeformNote;
		}
		if (cardData.statementSelections.length > 0) {
			statementsRecord[cardId] = cardData.statementSelections;
		}
	}
	localStorage.setItem(exploreKey(sessionId), JSON.stringify(entriesRecord));
	localStorage.setItem(freeformKey(sessionId), JSON.stringify(freeformRecord));
	localStorage.setItem(statementsKey(sessionId), JSON.stringify(statementsRecord));
	touchSession(sessionId);
}

export function selectNextQuestion(sessionId: string, cardId: string, allowedQuestionIds: string[], priorityQuestionIds: string[]): string {
	for (const qId of allowedQuestionIds) {
		if (priorityQuestionIds.includes(qId)) {
			return qId;
		}
	}
	const entryCount = EXPLORE_QUESTIONS.length - allowedQuestionIds.length;
	const index = hashStrings(cardId, sessionId, String(entryCount)) % allowedQuestionIds.length;
	return allowedQuestionIds[index];
}

function isSummaryCache(value: unknown): value is SummaryCache {
	if (!isObjectRecord(value)) return false;
	for (const entry of Object.values(value)) {
		if (!isSummaryCacheEntry(entry)) return false;
	}
	return true;
}

export function lookupCachedSummary(options: { sessionId: string; cardId: string; answer: string; questionId?: string }): string | null {
	const parsed = parseJsonFromStorage(summariesKey(options.sessionId));
	const cache = isSummaryCache(parsed) ? parsed : {};
	const cacheKey = `${options.cardId}:${options.questionId ?? "freeform"}`;
	if (cacheKey in cache && cache[cacheKey].answer === options.answer) {
		return cache[cacheKey].summary;
	}
	return null;
}

export function saveCachedSummary(options: { sessionId: string; cardId: string; answer: string; summary: string; questionId?: string }): void {
	const parsed = parseJsonFromStorage(summariesKey(options.sessionId));
	const cache = isSummaryCache(parsed) ? parsed : {};
	const cacheKey = `${options.cardId}:${options.questionId ?? "freeform"}`;
	cache[cacheKey] = { answer: options.answer, summary: options.summary };
	localStorage.setItem(summariesKey(options.sessionId), JSON.stringify(cache));
	touchSession(options.sessionId);
}

const summaryInflight = new Map<string, Promise<string>>();

export function fetchOrGetCachedSummary(options: { sessionId: string; cardId: string; questionId?: string; answer: string }): Promise<string> {
	const cached = lookupCachedSummary(options);
	if (cached !== null) {
		return Promise.resolve(cached);
	}

	const inflightKey = `${options.cardId}:${options.questionId ?? "freeform"}:${options.answer}`;
	const existing = summaryInflight.get(inflightKey);
	if (existing !== undefined) {
		return existing;
	}

	const promise = fetchSummary({
		cardId: options.cardId,
		...(options.questionId !== undefined ? { questionId: options.questionId } : {}),
		answer: options.answer,
	})
		.then((result) => {
			saveCachedSummary({ sessionId: options.sessionId, cardId: options.cardId, answer: options.answer, summary: result.summary, questionId: options.questionId });
			return result.summary;
		})
		.finally(() => {
			summaryInflight.delete(inflightKey);
		});

	summaryInflight.set(inflightKey, promise);
	return promise;
}

function isFreeformNotes(value: unknown): value is FreeformNotes {
	if (!isObjectRecord(value)) return false;
	for (const v of Object.values(value)) {
		if (typeof v !== "string") return false;
	}
	return true;
}

function loadFreeformNotesInternal(sessionId: string): FreeformNotes {
	const parsed = parseJsonFromStorage(freeformKey(sessionId));
	return isFreeformNotes(parsed) ? parsed : {};
}

function isStatementSelections(value: unknown): value is StatementSelections {
	if (!isObjectRecord(value)) return false;
	for (const v of Object.values(value)) {
		if (!isStringArray(v)) return false;
	}
	return true;
}

function loadStatementSelectionsInternal(sessionId: string): StatementSelections {
	const parsed = parseJsonFromStorage(statementsKey(sessionId));
	return isStatementSelections(parsed) ? parsed : {};
}

// --- Global (non-session-scoped) ---

export function loadLlmTestState(): LlmTestState | null {
	const parsed = parseJsonFromStorage(LLM_TEST_KEY);
	if (!isObjectRecord(parsed)) {
		return null;
	}
	if (typeof parsed.cardId !== "string") {
		return null;
	}
	if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
		return null;
	}

	const rows: LlmTestRow[] = parsed.rows.map((row) => {
		if (!isObjectRecord(row)) {
			return {
				questionId: DEFAULT_QUESTION_ID,
				answer: "",
			};
		}
		return {
			questionId: typeof row.questionId === "string" ? row.questionId : DEFAULT_QUESTION_ID,
			answer: typeof row.answer === "string" ? row.answer : "",
		};
	});

	return {
		cardId: parsed.cardId,
		rows,
	};
}

export function saveLlmTestState(data: LlmTestState): void {
	localStorage.setItem(LLM_TEST_KEY, JSON.stringify(data));
}

// --- Progress detection ---

export type ProgressPhase = "explore" | "prioritize-complete" | "prioritize" | "swipe" | "none";

export function detectSessionPhase(id: string): ProgressPhase {
	const chosenRaw = parseJsonFromStorage(`somecam-${id}-chosen`);
	if (isStringArray(chosenRaw) && chosenRaw.length > 0) {
		return "explore";
	}
	const narrowRaw = parseJsonFromStorage(`somecam-${id}-narrowdown`);
	if (isObjectRecord(narrowRaw) && isStringArray(narrowRaw.cardIds) && narrowRaw.cardIds.length > 0 && Array.isArray(narrowRaw.comparisons) && typeof narrowRaw.complete === "boolean") {
		return narrowRaw.complete ? "prioritize-complete" : "prioritize";
	}
	const progressRaw = parseJsonFromStorage(`somecam-${id}-progress`);
	if (isObjectRecord(progressRaw) && Array.isArray(progressRaw.swipeHistory) && progressRaw.swipeHistory.length > 0) {
		return "swipe";
	}
	return "none";
}

export function isExplorePhaseComplete(sessionId: string): boolean {
	const chosenCardIds = loadChosenCardIds(sessionId);
	const data = loadExploreData(sessionId);
	if (chosenCardIds === null || data === null) {
		return false;
	}

	return chosenCardIds.every((chosenId) => {
		if (!(chosenId in data)) return false;
		const cardData = data[chosenId];
		return cardData.entries.length === EXPLORE_QUESTIONS.length && cardData.entries.every((entry) => entry.submitted);
	});
}

// --- Export / Import ---

const EXPORT_VERSION_V2 = "somecam-v2";

export function exportProgressData(): string {
	const sessions = loadSessionsMeta();
	const exported: { id: string; name: string; createdAt: string; lastUpdatedAt: string; data: Record<string, unknown> }[] = [];
	for (const session of sessions) {
		const data: Record<string, unknown> = {};
		for (const suffix of SESSION_DATA_SUFFIXES) {
			const raw = localStorage.getItem(`somecam-${session.id}-${suffix}`);
			if (raw !== null) {
				data[suffix] = JSON.parse(raw);
			}
		}
		exported.push({ id: session.id, name: session.name, createdAt: session.createdAt, lastUpdatedAt: session.lastUpdatedAt, data });
	}
	return JSON.stringify({ version: EXPORT_VERSION_V2, sessions: exported });
}

export function exportSessionData(sessionId: string): string {
	const sessions = loadSessionsMeta();
	const session = sessions.find((s) => s.id === sessionId);
	if (session === undefined) {
		throw new Error(`Session not found: ${sessionId}`);
	}
	const data: Record<string, unknown> = {};
	for (const suffix of SESSION_DATA_SUFFIXES) {
		const raw = localStorage.getItem(`somecam-${sessionId}-${suffix}`);
		if (raw !== null) {
			data[suffix] = JSON.parse(raw);
		}
	}
	return JSON.stringify({
		version: EXPORT_VERSION_V2,
		sessions: [{ id: session.id, name: session.name, createdAt: session.createdAt, lastUpdatedAt: session.lastUpdatedAt, data }],
	});
}

export function importProgressData(json: string): ImportProgressStats {
	const parsed: unknown = JSON.parse(json);
	if (!isObjectRecord(parsed)) {
		throw new Error("Invalid progress data: expected an object");
	}
	const obj = parsed;

	if (obj.version !== EXPORT_VERSION_V2) {
		throw new Error(`Invalid progress data: unsupported version "${String(obj.version)}"`);
	}

	if (!Array.isArray(obj.sessions)) {
		throw new Error("Invalid progress data: expected sessions array");
	}

	ensureSessionsInitialized();
	const existingSessions = loadSessionsMeta();
	const stats: ImportProgressStats = {
		sessions: obj.sessions.length,
		finalSessionsAdded: 0,
		sessionsOverridden: 0,
	};

	for (const entry of obj.sessions) {
		if (!isObjectRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.createdAt !== "string") {
			continue;
		}
		const data = isObjectRecord(entry.data) ? entry.data : {};

		// Write session data keys
		for (const suffix of SESSION_DATA_SUFFIXES) {
			const key = `somecam-${entry.id}-${suffix}`;
			if (suffix in data) {
				localStorage.setItem(key, JSON.stringify(data[suffix]));
			} else {
				localStorage.removeItem(key);
			}
		}

		// Update or add session metadata
		const existingIndex = existingSessions.findIndex((s) => s.id === entry.id);
		const meta: SessionMeta = {
			id: entry.id,
			name: entry.name,
			createdAt: entry.createdAt,
			lastUpdatedAt: typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt : entry.createdAt,
		};
		if (existingIndex !== -1) {
			existingSessions[existingIndex] = meta;
			stats.sessionsOverridden++;
		} else {
			existingSessions.push(meta);
			stats.finalSessionsAdded++;
		}
	}

	saveSessionsMeta(existingSessions);
	return stats;
}

export function saveProgressFile(): void {
	const sessions = loadSessionsMeta().length;
	const json = exportProgressData();
	capture("sessions_exported", { sessions });
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "somecam-sessions.json";
	a.click();
	URL.revokeObjectURL(url);
}

export function requestStoragePersistence(sessionId: string): void {
	if (sessionStorage.getItem(PERSIST_REQUESTED_KEY) === null) {
		sessionStorage.setItem(PERSIST_REQUESTED_KEY, "1");
		void navigator.storage.persist().then(
			(granted) => {
				capture("storage_persistence_result", {
					session_id: sessionId,
					granted,
				});
			},
			() => {
				capture("storage_persistence_result", {
					session_id: sessionId,
					granted: false,
				});
			},
		);
	}
}

// --- Rate limit session token ---

export function loadRateLimitToken(): string | null {
	return localStorage.getItem(RATE_LIMIT_SESSION_KEY);
}

export function saveRateLimitToken(token: string): void {
	localStorage.setItem(RATE_LIMIT_SESSION_KEY, token);
}

export function loadProgressFile(): Promise<void> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file === undefined) {
				capture("sessions_import_cancelled");
				resolve();
				return;
			}
			file.text().then(
				(text) => {
					try {
						const stats = importProgressData(text);
						capture("sessions_imported", {
							sessions: stats.sessions,
							final_sessions_added: stats.finalSessionsAdded,
							sessions_overridden: stats.sessionsOverridden,
						});
						resolve();
					} catch (error) {
						capture("sessions_import_failed", { error_type: importErrorType(error) });
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				},
				(error: unknown) => {
					capture("sessions_import_failed", { error_type: "file_read_error" });
					reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
		input.click();
	});
}
