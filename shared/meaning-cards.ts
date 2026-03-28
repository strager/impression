import { MEANING_SOURCES, MEANING_EXPRESSIONS, type MeaningSource, type MeaningExpression } from "./meaning-expressions.ts";

export interface MeaningCard {
	id: string;
	source: string;
	description: string;
}

export type SwipeDirection = "agree" | "disagree" | "unsure";

export const MEANING_CARDS: readonly MeaningCard[] = MEANING_SOURCES.map((source: MeaningSource) => {
	const description: MeaningExpression | undefined = MEANING_EXPRESSIONS.find((d: MeaningExpression) => d.isPrimary && d.meaningId === source.id);
	if (description === undefined) {
		throw new Error(`could not find item in MEANING_EXPRESSIONS for ${source.id}`);
	}
	return {
		id: source.id,
		source: source.name,
		description: description.text,
	};
});
