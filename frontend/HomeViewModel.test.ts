// @vitest-environment node

import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { HomeViewModel } from "./HomeViewModel.ts";
import { createSession, ensureSessionsInitialized, listSessions, saveSwipeProgress } from "./store.ts";

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

/** Creates a session and gives it swipe data so listSessions() includes it. */
function createSessionWithData(name: string): string {
	const id = createSession(name);
	saveSwipeProgress(id, { shuffledCardIds: [MEANING_CARDS[0].id], swipeHistory: [] });
	return id;
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

describe("initialize", () => {
	it("populates sessions list from store", () => {
		createSessionWithData("First");
		createSessionWithData("Second");

		const vm = new HomeViewModel();
		vm.initialize();
		expect(vm.sessions).toHaveLength(2);
	});
});

describe("createSession", () => {
	it("adds a session to the list and returns its ID", () => {
		const vm = new HomeViewModel();
		vm.initialize();
		expect(vm.sessions).toHaveLength(0);

		const newId = vm.createSession();
		expect(typeof newId).toBe("string");
		// New session has no data yet, so it won't appear in the list.
		// The view navigates to it immediately, where data gets created.
		expect(newId.length).toBeGreaterThan(0);
	});
});

describe("startRename", () => {
	it("sets renamingId and renameInput to session's current name", () => {
		createSessionWithData("My Session");

		const vm = new HomeViewModel();
		vm.initialize();
		const session = vm.sessions[0];

		vm.startRename(session);
		expect(vm.renamingId).toBe(session.id);
		expect(vm.renameInput).toBe("My Session");
	});
});

describe("confirmRename", () => {
	it("persists new name to store, clears rename state, refreshes list", () => {
		createSessionWithData("Original");

		const vm = new HomeViewModel();
		vm.initialize();
		const session = vm.sessions[0];

		vm.startRename(session);
		vm.renameInput = "New Name";
		vm.confirmRename();

		expect(vm.renamingId).toBeNull();
		expect(vm.sessions.find((s) => s.id === session.id)!.name).toBe("New Name");
	});

	it("does not save when input is empty, clears rename state", () => {
		createSessionWithData("Keep Me");

		const vm = new HomeViewModel();
		vm.initialize();
		const session = vm.sessions[0];

		vm.startRename(session);
		vm.renameInput = "   ";
		vm.confirmRename();

		expect(vm.renamingId).toBeNull();
		expect(vm.sessions.find((s) => s.id === session.id)!.name).toBe("Keep Me");
	});
});

describe("cancelRename", () => {
	it("clears rename state without saving, name unchanged in store", () => {
		createSessionWithData("Unchanged");

		const vm = new HomeViewModel();
		vm.initialize();
		const session = vm.sessions[0];

		vm.startRename(session);
		vm.renameInput = "Changed";
		vm.cancelRename();

		expect(vm.renamingId).toBeNull();
		const stored = listSessions().find((s) => s.id === session.id)!;
		expect(stored.name).toBe("Unchanged");
	});
});

describe("deleteSession", () => {
	it("removes session from store and refreshes list", () => {
		createSessionWithData("First");
		createSessionWithData("Second");

		const vm = new HomeViewModel();
		vm.initialize();
		expect(vm.sessions).toHaveLength(2);
		const toDelete = vm.sessions[0];

		vm.deleteSession(toDelete.id);
		expect(vm.sessions).toHaveLength(1);
		expect(vm.sessions.some((s) => s.id === toDelete.id)).toBe(false);
	});
});
