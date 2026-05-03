import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface MarvinDocsPaths {
	readmePath: string;
	docsPath: string;
	examplesPath: string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

const packageRootCandidates = [
	resolve(moduleDir, ".."),
	resolve(moduleDir, "..", ".."),
	resolve(process.cwd(), "apps", "coding-agent"),
	resolve(process.cwd()),
];

export const resolveMarvinDocsPaths = (): MarvinDocsPaths => {
	const root = packageRootCandidates.find((candidate) =>
		existsSync(join(candidate, "README.md")) && existsSync(join(candidate, "docs"))
	) ?? packageRootCandidates[0];

	return {
		readmePath: join(root, "README.md"),
		docsPath: join(root, "docs"),
		examplesPath: join(root, "examples"),
	};
};
