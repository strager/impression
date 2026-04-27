import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import vue from "@vitejs/plugin-vue";
import license, { type Dependency } from "rollup-plugin-license";
import { defineConfig } from "vite";

const projectRoot = resolve(import.meta.dirname, "..");
const localRequire = createRequire(import.meta.url);

const MANUAL_PACKAGES: readonly string[] = ["lucide-static"];

const LICENSE_FILE_CANDIDATES: readonly string[] = ["LICENSE", "LICENCE", "LICENSE.md", "LICENCE.md", "LICENSE.txt", "LICENCE.txt"];
const NOTICE_FILE_CANDIDATES: readonly string[] = ["NOTICE", "NOTICE.md", "NOTICE.txt"];

interface JsonEntry {
	name: string | null;
	version: string | null;
	description: string | null;
	license: string | null;
	licenseText: string | null;
	noticeText: string | null;
	homepage: string | null;
	repository: string | null;
	copyrights: string[];
}

function extractCopyrights(licenseText: string | null): string[] {
	if (licenseText === null) return [];
	const found: string[] = [];
	for (const rawLine of licenseText.split("\n")) {
		const line = rawLine.trim();
		if (!/^copyright\b.*\d{4}/i.test(line)) continue;
		if (!found.includes(line)) found.push(line);
	}
	return found;
}

function readFirstExisting(dir: string, candidates: readonly string[]): string | null {
	for (const name of candidates) {
		try {
			return readFileSync(join(dir, name), "utf-8");
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

function entryFromDependency(d: Dependency): JsonEntry {
	return {
		name: d.name,
		version: d.version,
		description: d.description,
		license: d.license,
		licenseText: d.licenseText,
		noticeText: d.noticeText,
		homepage: d.homepage,
		repository: typeof d.repository === "string" ? d.repository : (d.repository?.url ?? null),
		copyrights: extractCopyrights(d.licenseText),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
	const value = obj[key];
	return typeof value === "string" ? value : null;
}

function entryFromManualPackage(name: string): JsonEntry {
	const pkgJsonPath = localRequire.resolve(`${name}/package.json`);
	const pkgDir = dirname(pkgJsonPath);
	const pkgRaw: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
	if (!isPlainObject(pkgRaw)) {
		throw new Error(`Invalid package.json for ${name}`);
	}

	const repositoryField = pkgRaw.repository;
	let repository: string | null = null;
	if (typeof repositoryField === "string") {
		repository = repositoryField;
	} else if (isPlainObject(repositoryField) && typeof repositoryField.url === "string") {
		repository = repositoryField.url;
	}

	const licenseText = readFirstExisting(pkgDir, LICENSE_FILE_CANDIDATES);
	const noticeText = readFirstExisting(pkgDir, NOTICE_FILE_CANDIDATES);

	return {
		name: readString(pkgRaw, "name") ?? name,
		version: readString(pkgRaw, "version"),
		description: readString(pkgRaw, "description"),
		license: readString(pkgRaw, "license"),
		licenseText,
		noticeText,
		homepage: readString(pkgRaw, "homepage"),
		repository,
		copyrights: extractCopyrights(licenseText),
	};
}

export default defineConfig({
	root: resolve(projectRoot, "frontend"),
	plugins: [
		vue(),
		license({
			thirdParty: {
				output: {
					file: resolve(projectRoot, "frontend/licenses.json"),
					template(dependencies: Dependency[]): string {
						const entries: JsonEntry[] = [...dependencies.map(entryFromDependency), ...MANUAL_PACKAGES.map(entryFromManualPackage)];
						entries.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
						return JSON.stringify(entries, null, "\t");
					},
				},
			},
		}),
	],
	build: {
		write: false,
		minify: false,
		sourcemap: false,
		reportCompressedSize: false,
		emptyOutDir: false,
		copyPublicDir: false,
	},
	logLevel: "warn",
});
