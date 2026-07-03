import type { ThemeMode } from "@yeshwanthyk/open-tui"

/** Detect system dark/light mode (macOS only, defaults to dark). */
export function detectThemeMode(): ThemeMode {
	try {
		const result = Bun.spawnSync(["defaults", "read", "-g", "AppleInterfaceStyle"])
		return result.stdout.toString().trim().toLowerCase() === "dark" ? "dark" : "light"
	} catch {
		return "dark"
	}
}
