import chalk from "chalk";
import { highlight } from "cli-highlight";

type CliHighlightTheme = Record<string, (s: string) => string>;

const cliHighlightTheme: CliHighlightTheme = {
	keyword: (s: string) => chalk.hex("#569CD6")(s),
	built_in: (s: string) => chalk.hex("#4EC9B0")(s),
	literal: (s: string) => chalk.hex("#B5CEA8")(s),
	number: (s: string) => chalk.hex("#B5CEA8")(s),
	string: (s: string) => chalk.hex("#CE9178")(s),
	comment: (s: string) => chalk.hex("#6A9955")(s),
	function: (s: string) => chalk.hex("#DCDCAA")(s),
	title: (s: string) => chalk.hex("#DCDCAA")(s),
	class: (s: string) => chalk.hex("#4EC9B0")(s),
	type: (s: string) => chalk.hex("#4EC9B0")(s),
	attr: (s: string) => chalk.hex("#9CDCFE")(s),
	variable: (s: string) => chalk.hex("#9CDCFE")(s),
	params: (s: string) => chalk.hex("#9CDCFE")(s),
	operator: (s: string) => chalk.hex("#D4D4D4")(s),
	punctuation: (s: string) => chalk.hex("#D4D4D4")(s),
};

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function highlightCode(code: string, lang?: string): string[] {
	const opts = {
		language: lang,
		ignoreIllegals: true,
		theme: cliHighlightTheme,
	};

	return highlight(code, opts).split("\n");
}

export function getLanguageFromPath(filePath: string): string | undefined {
	const trimmed = (filePath || "").trim();
	if (!trimmed) return undefined;

	const base = trimmed.split(/[\\/]/).pop()?.toLowerCase();
	if (!base) return undefined;

	if (base === "dockerfile") return "dockerfile";
	if (base === "makefile") return "makefile";

	const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() : undefined;
	if (!ext) return undefined;

	const extToLang: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		py: "python",
		rb: "ruby",
		rs: "rust",
		go: "go",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		h: "c",
		cpp: "cpp",
		cc: "cpp",
		cxx: "cpp",
		hpp: "cpp",
		cs: "csharp",
		php: "php",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		fish: "fish",
		ps1: "powershell",
		sql: "sql",
		html: "html",
		htm: "html",
		css: "css",
		scss: "scss",
		sass: "sass",
		less: "less",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		xml: "xml",
		md: "markdown",
		markdown: "markdown",
		dockerfile: "dockerfile",
		makefile: "makefile",
		cmake: "cmake",
		lua: "lua",
		pl: "perl",
		perl: "perl",
		r: "r",
		scala: "scala",
		clj: "clojure",
		ex: "elixir",
		exs: "elixir",
		erl: "erlang",
		hs: "haskell",
		ml: "ocaml",
		vim: "vim",
		graphql: "graphql",
		proto: "protobuf",
		tf: "hcl",
		hcl: "hcl",
	};

	return extToLang[ext];
}
