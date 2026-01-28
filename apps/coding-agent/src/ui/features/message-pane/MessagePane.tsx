import type { ToolBlock, UIMessage } from "../../../types.js"
import { MessageList } from "../../../components/MessageList.js"

export interface MessagePaneProps {
	messages: UIMessage[]
	toolBlocks: ToolBlock[]
	thinkingVisible: boolean
	diffWrapMode: "word" | "none"
	concealMarkdown: boolean
	isToolExpanded: (id: string) => boolean
	toggleToolExpanded: (id: string) => void
	isThinkingExpanded: (id: string) => boolean
	toggleThinkingExpanded: (id: string) => void
	onEditFile: (filePath: string, line?: number) => void
}

export function MessagePane(props: MessagePaneProps) {
	return (
		<scrollbox stickyScroll stickyStart="bottom" viewportCulling={false} flexGrow={props.messages.length > 0 ? 1 : 0} flexShrink={1}>
			<MessageList
				messages={props.messages}
				toolBlocks={props.toolBlocks}
				thinkingVisible={props.thinkingVisible}
				diffWrapMode={props.diffWrapMode}
				concealMarkdown={props.concealMarkdown}
				isToolExpanded={props.isToolExpanded}
				toggleToolExpanded={props.toggleToolExpanded}
				isThinkingExpanded={props.isThinkingExpanded}
				toggleThinkingExpanded={props.toggleThinkingExpanded}
				onEditFile={props.onEditFile}
			/>
		</scrollbox>
	)
}
