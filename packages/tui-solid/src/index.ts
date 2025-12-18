// Core
export { runTui, type TuiConfig } from "./app.js"

// Contexts
export { AgentProvider, useAgent, type ToolBlock, type MessageItem } from "./context/agent.js"
export { PromptProvider, usePrompt } from "./context/prompt.js"
export { CommandProvider, useCommand, type SlashCommand, type Completion } from "./context/command.js"
export { ThemeProvider, useTheme, type Theme } from "./context/theme.js"

// Components
export { ChatMessage, type ChatMessageProps } from "./components/chat-message.js"
export { ToolBlock as ToolBlockComponent, type ToolBlockProps } from "./components/tool-block.js"
export { PromptInput, type PromptInputProps } from "./components/prompt-input.js"
export { Footer, type FooterProps } from "./components/footer.js"
export { Loader, type LoaderProps } from "./components/loader.js"
export { Autocomplete, type AutocompleteItem, type AutocompleteProps } from "./components/autocomplete.js"
export { Markdown, type MarkdownProps, InlineCode } from "./components/markdown.js"

// Utils
export { colors, type ColorKey } from "./utils/colors.js"
export { visibleWidth, truncateToWidth, wrapText, formatTokens, formatCost } from "./utils/text.js"
export {
  getToolColor,
  getStatusBg,
  renderToolHeader,
  renderToolBody,
  colorDiff,
  getToolSummary,
} from "./utils/tool-render.js"
