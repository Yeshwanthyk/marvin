import type { TUI } from "../tui.js";
import { Text } from "./text.js";

/**
 * Loader with bouncing dot
 */
export class Loader extends Text {
	private frames = ["    ", ".   ", "..  ", "... ", "....", " ...", "  ..", "   ."];
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;

	constructor(
		ui: TUI,
		private accentColorFn: (str: string) => string,
		private dimColorFn: (str: string) => string,
		private message: string = "",
	) {
		super("", 1, 0);
		this.ui = ui;
		this.start();
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start() {
		this.updateDisplay();
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, 120);
	}

	stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	setMessage(message: string) {
		this.message = message;
		this.updateDisplay();
	}

	private updateDisplay() {
		const dots = this.accentColorFn(this.frames[this.currentFrame]);
		const msg = this.message ? this.dimColorFn(this.message) + " " : "";
		this.setText(`${msg}${dots}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
