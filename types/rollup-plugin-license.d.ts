// Override for rollup-plugin-license: the bundled `dist/index.d.ts` declares an
// ESM-style `export default`, but the runtime uses `module.exports = fn` (CJS).
// Under `module: NodeNext`, that mismatch makes the default import unusable.
// Re-declare with `export =` so the types match the runtime.
declare module "rollup-plugin-license" {
	import type { Plugin } from "rollup";

	export interface Person {
		readonly name: string;
		readonly email: string | null;
		readonly url: string | null;
		text: () => string;
	}

	export interface DependencyRepository {
		readonly url: string;
		readonly type: string;
	}

	export interface Dependency {
		readonly name: string | null;
		readonly maintainers: string[];
		readonly version: string | null;
		readonly description: string | null;
		readonly repository: string | DependencyRepository | null;
		readonly homepage: string | null;
		readonly private: boolean;
		readonly license: string | null;
		readonly licenseText: string | null;
		readonly noticeText: string | null;
		readonly author: Person | null;
		readonly contributors: Person[];
		text: () => string;
	}

	export interface ThirdPartyOutputOptions {
		file: string;
		encoding?: string;
		template?: string | ((dependencies: Dependency[]) => string);
	}

	export interface ThirdPartyOptions {
		output: string | ThirdPartyOutputOptions | ((dependencies: Dependency[]) => void) | (string | ThirdPartyOutputOptions | ((dependencies: Dependency[]) => void))[];
		includePrivate?: boolean;
		includeSelf?: boolean;
		multipleVersions?: boolean;
	}

	export interface Options {
		sourcemap?: boolean | string;
		debug?: boolean;
		cwd?: string;
		thirdParty?: ThirdPartyOptions | ((dependencies: Dependency[]) => void);
	}

	function rollupPluginLicense(options: Options): Plugin;
	export = rollupPluginLicense;
}
