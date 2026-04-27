import { ref } from "vue";

export interface LicenseEntry {
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

export class LicensesViewModel {
	private readonly _licenses: LicenseEntry[];
	private readonly _expanded = ref<Set<string>>(new Set());

	constructor(licenses: LicenseEntry[]) {
		this._licenses = licenses;
	}

	get licenses(): LicenseEntry[] {
		return this._licenses;
	}

	isExpanded(key: string): boolean {
		return this._expanded.value.has(key);
	}

	toggleExpanded(key: string): void {
		const next = new Set(this._expanded.value);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		this._expanded.value = next;
	}
}

function readStringField(obj: Record<string, unknown>, key: string): string | null {
	const value = obj[key];
	return typeof value === "string" ? value : null;
}

function readStringArrayField(obj: Record<string, unknown>, key: string): string[] {
	const value = obj[key];
	if (!Array.isArray(value)) return [];
	const items: unknown[] = value;
	return items.filter((v): v is string => typeof v === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function parseLicenses(raw: unknown): LicenseEntry[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const items: unknown[] = raw;
	const entries: LicenseEntry[] = [];
	for (const item of items) {
		if (!isPlainObject(item)) {
			continue;
		}
		entries.push({
			name: readStringField(item, "name"),
			version: readStringField(item, "version"),
			description: readStringField(item, "description"),
			license: readStringField(item, "license"),
			licenseText: readStringField(item, "licenseText"),
			noticeText: readStringField(item, "noticeText"),
			homepage: readStringField(item, "homepage"),
			repository: readStringField(item, "repository"),
			copyrights: readStringArrayField(item, "copyrights"),
		});
	}
	return entries;
}
