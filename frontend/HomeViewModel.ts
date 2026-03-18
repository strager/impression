import { ref } from "vue";

import { capture } from "./analytics.ts";
import type { ProgressPhase, SessionMeta } from "./store.ts";
import { createSession, deleteSession, detectSessionPhase, ensureSessionsInitialized, listSessions, loadProgressFile, renameSession, saveProgressFile } from "./store.ts";

export class HomeViewModel {
	private readonly _sessions = ref<SessionMeta[]>([]);
	private readonly _sessionPhases = ref<Record<string, ProgressPhase>>({});
	private readonly _renameInputs = ref<Record<string, string>>({});

	get sessions(): SessionMeta[] {
		return this._sessions.value;
	}

	get sessionPhases(): Record<string, ProgressPhase> {
		return this._sessionPhases.value;
	}

	isRenaming(id: string): boolean {
		return id in this._renameInputs.value;
	}

	renameInputFor(id: string): string {
		return this._renameInputs.value[id] ?? "";
	}

	setRenameInput(id: string, value: string): void {
		this._renameInputs.value[id] = value;
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

	startRename(id: string, currentName: string): void {
		this._renameInputs.value[id] = currentName;
	}

	confirmRename(id: string): void {
		if (!this.isRenaming(id)) return;
		const trimmed = this._renameInputs.value[id].trim();
		if (trimmed.length > 0) {
			renameSession(id, trimmed);
			capture("session_renamed", { session_id: id });
		}
		this.clearRenameEntry(id);
		this.refreshState();
	}

	cancelRename(id: string): void {
		this.clearRenameEntry(id);
	}

	private clearRenameEntry(id: string): void {
		const { [id]: _, ...rest } = this._renameInputs.value;
		this._renameInputs.value = rest;
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
