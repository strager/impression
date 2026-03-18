import { ref } from "vue";

import { capture } from "./analytics.ts";
import type { ProgressPhase, SessionMeta } from "./store.ts";
import { createSession, deleteSession, detectSessionPhase, ensureSessionsInitialized, listSessions, loadProgressFile, renameSession, saveProgressFile } from "./store.ts";

export class HomeViewModel {
	private readonly _sessions = ref<SessionMeta[]>([]);
	private readonly _sessionPhases = ref<Record<string, ProgressPhase>>({});
	private readonly _renamingId = ref<string | null>(null);
	private readonly _renameInput = ref("");

	get sessions(): SessionMeta[] {
		return this._sessions.value;
	}

	get sessionPhases(): Record<string, ProgressPhase> {
		return this._sessionPhases.value;
	}

	get renamingId(): string | null {
		return this._renamingId.value;
	}

	get renameInput(): string {
		return this._renameInput.value;
	}

	set renameInput(value: string) {
		this._renameInput.value = value;
	}

	initialize(): void {
		ensureSessionsInitialized();
		this.refreshState();
	}

	refreshState(): void {
		this._sessions.value = listSessions();
		const phases: Record<string, ProgressPhase> = {};
		for (const s of this._sessions.value) {
			phases[s.id] = detectSessionPhase(s.id);
		}
		this._sessionPhases.value = phases;
	}

	createSession(): string {
		const isFirst = this._sessions.value.length === 0;
		const newId = createSession();
		capture("session_created", { session_id: newId, is_first: isFirst });
		this.refreshState();
		return newId;
	}

	startRename(session: SessionMeta): void {
		this._renamingId.value = session.id;
		this._renameInput.value = session.name;
	}

	confirmRename(): void {
		if (this._renamingId.value === null) return;
		const id = this._renamingId.value;
		const trimmed = this._renameInput.value.trim();
		if (trimmed.length > 0) {
			renameSession(id, trimmed);
			capture("session_renamed", { session_id: id });
		}
		this._renamingId.value = null;
		this.refreshState();
	}

	cancelRename(): void {
		this._renamingId.value = null;
	}

	deleteSession(id: string): void {
		deleteSession(id);
		capture("session_deleted", { session_id: id });
		this.refreshState();
	}

	phaseForSession(id: string): ProgressPhase {
		return this._sessionPhases.value[id] ?? detectSessionPhase(id);
	}

	exportSessions(): void {
		saveProgressFile();
	}

	importSessions(): Promise<void> {
		return loadProgressFile().then(() => {
			this.refreshState();
		});
	}
}
