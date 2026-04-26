// Builds frontend/public/fonts/lucide-icons.woff2 from SVGs in the
// lucide-static package. Run with `npm run generate`.
//
// Requires uv to install PyPi's picosvg package. <https://docs.astral.sh/uv/>
import { generateFonts, FontAssetType } from "fantasticon";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const iconsDir = join(repoRoot, "node_modules/lucide-static/icons");
const outputDir = join(repoRoot, "frontend/public/fonts");

// Codepoint → Lucide icon name.
//
// The name must match a file in ../node_modules/lucide-static/icons/ (without
// .svg).
const codepoints: Record<number, string> = {
	0x270f: "pencil",
	0x232b: "delete",
};

const tmp = mkdtempSync(join(tmpdir(), "icon-font-"));
try {
	const fantasticonCodepoints: Record<string, number> = {};
	for (const [cpStr, name] of Object.entries(codepoints)) {
		const cp = Number(cpStr);
		const file = `${name}.svg`;
		const result = spawnSync("uvx", ["--quiet", "picosvg", join(iconsDir, file)], { encoding: "utf8" });
		if (result.status !== 0) {
			throw new Error(`picosvg failed for ${file}:\n${result.stderr}`);
		}
		writeFileSync(join(tmp, file), result.stdout);
		fantasticonCodepoints[name] = cp;
	}

	await generateFonts({
		inputDir: tmp,
		outputDir,
		name: "lucide-icons",
		fontTypes: [FontAssetType.WOFF2],
		assetTypes: [],
		normalize: true,
		// Without descent, glyphs sit entirely above the baseline at cap
		// height and tower over lowercase text. Pulling them below baseline
		// visually centers them on the body font's x-height. The 0.15 ratio
		// is empirical — eyeball it against PT Serif and adjust as needed.
		fontHeight: 300,
		descent: 300 * 0.15,
		codepoints: fantasticonCodepoints,
	});
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
