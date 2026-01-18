import { accessSync, constants } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import * as os from "node:os";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") {
		return os.homedir();
	}
	if (normalized.startsWith("~/")) {
		return os.homedir() + normalized.slice(1);
	}
	return normalized;
}

export function resolvePathFromCwd(cwd: string, filePath: string): string {
	const expanded = expandPath(filePath);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolvePath(cwd, expanded);
}

export function resolveReadPathFromCwd(cwd: string, filePath: string): string {
	const expanded = expandPath(filePath);

	const candidate = isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);

	if (fileExists(candidate)) {
		return candidate;
	}

	const macOSVariant = tryMacOSScreenshotPath(candidate);
	if (macOSVariant !== candidate && fileExists(macOSVariant)) {
		return macOSVariant;
	}

	return candidate;
}
