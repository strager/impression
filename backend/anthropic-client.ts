interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

interface AnthropicOptions {
	apiKey: string;
	model: string;
	system?: string;
	messages: ChatMessage[];
	maxTokens: number;
	temperature?: number;
	debugPrompt?: boolean;
}

export async function createAnthropicCompletion(options: AnthropicOptions): Promise<string> {
	const body: Record<string, unknown> = {
		model: options.model,
		messages: options.messages,
		max_tokens: options.maxTokens,
	};
	if (options.system !== undefined) {
		body.system = options.system;
	}
	if (options.temperature !== undefined) {
		body.temperature = options.temperature;
	}

	if (options.debugPrompt) {
		console.log("[DEBUG_PROMPT] Anthropic request:", JSON.stringify(body, null, 2));
	}

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": options.apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Anthropic API error (${response.status.toString()}): ${text}`);
	}

	const text = await response.text();

	if (options.debugPrompt) {
		console.log("[DEBUG_PROMPT] Anthropic response:", text);
	}

	const raw: unknown = JSON.parse(text);
	if (typeof raw !== "object" || raw === null || !("content" in raw) || !Array.isArray(raw.content) || raw.content.length === 0) {
		throw new Error("Anthropic API returned no content.");
	}
	const firstBlock: unknown = raw.content[0];
	if (typeof firstBlock !== "object" || firstBlock === null || !("text" in firstBlock) || typeof firstBlock.text !== "string" || firstBlock.text === "") {
		throw new Error("Anthropic API returned no text content.");
	}

	return firstBlock.text;
}
