import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface InstallArgs {
	source?: string;
	configDir?: string;
	configPath?: string;
}

type InstallSource =
	| { type: "npm"; spec: string }
	| { type: "github"; owner: string; repo: string; ref?: string; url: string };

const defaultConfigDir = () => join(homedir(), ".config", "marvin");

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "--");

const run = async (command: string, args: string[], cwd?: string): Promise<void> =>
	new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			cwd,
			stdio: "inherit",
			shell: false,
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
			}
		});
	});

const capture = async (command: string, args: string[]): Promise<string> =>
	new Promise((resolve, reject) => {
		const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code ?? 1}`));
			}
		});
	});

export const parseInstallSource = (raw: string): InstallSource => {
	const source = raw.trim();
	if (!source) throw new Error("Missing install source");

	const npmPrefix = "npm:";
	if (source.startsWith(npmPrefix)) {
		const spec = source.slice(npmPrefix.length).trim();
		if (!spec) throw new Error("Missing npm package after npm:");
		return { type: "npm", spec };
	}

	const githubPrefix = "github:";
	if (source.startsWith(githubPrefix)) {
		return parseGitHubSpec(source.slice(githubPrefix.length));
	}

	if (source.startsWith("git:github.com/")) {
		return parseGitHubSpec(source.slice("git:".length));
	}

	if (source.startsWith("https://github.com/") || source.startsWith("ssh://git@github.com/")) {
		return parseGitHubSpec(source);
	}

	if (/^[\w.-]+\/[\w.-]+(?:@[\w./-]+)?$/.test(source)) {
		return parseGitHubSpec(source);
	}

	return { type: "npm", spec: source };
};

const parseGitHubSpec = (raw: string): InstallSource => {
	let spec = raw.trim();
	if (!spec) throw new Error("Missing GitHub repository");

	spec = spec.replace(/^https:\/\/github\.com\//, "");
	spec = spec.replace(/^git@github\.com:/, "");
	spec = spec.replace(/^ssh:\/\/git@github\.com\//, "");
	spec = spec.replace(/^github\.com\//, "");
	spec = spec.replace(/\.git$/, "");

	const atIndex = spec.lastIndexOf("@");
	const ref = atIndex > 0 ? spec.slice(atIndex + 1) : undefined;
	const repoSpec = atIndex > 0 ? spec.slice(0, atIndex) : spec;
	const [owner, repo] = repoSpec.split("/");
	if (!owner || !repo) throw new Error(`Invalid GitHub source: ${raw}`);

	return {
		type: "github",
		owner,
		repo,
		...(ref ? { ref } : {}),
		url: `https://github.com/${owner}/${repo}.git`,
	};
};

const readConfig = async (configPath: string): Promise<Record<string, unknown>> => {
	try {
		const raw = await readFile(configPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return {};
		throw error;
	}
};

const addExtensionToConfig = async (configPath: string, extensionPath: string): Promise<void> => {
	const config = await readConfig(configPath);
	const existing = Array.isArray(config.extensions)
		? config.extensions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		: [];
	if (!existing.includes(extensionPath)) {
		config.extensions = [...existing, extensionPath];
	}
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
};

const installNpm = async (source: Extract<InstallSource, { type: "npm" }>, configDir: string): Promise<string> => {
	const installRoot = join(configDir, "extensions", "npm");
	await mkdir(installRoot, { recursive: true });
	const nameRaw = await capture("npm", ["view", source.spec, "name", "--json"]);
	const packageName = JSON.parse(nameRaw) as string;
	if (typeof packageName !== "string" || !packageName) {
		throw new Error(`Could not resolve npm package name for ${source.spec}`);
	}
	await run("npm", ["install", "--prefix", installRoot, "--omit=dev", source.spec]);
	return join(installRoot, "node_modules", packageName);
};

const installGitHub = async (source: Extract<InstallSource, { type: "github" }>, configDir: string): Promise<string> => {
	const repoName = basename(source.repo, ".git");
	const target = join(configDir, "extensions", "git", "github.com", safeName(source.owner), safeName(repoName));
	await mkdir(join(target, ".."), { recursive: true });
	if (existsSync(join(target, ".git"))) {
		await run("git", ["fetch", "--all", "--tags"], target);
	} else {
		await run("git", ["clone", source.url, target]);
	}
	if (source.ref) {
		await run("git", ["checkout", source.ref], target);
	} else {
		await run("git", ["pull", "--ff-only"], target).catch(() => {});
	}
	if (existsSync(join(target, "package.json"))) {
		await run("npm", ["install", "--omit=dev"], target);
	}
	return target;
};

export const runInstall = async (args: InstallArgs): Promise<void> => {
	if (!args.source) {
		process.stderr.write("Usage: marvin install <npm:pkg|pkg|github:owner/repo|owner/repo|https://github.com/owner/repo>\n");
		process.exitCode = 2;
		return;
	}

	const configDir = args.configDir ?? defaultConfigDir();
	const configPath = args.configPath ?? join(configDir, "config.json");
	const source = parseInstallSource(args.source);
	const extensionPath = source.type === "npm"
		? await installNpm(source, configDir)
		: await installGitHub(source, configDir);

	await addExtensionToConfig(configPath, extensionPath);
	process.stdout.write(`Installed extension: ${extensionPath}\n`);
	process.stdout.write(`Updated config: ${configPath}\n`);
};
