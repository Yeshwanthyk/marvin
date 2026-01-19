/**
 * Bun preload script to redirect solid-js server builds to browser builds.
 * solid-js uses conditional exports where `node` condition loads SSR builds.
 * This plugin intercepts those and loads the browser builds instead.
 */
import { plugin, type BunPlugin } from "bun";

const solidBrowserPlugin: BunPlugin = {
	name: "solid-browser-redirect",
	setup(build) {
		// solid-js/dist/server.js → solid.js
		build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, async (args) => {
			const path = args.path.replace("server.js", "solid.js");
			const code = await Bun.file(path).text();
			return { contents: code, loader: "js" };
		});

		// solid-js/store/dist/server.js → store.js
		build.onLoad({ filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ }, async (args) => {
			const path = args.path.replace("server.js", "store.js");
			const code = await Bun.file(path).text();
			return { contents: code, loader: "js" };
		});

		// solid-js/web/dist/server.js → web.js
		build.onLoad({ filter: /\/node_modules\/solid-js\/web\/dist\/server\.js$/ }, async (args) => {
			const path = args.path.replace("server.js", "web.js");
			const code = await Bun.file(path).text();
			return { contents: code, loader: "js" };
		});
	},
};

plugin(solidBrowserPlugin);
