// Generic numeric helpers used by the ranking algorithm.

export interface XorshiftRng {
	/** Return next value in (0, 1). */
	next(): number;
	/** Current internal state (readable/restorable). */
	state: number;
}

/** Create a xorshift32 PRNG returning values in (0, 1). */
export function makeXorshift(seed: number): XorshiftRng {
	let state = seed === 0 ? 1 : seed;
	return {
		next(): number {
			state ^= state << 13;
			state ^= state >> 17;
			state ^= state << 5;
			return (state >>> 0) / 0x100000000;
		},
		get state(): number {
			return state;
		},
		set state(s: number) {
			state = s;
		},
	};
}

/** Enumerate all C(n, m) combinations of [0, n) as sorted index arrays. */
export function enumerateCombinations(n: number, m: number): number[][] {
	const result: number[][] = [];
	const combo = new Array<number>(m);

	function recurse(start: number, depth: number): void {
		if (depth === m) {
			result.push([...combo]);
			return;
		}
		for (let i = start; i <= n - (m - depth); i++) {
			combo[depth] = i;
			recurse(i + 1, depth + 1);
		}
	}

	recurse(0, 0);
	return result;
}
