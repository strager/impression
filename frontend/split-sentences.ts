export function splitSentences(text: string): string[] {
	return text.split(/(?<=[.!?])(?=\s)/).filter(Boolean);
}
