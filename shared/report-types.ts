// Report data types shared between ReportView.vue (browser), ReportContent.vue,
// pdf-entry.ts (server-side rendering), and backend/pdf-report.ts (data assembly).

import type { MeaningCard } from "./meaning-cards.ts";

export interface QuestionReport {
	topic: string;
	question: string;
	answer: string;
	summary: string;
}

export interface CardReport {
	card: MeaningCard;
	questions: QuestionReport[];
	selectedStatements: string[];
	freeformNote: string;
	freeformSummary: string;
	synthesis: string;
}
