export class HistoryNavigator {
	private history: string[] = [];
	private index: number = -1; // -1 = not browsing, 0 = most recent, 1 = older, etc.

	add(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;

		if (this.history.length > 0 && this.history[0] === trimmed) return;
		this.history.unshift(trimmed);

		if (this.history.length > 100) {
			this.history.pop();
		}
	}

	exit(): void {
		this.index = -1;
	}

	isBrowsing(): boolean {
		return this.index > -1;
	}

	navigate(direction: 1 | -1): string | null {
		if (this.history.length === 0) return null;

		const newIndex = this.index - direction; // Up(-1) increases index, Down(1) decreases
		if (newIndex < -1 || newIndex >= this.history.length) return null;

		this.index = newIndex;

		if (this.index === -1) {
			return "";
		}

		return this.history[this.index] || "";
	}
}
