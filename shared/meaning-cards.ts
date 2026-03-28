import { MEANING_SOURCES, MEANING_DESCRIPTIONS, type MeaningSource, type MeaningDescription } from "./meaning-descriptions.ts";

export interface MeaningCard {
	id: string;
	source: string;
	description: string;
}

export type SwipeDirection = "agree" | "disagree" | "unsure";

export const MEANING_CARDS: readonly MeaningCard[] = MEANING_SOURCES.map((source: MeaningSource) => {
	const description: MeaningDescription | undefined = MEANING_DESCRIPTIONS.find((d: MeaningDescription) => d.isPrimary && d.meaningId === source.id);
	if (description === undefined) {
		throw new Error(`could not find item in MEANING_DESCRIPTIONS for ${source.id}`);
	}
	return {
		id: source.id,
		source: source.name,
		description: description.text,
	};
});
