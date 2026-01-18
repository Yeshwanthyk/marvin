export {
	MESSAGE_CAP,
	appendWithCap,
	extractOrderedBlocks,
	extractThinking,
	extractToolCalls,
	extractText,
	getEditDiffText,
	getToolText,
	type ExtractedToolCall,
	type OrderedBlock,
} from "@domain/messaging/content.js"

export { findGitHeadPath, getCurrentBranch } from "@runtime/git/git-info.js"
