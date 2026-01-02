/** @type {import("eslint").Linter.Config} */
module.exports = {
	root: true,
	env: { node: true, es2022: true },
	plugins: ["boundaries"],
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: "module",
	},
	settings: {
		"boundaries/elements": [
			{ type: "adapters", pattern: "apps/coding-agent/src/adapters/*" },
			{ type: "runtime", pattern: "apps/coding-agent/src/runtime/*" },
			{ type: "domain", pattern: "apps/coding-agent/src/domain/*" },
			{ type: "ext", pattern: "apps/coding-agent/src/extensibility/*" },
			{ type: "ui", pattern: "apps/coding-agent/src/ui/*" },
		],
	},
	rules: {
		"boundaries/element-types": [
			"warn",
			{
				default: "allow",
				message: "Layer violation: {{from}} cannot import from {{target}}",
				rules: [
					{ from: "domain", disallow: ["ui", "adapters"] },
					{ from: "runtime", disallow: ["ui", "adapters"] },
					{ from: "ext", disallow: ["ui", "adapters"] },
					{ from: "ui", disallow: ["adapters"] },
				],
			},
		],
	},
	ignorePatterns: ["dist", "node_modules"],
}
