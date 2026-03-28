// Profile data types shared between ProfileView.vue (browser), ProfileContent.vue,
// pdf-entry.ts (server-side rendering), and backend/pdf-profile.ts (data assembly).

import type { MeaningCard } from "./meaning-cards.ts";

export interface QuestionProfile {
	topic: string;
	question: string;
	answer: string;
}

export interface CardProfile {
	card: MeaningCard;
	questions: QuestionProfile[];
	selectedDescriptions: string[];
	freeformNote: string;
	synthesis: string;
	synthesisLoading?: boolean;
	synthesisError?: boolean;
}
