interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface ChatCompletionOptions {
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	maxTokens?: number;
	temperature?: number;
	responseFormat?: Record<string, unknown>;
	reasoningEffort?: "low" | "medium" | "high";
	debugPrompt?: boolean;
}

export async function createChatCompletion(options: ChatCompletionOptions): Promise<string> {
	const body: Record<string, unknown> = {
		model: options.model,
		messages: options.messages,
	};
	if (options.maxTokens !== undefined) {
		body.max_tokens = options.maxTokens;
	}
	if (options.temperature !== undefined) {
		body.temperature = options.temperature;
	}
	if (options.responseFormat !== undefined) {
		body.response_format = options.responseFormat;
	}
	if (options.reasoningEffort !== undefined) {
		body.reasoning_effort = options.reasoningEffort;
	}

	if (options.debugPrompt) {
		console.log("[DEBUG_PROMPT] Request:", JSON.stringify(body, null, 2));
	}

	const response = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${options.apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`X AI API error (${response.status.toString()}): ${text}`);
	}

	const text = await response.text();

	if (options.debugPrompt) {
		console.log("[DEBUG_PROMPT] Response:", text);
	}

	const raw: unknown = JSON.parse(text);
	if (typeof raw !== "object" || raw === null || !("choices" in raw) || !Array.isArray(raw.choices) || raw.choices.length === 0) {
		throw new Error("X AI API returned no choices.");
	}
	const firstChoice: unknown = raw.choices[0];
	if (typeof firstChoice !== "object" || firstChoice === null || !("message" in firstChoice) || typeof firstChoice.message !== "object" || firstChoice.message === null || !("content" in firstChoice.message) || typeof firstChoice.message.content !== "string" || firstChoice.message.content === "") {
		throw new Error("X AI API returned no choices.");
	}

	return firstChoice.message.content;
}
