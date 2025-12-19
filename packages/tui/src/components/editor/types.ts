export interface EditorState {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
}

export interface LayoutLine {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
}

export interface VisualLine {
	logicalLine: number;
	startCol: number;
	length: number;
}
