// @vitest-environment node

import { describe, expect, it } from "vitest";

import { LicensesViewModel, parseLicenses, type LicenseEntry } from "./LicensesViewModel.ts";

const sample: LicenseEntry[] = [
	{
		name: "vue",
		version: "3.5.13",
		description: "Vue.js",
		license: "MIT",
		licenseText: "MIT License...",
		noticeText: null,
		homepage: "https://vuejs.org/",
		repository: "https://github.com/vuejs/core.git",
		copyrights: ["Copyright (c) 2018-present, Yuxi (Evan) You"],
	},
];

describe("LicensesViewModel", () => {
	it("exposes the licenses array passed to the constructor", () => {
		const vm = new LicensesViewModel(sample);
		expect(vm.licenses).toEqual(sample);
	});

	it("toggles expanded state for a key", () => {
		const vm = new LicensesViewModel([]);
		expect(vm.isExpanded("vue")).toBe(false);
		vm.toggleExpanded("vue");
		expect(vm.isExpanded("vue")).toBe(true);
		vm.toggleExpanded("vue");
		expect(vm.isExpanded("vue")).toBe(false);
	});
});

describe("parseLicenses", () => {
	it("returns an empty array for non-array input", () => {
		expect(parseLicenses(null)).toEqual([]);
		expect(parseLicenses({})).toEqual([]);
		expect(parseLicenses("oops")).toEqual([]);
	});

	it("skips non-object items", () => {
		expect(parseLicenses([null, "string", 42])).toEqual([]);
	});

	it("reads known string fields and defaults missing fields", () => {
		const result = parseLicenses([
			{
				name: "vue",
				version: "3.5.13",
				license: "MIT",
				copyrights: ["Copyright (c) 2018-present, Yuxi (Evan) You"],
			},
		]);
		expect(result).toEqual([
			{
				name: "vue",
				version: "3.5.13",
				description: null,
				license: "MIT",
				licenseText: null,
				noticeText: null,
				homepage: null,
				repository: null,
				copyrights: ["Copyright (c) 2018-present, Yuxi (Evan) You"],
			},
		]);
	});

	it("filters non-string copyright entries", () => {
		const result = parseLicenses([{ name: "x", copyrights: ["ok", 42, null, "also ok"] }]);
		expect(result[0].copyrights).toEqual(["ok", "also ok"]);
	});
});
