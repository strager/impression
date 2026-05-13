import { EXAMINE_QUESTIONS } from "../shared/examine-questions.ts";
import type { SwipeDirection } from "../shared/meaning-cards.ts";
import { capture } from "./analytics.ts";

const SESSIONS_KEY = "somecam-sessions";
const ACTIVE_SESSION_KEY = "somecam-active-session";
const LLM_TEST_KEY = "somecam-llm-test";
const PERSIST_REQUESTED_KEY = "somecam-persist-requested";
const RATE_LIMIT_SESSION_KEY = "somecam-api-session-id";
const PAPER_SIZE_KEY = "somecam-paper-size";

const SESSION_DATA_SUFFIXES = ["progress", "narrowdown", "prioritize", "chosen", "explore", "summaries", "freeform", "statements", "complete-visited"] as const;

const DEFAULT_QUESTION_ID = EXAMINE_QUESTIONS[0]?.id ?? "";

export interface ImportProgressStats {
	profiles: number;
	finalProfilesAdded: number;
	profilesOverridden: number;
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

export interface ProfileMeta {
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

export interface PairComparison {
	set: [string, string];
	best: string;
	worst: string;
}

export interface PrioritizeProgress {
	cardIds: string[];
	comparisons: PairComparison[];
	activeRound?: number;
	complete: boolean;
}

export interface ExamineEntry {
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

export interface CardExamineData {
	entries: ExamineEntry[];
	freeformNote: string;
	descriptionSelections: string[];
}
export type ExamineData = Record<string, CardExamineData>;
type SummaryCache = Record<string, { answer: string; summary: string }>;
type FreeformNotes = Partial<Record<string, string>>;
type DescriptionSelections = Partial<Record<string, string[]>>;

interface LlmTestRow {
	questionId: string;
	answer: string;
}

export interface LlmTestState {
	cardId: string;
	rows: LlmTestRow[];
	selectedDescriptions: string[];
	freeformNote: string;
}

// --- Profile management ---

function generateUUID(): string {
	return crypto.randomUUID();
}

export function formatProfileDate(date: Date): string {
	return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function isSameDate(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function loadProfilesMeta(): ProfileMeta[] {
	const parsed = parseJsonFromStorage(SESSIONS_KEY);
	if (!Array.isArray(parsed)) {
		return [];
	}
	const result: ProfileMeta[] = [];
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

function saveProfilesMeta(profiles: ProfileMeta[]): void {
	localStorage.setItem(SESSIONS_KEY, JSON.stringify(profiles));
}

export function ensureProfilesInitialized(): void {
	if (localStorage.getItem(SESSIONS_KEY) !== null) {
		return;
	}
	const id = generateUUID();
	const now = new Date().toISOString();
	const meta: ProfileMeta = {
		id,
		name: formatProfileDate(new Date()),
		createdAt: now,
		lastUpdatedAt: now,
	};
	saveProfilesMeta([meta]);
	localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

export function getActiveProfileId(): string {
	ensureProfilesInitialized();
	const id = localStorage.getItem(ACTIVE_SESSION_KEY);
	if (id !== null) {
		return id;
	}
	const profiles = loadProfilesMeta();
	if (profiles.length > 0) {
		localStorage.setItem(ACTIVE_SESSION_KEY, profiles[0].id);
		return profiles[0].id;
	}
	ensureProfilesInitialized();
	// ensureProfilesInitialized always creates a profile and sets the active key
	const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
	if (activeId === null) {
		throw new Error("ensureProfilesInitialized failed to create a profile");
	}
	return activeId;
}

function profileHasData(id: string): boolean {
	return SESSION_DATA_SUFFIXES.some((suffix) => localStorage.getItem(`somecam-${id}-${suffix}`) !== null);
}

export function listProfiles(): ProfileMeta[] {
	ensureProfilesInitialized();
	const all = loadProfilesMeta();
	const nonEmpty = all.filter((s) => profileHasData(s.id));
	if (nonEmpty.length < all.length) {
		saveProfilesMeta(all.filter((s) => profileHasData(s.id) || s.id === localStorage.getItem(ACTIVE_SESSION_KEY)));
	}
	return nonEmpty;
}

export function createProfile(name?: string): string {
	ensureProfilesInitialized();
	const id = generateUUID();
	const now = new Date().toISOString();
	const meta: ProfileMeta = {
		id,
		name: name ?? formatProfileDate(new Date()),
		createdAt: now,
		lastUpdatedAt: now,
	};
	const profiles = loadProfilesMeta();
	profiles.push(meta);
	saveProfilesMeta(profiles);
	localStorage.setItem(ACTIVE_SESSION_KEY, id);
	return id;
}

export function renameProfile(id: string, newName: string): void {
	const profiles = loadProfilesMeta();
	const profile = profiles.find((s) => s.id === id);
	if (profile === undefined) {
		throw new Error(`Profile not found: ${id}`);
	}
	profile.name = newName;
	saveProfilesMeta(profiles);
}

export function getProfileName(id: string): string | null {
	const profiles = loadProfilesMeta();
	const profile = profiles.find((s) => s.id === id);
	return profile?.name ?? null;
}

export function deleteProfile(id: string): void {
	const profiles = loadProfilesMeta();
	const index = profiles.findIndex((s) => s.id === id);
	if (index === -1) {
		throw new Error(`Profile not found: ${id}`);
	}

	for (const suffix of SESSION_DATA_SUFFIXES) {
		localStorage.removeItem(`somecam-${id}-${suffix}`);
	}

	profiles.splice(index, 1);

	if (profiles.length === 0) {
		const newId = generateUUID();
		const now = new Date().toISOString();
		const meta: ProfileMeta = {
			id: newId,
			name: formatProfileDate(new Date()),
			createdAt: now,
			lastUpdatedAt: now,
		};
		profiles.push(meta);
		localStorage.setItem(ACTIVE_SESSION_KEY, newId);
	} else if (localStorage.getItem(ACTIVE_SESSION_KEY) === id) {
		localStorage.setItem(ACTIVE_SESSION_KEY, profiles[profiles.length - 1].id);
	}

	saveProfilesMeta(profiles);
}

function touchProfile(profileId: string): void {
	const profiles = loadProfilesMeta();
	const profile = profiles.find((s) => s.id === profileId);
	if (profile !== undefined) {
		profile.lastUpdatedAt = new Date().toISOString();
		saveProfilesMeta(profiles);
	}
}

// --- Dynamic key resolution ---

function profileKey(profileId: string, suffix: string): string {
	return `somecam-${profileId}-${suffix}`;
}

function progressKey(profileId: string): string {
	return profileKey(profileId, "progress");
}
function prioritizeKey(profileId: string): string {
	return profileKey(profileId, "prioritize");
}
function chosenKey(profileId: string): string {
	return profileKey(profileId, "chosen");
}
function exploreKey(profileId: string): string {
	return profileKey(profileId, "explore");
}
function summariesKey(profileId: string): string {
	return profileKey(profileId, "summaries");
}
function freeformKey(profileId: string): string {
	return profileKey(profileId, "freeform");
}
function descriptionsKey(profileId: string): string {
	// localStorage key intentionally kept as "statements" for backward compatibility.
	return profileKey(profileId, "statements");
}
function completeVisitedKey(profileId: string): string {
	return profileKey(profileId, "complete-visited");
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

function toExamineEntry(value: unknown): ExamineEntry | null {
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

// --- Profile-scoped load/save ---

export function loadSwipeProgress(profileId: string): SwipeProgress | null {
	const parsed = parseJsonFromStorage(progressKey(profileId));
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

export function saveSwipeProgress(profileId: string, data: SwipeProgress): void {
	localStorage.setItem(progressKey(profileId), JSON.stringify(data));
	touchProfile(profileId);
}

export function loadPrioritizeProgress(profileId: string): PrioritizeProgress | null {
	const parsed = parseJsonFromStorage(prioritizeKey(profileId));
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
	const comparisons: PairComparison[] = [];
	for (const entry of parsed.comparisons) {
		if (!isObjectRecord(entry) || !isStringArray(entry.set) || entry.set.length !== 2 || typeof entry.best !== "string" || typeof entry.worst !== "string") {
			return null;
		}
		comparisons.push({ set: [entry.set[0], entry.set[1]], best: entry.best, worst: entry.worst });
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

export function savePrioritizeProgress(profileId: string, data: PrioritizeProgress): void {
	localStorage.setItem(prioritizeKey(profileId), JSON.stringify(data));
	touchProfile(profileId);
}

export function loadChosenCardIds(profileId: string): string[] | null {
	const parsed = parseJsonFromStorage(chosenKey(profileId));
	if (!isStringArray(parsed) || parsed.length === 0) {
		return null;
	}
	return parsed;
}

export function saveChosenCardIds(profileId: string, ids: string[]): void {
	localStorage.setItem(chosenKey(profileId), JSON.stringify(ids));
	touchProfile(profileId);
}

export function selectCandidateCards(profileId: string): string[] {
	const progress = loadSwipeProgress(profileId);
	if (progress === null) return [];
	const agreeCardIds = progress.swipeHistory.filter((r) => r.direction === "agree").map((r) => r.cardId);
	const unsureCardIds = progress.swipeHistory.filter((r) => r.direction === "unsure").map((r) => r.cardId);
	return agreeCardIds.length < 3 ? agreeCardIds.concat(unsureCardIds) : agreeCardIds;
}

export function needsPrioritization(profileId: string): boolean {
	const progress = loadPrioritizeProgress(profileId);
	if (progress !== null) {
		return progress.cardIds.length > 5;
	}
	return selectCandidateCards(profileId).length > 5;
}

export function loadExamineData(profileId: string): ExamineData | null {
	const parsed = parseJsonFromStorage(exploreKey(profileId));
	if (!isObjectRecord(parsed)) {
		return null;
	}

	const freeformNotes = loadFreeformNotesInternal(profileId);
	const descriptionSelections = loadDescriptionSelectionsInternal(profileId);

	const result: ExamineData = {};
	for (const [cardId, entries] of Object.entries(parsed)) {
		if (!Array.isArray(entries)) {
			return null;
		}

		const validEntries: ExamineEntry[] = [];
		for (const entry of entries) {
			const validEntry = toExamineEntry(entry);
			if (validEntry === null) {
				return null;
			}
			validEntries.push(validEntry);
		}
		const nonBlank = validEntries.filter((e) => e.userAnswer.trim() !== "");
		result[cardId] = {
			entries: nonBlank,
			freeformNote: freeformNotes[cardId] ?? "",
			descriptionSelections: descriptionSelections[cardId] ?? [],
		};
	}

	return result;
}

export function saveExamineData(profileId: string, data: ExamineData): void {
	const entriesRecord: Record<string, ExamineEntry[]> = {};
	const freeformRecord: FreeformNotes = {};
	const descriptionsRecord: DescriptionSelections = {};
	for (const [cardId, cardData] of Object.entries(data)) {
		entriesRecord[cardId] = cardData.entries;
		if (cardData.freeformNote !== "") {
			freeformRecord[cardId] = cardData.freeformNote;
		}
		if (cardData.descriptionSelections.length > 0) {
			descriptionsRecord[cardId] = cardData.descriptionSelections;
		}
	}
	localStorage.setItem(exploreKey(profileId), JSON.stringify(entriesRecord));
	localStorage.setItem(freeformKey(profileId), JSON.stringify(freeformRecord));
	localStorage.setItem(descriptionsKey(profileId), JSON.stringify(descriptionsRecord));
	touchProfile(profileId);
}

export function selectNextQuestion(allowedQuestionIds: string[], priorityQuestionIds: string[]): string {
	for (const q of EXAMINE_QUESTIONS) {
		if (allowedQuestionIds.includes(q.id) && priorityQuestionIds.includes(q.id)) {
			return q.id;
		}
	}
	for (const q of EXAMINE_QUESTIONS) {
		if (allowedQuestionIds.includes(q.id)) {
			return q.id;
		}
	}
	throw new Error("no allowed question found in EXAMINE_QUESTIONS");
}

function isSummaryCache(value: unknown): value is SummaryCache {
	if (!isObjectRecord(value)) return false;
	for (const entry of Object.values(value)) {
		if (!isSummaryCacheEntry(entry)) return false;
	}
	return true;
}

export function lookupCachedSynthesis(options: { profileId: string; cardId: string; fingerprint: string; short?: boolean }): string | null {
	const parsed = parseJsonFromStorage(summariesKey(options.profileId));
	const cache = isSummaryCache(parsed) ? parsed : {};
	const cacheKey = options.short === true ? `${options.cardId}:synthesis:short` : `${options.cardId}:synthesis`;
	if (cacheKey in cache && cache[cacheKey].answer === options.fingerprint) {
		return cache[cacheKey].summary;
	}
	return null;
}

export function saveCachedSynthesis(options: { profileId: string; cardId: string; fingerprint: string; synthesis: string; short?: boolean }): void {
	const parsed = parseJsonFromStorage(summariesKey(options.profileId));
	const cache = isSummaryCache(parsed) ? parsed : {};
	const cacheKey = options.short === true ? `${options.cardId}:synthesis:short` : `${options.cardId}:synthesis`;
	cache[cacheKey] = { answer: options.fingerprint, summary: options.synthesis };
	localStorage.setItem(summariesKey(options.profileId), JSON.stringify(cache));
	touchProfile(options.profileId);
}

function isFreeformNotes(value: unknown): value is FreeformNotes {
	if (!isObjectRecord(value)) return false;
	for (const v of Object.values(value)) {
		if (typeof v !== "string") return false;
	}
	return true;
}

function loadFreeformNotesInternal(profileId: string): FreeformNotes {
	const parsed = parseJsonFromStorage(freeformKey(profileId));
	return isFreeformNotes(parsed) ? parsed : {};
}

function isDescriptionSelections(value: unknown): value is DescriptionSelections {
	if (!isObjectRecord(value)) return false;
	for (const v of Object.values(value)) {
		if (!isStringArray(v)) return false;
	}
	return true;
}

function loadDescriptionSelectionsInternal(profileId: string): DescriptionSelections {
	const parsed = parseJsonFromStorage(descriptionsKey(profileId));
	return isDescriptionSelections(parsed) ? parsed : {};
}

// --- Global (non-profile-scoped) ---

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

	const selectedDescriptions: string[] = [];
	// Read from either the new "selectedDescriptions" key or the legacy "selectedStatements" key.
	const rawDescriptions = Array.isArray(parsed.selectedDescriptions) ? parsed.selectedDescriptions : Array.isArray(parsed.selectedStatements) ? parsed.selectedStatements : [];
	for (const s of rawDescriptions) {
		if (typeof s === "string") {
			selectedDescriptions.push(s);
		}
	}

	return {
		cardId: parsed.cardId,
		rows,
		selectedDescriptions,
		freeformNote: typeof parsed.freeformNote === "string" ? parsed.freeformNote : "",
	};
}

export function saveLlmTestState(data: LlmTestState): void {
	localStorage.setItem(LLM_TEST_KEY, JSON.stringify(data));
}

// --- Progress detection ---

export type ProgressPhase = "examine" | "prioritize-complete" | "prioritize" | "identify" | "none";

export function detectProfilePhase(id: string): ProgressPhase {
	const chosenRaw = parseJsonFromStorage(chosenKey(id));
	if (isStringArray(chosenRaw) && chosenRaw.length > 0) {
		return "examine";
	}
	const prioritizeRaw = parseJsonFromStorage(prioritizeKey(id));
	if (isObjectRecord(prioritizeRaw) && isStringArray(prioritizeRaw.cardIds) && prioritizeRaw.cardIds.length > 0 && Array.isArray(prioritizeRaw.comparisons) && typeof prioritizeRaw.complete === "boolean") {
		return prioritizeRaw.complete ? "prioritize-complete" : "prioritize";
	}
	const progressRaw = parseJsonFromStorage(progressKey(id));
	if (isObjectRecord(progressRaw) && Array.isArray(progressRaw.swipeHistory) && progressRaw.swipeHistory.length > 0) {
		return "identify";
	}
	return "none";
}

export function isCardFullyExamined(entries: readonly ExamineEntry[]): boolean {
	return entries.length === EXAMINE_QUESTIONS.length && entries.every((entry) => entry.submitted);
}

export function isExaminePhaseComplete(profileId: string): boolean {
	const chosenCardIds = loadChosenCardIds(profileId);
	const data = loadExamineData(profileId);
	if (chosenCardIds === null || data === null) {
		return false;
	}

	return chosenCardIds.every((chosenId) => {
		if (!(chosenId in data)) return false;
		return isCardFullyExamined(data[chosenId].entries);
	});
}

// --- Export / Import ---

const EXPORT_VERSION_V2 = "somecam-v2";

export function exportProgressData(): string {
	const profiles = loadProfilesMeta();
	const exported: { id: string; name: string; createdAt: string; lastUpdatedAt: string; data: Record<string, unknown> }[] = [];
	for (const profile of profiles) {
		const data: Record<string, unknown> = {};
		for (const suffix of SESSION_DATA_SUFFIXES) {
			const raw = localStorage.getItem(`somecam-${profile.id}-${suffix}`);
			if (raw !== null) {
				data[suffix] = JSON.parse(raw);
			}
		}
		exported.push({ id: profile.id, name: profile.name, createdAt: profile.createdAt, lastUpdatedAt: profile.lastUpdatedAt, data });
	}
	// JSON key "sessions" is kept for backward compatibility with existing exports.
	return JSON.stringify({ version: EXPORT_VERSION_V2, sessions: exported });
}

export function exportProfileData(profileId: string): string {
	const profiles = loadProfilesMeta();
	const profile = profiles.find((s) => s.id === profileId);
	if (profile === undefined) {
		throw new Error(`Profile not found: ${profileId}`);
	}
	const data: Record<string, unknown> = {};
	for (const suffix of SESSION_DATA_SUFFIXES) {
		const raw = localStorage.getItem(`somecam-${profileId}-${suffix}`);
		if (raw !== null) {
			data[suffix] = JSON.parse(raw);
		}
	}
	// JSON key "sessions" is kept for backward compatibility with existing exports.
	return JSON.stringify({
		version: EXPORT_VERSION_V2,
		sessions: [{ id: profile.id, name: profile.name, createdAt: profile.createdAt, lastUpdatedAt: profile.lastUpdatedAt, data }],
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

	// JSON key "sessions" is kept for backward compatibility with existing exports.
	if (!Array.isArray(obj.sessions)) {
		throw new Error("Invalid progress data: expected sessions array");
	}

	ensureProfilesInitialized();
	const existingProfiles = loadProfilesMeta();
	const stats: ImportProgressStats = {
		profiles: obj.sessions.length,
		finalProfilesAdded: 0,
		profilesOverridden: 0,
	};

	for (const entry of obj.sessions) {
		if (!isObjectRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.createdAt !== "string") {
			continue;
		}
		const data = isObjectRecord(entry.data) ? entry.data : {};

		// Write profile data keys
		for (const suffix of SESSION_DATA_SUFFIXES) {
			const key = `somecam-${entry.id}-${suffix}`;
			if (suffix in data) {
				localStorage.setItem(key, JSON.stringify(data[suffix]));
			} else {
				localStorage.removeItem(key);
			}
		}

		// Update or add profile metadata
		const existingIndex = existingProfiles.findIndex((s) => s.id === entry.id);
		const meta: ProfileMeta = {
			id: entry.id,
			name: entry.name,
			createdAt: entry.createdAt,
			lastUpdatedAt: typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt : entry.createdAt,
		};
		if (existingIndex !== -1) {
			existingProfiles[existingIndex] = meta;
			stats.profilesOverridden++;
		} else {
			existingProfiles.push(meta);
			stats.finalProfilesAdded++;
		}
	}

	saveProfilesMeta(existingProfiles);
	return stats;
}

export function saveProgressFile(): void {
	const profiles = loadProfilesMeta().length;
	const json = exportProgressData();
	capture("sessions_exported", { sessions: profiles });
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	// Filename kept as "impression-sessions.json" for backward compatibility.
	a.download = "impression-sessions.json";
	a.click();
	URL.revokeObjectURL(url);
}

export function requestStoragePersistence(profileId: string): void {
	if (sessionStorage.getItem(PERSIST_REQUESTED_KEY) === null) {
		sessionStorage.setItem(PERSIST_REQUESTED_KEY, "1");
		void navigator.storage.persist().then(
			(granted) => {
				capture("storage_persistence_result", {
					session_id: profileId,
					granted,
				});
			},
			() => {
				capture("storage_persistence_result", {
					session_id: profileId,
					granted: false,
				});
			},
		);
	}
}

// --- Paper size preference ---

export type PaperSize = "a4" | "letter";

const LETTER_REGIONS = new Set(["US", "CA", "MX", "CO", "CL", "PH", "GT", "CR", "PA", "SV", "HN", "NI", "DO", "VE", "BZ"]);

function detectDefaultPaperSize(): PaperSize {
	const lang = navigator.language;
	const parts = lang.split("-");
	const region = parts.length >= 2 ? parts[parts.length - 1].toUpperCase() : "";
	return LETTER_REGIONS.has(region) ? "letter" : "a4";
}

export function loadPaperSize(): PaperSize {
	const stored = localStorage.getItem(PAPER_SIZE_KEY);
	if (stored === "a4" || stored === "letter") {
		return stored;
	}
	return detectDefaultPaperSize();
}

export function savePaperSize(size: PaperSize): void {
	localStorage.setItem(PAPER_SIZE_KEY, size);
}

// --- Rate limit session token ---

export function loadRateLimitToken(): string | null {
	return localStorage.getItem(RATE_LIMIT_SESSION_KEY);
}

export function saveRateLimitToken(token: string): void {
	localStorage.setItem(RATE_LIMIT_SESSION_KEY, token);
}

// --- Reflect-visited tracking ---

export function hasVisitedExamineReflect(profileId: string, cardId: string): boolean {
	const parsed = parseJsonFromStorage(completeVisitedKey(profileId));
	if (!isStringArray(parsed)) {
		return false;
	}
	return parsed.includes(cardId);
}

export function markExamineReflectVisited(profileId: string, cardId: string): void {
	const parsed = parseJsonFromStorage(completeVisitedKey(profileId));
	const visited = isStringArray(parsed) ? parsed : [];
	if (!visited.includes(cardId)) {
		visited.push(cardId);
	}
	localStorage.setItem(completeVisitedKey(profileId), JSON.stringify(visited));
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
							sessions: stats.profiles,
							final_sessions_added: stats.finalProfilesAdded,
							sessions_overridden: stats.profilesOverridden,
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
