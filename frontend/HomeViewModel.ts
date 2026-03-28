import { ref } from "vue";

import { capture } from "./analytics.ts";
import type { ProgressPhase, ProfileMeta } from "./store.ts";
import { createProfile, deleteProfile, detectProfilePhase, ensureProfilesInitialized, listProfiles, loadProgressFile, renameProfile, saveProgressFile } from "./store.ts";

export class HomeViewModel {
	private readonly _profiles = ref<ProfileMeta[]>([]);
	private readonly _profilePhases = ref<Record<string, ProgressPhase>>({});
	private readonly _renameInputs = ref<Record<string, string>>({});

	get profiles(): ProfileMeta[] {
		return this._profiles.value;
	}

	get profilePhases(): Record<string, ProgressPhase> {
		return this._profilePhases.value;
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
		ensureProfilesInitialized();
		this.refreshState();
	}

	refreshState(): void {
		this._profiles.value = listProfiles();
		const phases: Record<string, ProgressPhase> = {};
		for (const s of this._profiles.value) {
			phases[s.id] = detectProfilePhase(s.id);
		}
		this._profilePhases.value = phases;
	}

	createProfile(): string {
		const isFirst = this._profiles.value.length === 0;
		const newId = createProfile();
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
			renameProfile(id, trimmed);
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

	deleteProfile(id: string): void {
		deleteProfile(id);
		capture("session_deleted", { session_id: id });
		this.refreshState();
	}

	phaseForProfile(id: string): ProgressPhase {
		return this._profilePhases.value[id] ?? detectProfilePhase(id);
	}

	exportProfiles(): void {
		saveProgressFile();
	}

	importProfiles(): Promise<void> {
		return loadProgressFile().then(() => {
			this.refreshState();
		});
	}
}
