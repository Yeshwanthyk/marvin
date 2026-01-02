import type { Message, TextContent } from "@marvin-agents/ai"
import { createRuntime, type RuntimeInitArgs } from "@runtime/factory.js"

const readStdin = async (): Promise<string> => {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
	return Buffer.concat(chunks).toString("utf8")
}

const textFromBlocks = (blocks: Array<{ type: string }>): string => {
	const parts: string[] = []
	for (const block of blocks) {
		if (block.type === "text") parts.push((block as TextContent).text)
	}
	return parts.join("")
}

const renderMessage = (message: Message): string => {
	if (message.role === "user") {
		if (typeof message.content === "string") return message.content
		return textFromBlocks(message.content)
	}

	if (message.role === "assistant") {
		const parts: string[] = []
		for (const block of message.content) {
			if (block.type === "text") parts.push(block.text)
		}
		return parts.join("")
	}

	return textFromBlocks(message.content)
}

interface HeadlessArgs extends RuntimeInitArgs {
	prompt?: string
}

export const runHeadless = async (args: HeadlessArgs) => {
	const runtime = await createRuntime(
		{
			configDir: args.configDir,
			configPath: args.configPath,
			provider: args.provider,
			model: args.model,
			thinking: args.thinking,
		},
		"headless",
	)

	// Initialize hooks with no-op handlers for headless mode (single-shot, no UI)
	runtime.hookRunner.initialize({
		sendHandler: () => {},
		sendMessageHandler: () => {},
		appendEntryHandler: (customType, data) => runtime.sessionManager.appendEntry(customType, data),
		getSessionId: () => runtime.sessionManager.sessionId,
		getModel: () => runtime.agent.state.model,
		hasUI: false,
	})

	const prompt = (args.prompt ?? (await readStdin())).trim()
	if (!prompt) {
		process.stdout.write(JSON.stringify({ ok: false, error: "Empty prompt" }) + "\n")
		process.exitCode = 2
		return
	}

	try {
		// Emit agent.before_start hook (hooks can inject pre-prompt messages)
		await runtime.hookRunner.emitBeforeAgentStart(prompt)

		// Emit chat.message hook (hooks can mutate user message parts)
		const chatMessageOutput: { parts: Array<{ type: "text"; text: string }> } = {
			parts: [{ type: "text", text: prompt }],
		}
		await runtime.hookRunner.emitChatMessage(
			{ sessionId: runtime.sessionManager.sessionId, text: prompt },
			chatMessageOutput,
		)

		await runtime.agent.prompt(prompt)

		const conversation = runtime.agent.state.messages.filter((m): m is Message => {
			const role = (m as { role?: unknown }).role
			return role === "user" || role === "assistant" || role === "toolResult"
		})

		const lastAssistant = [...conversation].reverse().find((m) => m.role === "assistant")
		const assistant = lastAssistant ? renderMessage(lastAssistant) : ""

		process.stdout.write(
			JSON.stringify({
				ok: true,
				provider: runtime.config.provider,
				model: runtime.config.modelId,
				prompt,
				assistant,
				validationIssues: runtime.validationIssues,
			}) + "\n",
		)
	} catch (err) {
		process.stdout.write(
			JSON.stringify({
				ok: false,
				provider: runtime.config.provider,
				model: runtime.config.modelId,
				prompt,
				assistant: "",
				error: err instanceof Error ? err.message : String(err),
				validationIssues: runtime.validationIssues,
			}) + "\n",
		)
		process.exitCode = 1
	} finally {
		await runtime.lsp.shutdown().catch(() => {})
	}
}
