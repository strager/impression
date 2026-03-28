export interface ExamineQuestion {
	id: string;
	topic: string;
	text: string;
	questionFirstPerson: string;
}

export const EXAMINE_QUESTIONS: readonly ExamineQuestion[] = [
	{
		id: "interpretation",
		topic: "Interpretation",
		text: "What did you have in mind when you chose this?",
		questionFirstPerson: "What did I have in mind when I chose this?",
	},
	{
		id: "significance",
		topic: "Significance",
		text: "Can you tell why this is of importance for you?",
		questionFirstPerson: "Why is this of importance for me?",
	},
	{
		id: "importance",
		topic: "Importance",
		text: "Has its importance changed through time? How is it now?",
		questionFirstPerson: "Has its importance changed through time? How is it now?",
	},
	{
		id: "threat",
		topic: "Threat",
		text: "Are you living according to this right now, or is something blocking it?",
		questionFirstPerson: "Am I living according to this right now, or is something blocking it?",
	},
	{
		id: "change",
		topic: "Change",
		text: "What should change to make it more salient in your life?",
		questionFirstPerson: "What should change to make it more salient in my life?",
	},
];
