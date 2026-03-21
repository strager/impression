import { describe, expect, it } from "vitest";

import { splitSentences } from "./split-sentences.ts";

describe("splitSentences", () => {
	it("splits on periods", () => {
		expect(splitSentences("First sentence. Second sentence.")).toEqual(["First sentence.", " Second sentence."]);
	});

	it("splits on question marks", () => {
		expect(splitSentences("How are you? I am fine.")).toEqual(["How are you?", " I am fine."]);
	});

	it("splits on exclamation marks", () => {
		expect(splitSentences("Wow! That is great.")).toEqual(["Wow!", " That is great."]);
	});

	it("handles mixed punctuation", () => {
		expect(splitSentences("Hello. How are you? Great!")).toEqual(["Hello.", " How are you?", " Great!"]);
	});

	it("returns single sentence as-is", () => {
		expect(splitSentences("Just one sentence.")).toEqual(["Just one sentence."]);
	});

	it("returns text without terminal punctuation as one segment", () => {
		expect(splitSentences("No punctuation here")).toEqual(["No punctuation here"]);
	});

	it("handles trailing text after last sentence", () => {
		expect(splitSentences("A sentence. Then trailing text")).toEqual(["A sentence.", " Then trailing text"]);
	});

	it("preserves multiple spaces between sentences", () => {
		expect(splitSentences("First.  Second.")).toEqual(["First.", "  Second."]);
	});

	it("does not split on periods without trailing space", () => {
		expect(splitSentences("version 3.5 is out.")).toEqual(["version 3.5 is out."]);
	});

	it("returns empty array for empty string", () => {
		expect(splitSentences("")).toEqual([]);
	});

	it("handles ellipsis followed by a sentence", () => {
		expect(splitSentences("Wait... Really? Yes.")).toEqual(["Wait...", " Really?", " Yes."]);
	});
});
