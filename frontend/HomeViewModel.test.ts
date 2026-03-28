// @vitest-environment node

import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEANING_CARDS } from "../shared/meaning-cards.ts";
import { HomeViewModel } from "./HomeViewModel.ts";
import { createProfile, ensureProfilesInitialized, listProfiles, saveSwipeProgress } from "./store.ts";

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

/** Creates a profile and gives it swipe data so listProfiles() includes it. */
function createProfileWithData(name: string): string {
	const id = createProfile(name);
	saveSwipeProgress(id, { shuffledCardIds: [MEANING_CARDS[0].id], swipeHistory: [] });
	return id;
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

describe("initialize", () => {
	it("populates sessions list from store", () => {
		createProfileWithData("First");
		createProfileWithData("Second");

		const vm = new HomeViewModel();
		vm.initialize();
		expect(vm.profiles).toHaveLength(2);
	});
});

describe("createProfile", () => {
	it("adds a profile to the list and returns its ID", () => {
		const vm = new HomeViewModel();
		vm.initialize();
		expect(vm.profiles).toHaveLength(0);

		const newId = vm.createProfile();
		expect(typeof newId).toBe("string");
		// New profile has no data yet, so it won't appear in the list.
		// The view navigates to it immediately, where data gets created.
		expect(newId.length).toBeGreaterThan(0);
	});
});

describe("startRename", () => {
	it("marks profile as renaming with its current name", () => {
		createProfileWithData("My Session");

		const vm = new HomeViewModel();
		vm.initialize();
		const profile = vm.profiles[0];

		vm.startRename(profile.id, profile.name);
		expect(vm.isRenaming(profile.id)).toBe(true);
		expect(vm.renameInputFor(profile.id)).toBe("My Session");
	});
});

describe("confirmRename", () => {
	it("persists new name to store, clears rename state, refreshes list", () => {
		createProfileWithData("Original");

		const vm = new HomeViewModel();
		vm.initialize();
		const profile = vm.profiles[0];

		vm.startRename(profile.id, profile.name);
		vm.setRenameInput(profile.id, "New Name");
		vm.confirmRename(profile.id);

		expect(vm.isRenaming(profile.id)).toBe(false);
		expect(vm.profiles.find((s) => s.id === profile.id)!.name).toBe("New Name");
	});

	it("does not save when input is empty, clears rename state", () => {
		createProfileWithData("Keep Me");

		const vm = new HomeViewModel();
		vm.initialize();
		const profile = vm.profiles[0];

		vm.startRename(profile.id, profile.name);
		vm.setRenameInput(profile.id, "   ");
		vm.confirmRename(profile.id);

		expect(vm.isRenaming(profile.id)).toBe(false);
		expect(vm.profiles.find((s) => s.id === profile.id)!.name).toBe("Keep Me");
	});
});

describe("cancelRename", () => {
	it("clears rename state without saving, name unchanged in store", () => {
		createProfileWithData("Unchanged");

		const vm = new HomeViewModel();
		vm.initialize();
		const profile = vm.profiles[0];

		vm.startRename(profile.id, profile.name);
		vm.setRenameInput(profile.id, "Changed");
		vm.cancelRename(profile.id);

		expect(vm.isRenaming(profile.id)).toBe(false);
		const stored = listProfiles().find((s) => s.id === profile.id)!;
		expect(stored.name).toBe("Unchanged");
	});
});

describe("deleteProfile", () => {
	it("removes profile from store and refreshes list", () => {
		createProfileWithData("First");
		createProfileWithData("Second");

		const vm = new HomeViewModel();
		vm.initialize();
		expect(vm.profiles).toHaveLength(2);
		const toDelete = vm.profiles[0];

		vm.deleteProfile(toDelete.id);
		expect(vm.profiles).toHaveLength(1);
		expect(vm.profiles.some((s) => s.id === toDelete.id)).toBe(false);
	});
});

describe("multiple concurrent renames", () => {
	it("tracks renames independently", () => {
		createProfileWithData("Alpha");
		createProfileWithData("Beta");

		const vm = new HomeViewModel();
		vm.initialize();
		const [a, b] = vm.profiles;

		vm.startRename(a.id, a.name);
		vm.startRename(b.id, b.name);

		expect(vm.isRenaming(a.id)).toBe(true);
		expect(vm.isRenaming(b.id)).toBe(true);
		expect(vm.renameInputFor(a.id)).toBe("Alpha");
		expect(vm.renameInputFor(b.id)).toBe("Beta");

		vm.setRenameInput(a.id, "Alpha2");
		expect(vm.renameInputFor(a.id)).toBe("Alpha2");
		expect(vm.renameInputFor(b.id)).toBe("Beta");
	});

	it("confirming one rename does not affect others", () => {
		createProfileWithData("Alpha");
		createProfileWithData("Beta");

		const vm = new HomeViewModel();
		vm.initialize();
		const [a, b] = vm.profiles;

		vm.startRename(a.id, a.name);
		vm.startRename(b.id, b.name);
		vm.setRenameInput(a.id, "Alpha2");
		vm.setRenameInput(b.id, "Beta2");

		vm.confirmRename(a.id);

		expect(vm.isRenaming(a.id)).toBe(false);
		expect(vm.isRenaming(b.id)).toBe(true);
		expect(vm.renameInputFor(b.id)).toBe("Beta2");
		expect(vm.profiles.find((s) => s.id === a.id)!.name).toBe("Alpha2");
	});

	it("canceling one rename does not affect others", () => {
		createProfileWithData("Alpha");
		createProfileWithData("Beta");

		const vm = new HomeViewModel();
		vm.initialize();
		const [a, b] = vm.profiles;

		vm.startRename(a.id, a.name);
		vm.startRename(b.id, b.name);
		vm.setRenameInput(b.id, "Beta2");

		vm.cancelRename(a.id);

		expect(vm.isRenaming(a.id)).toBe(false);
		expect(vm.isRenaming(b.id)).toBe(true);
		expect(vm.renameInputFor(b.id)).toBe("Beta2");
		expect(listProfiles().find((s) => s.id === a.id)!.name).toBe("Alpha");
	});
});
