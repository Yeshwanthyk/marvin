import http from "node:http";
import type { OAuthServerInfo } from "./types.js";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Auth Success</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;background:#0a0a0a;color:#fff">
<div style="text-align:center"><h1>✓ Authenticated</h1><p>Return to terminal</p></div>
</body></html>`;

/**
 * Start local OAuth callback server on port 1455
 */
export function startLocalOAuthServer(state: string): Promise<OAuthServerInfo> {
	let receivedCode: string | null = null;

	const server = http.createServer((req, res) => {
		const url = new URL(req.url || "", "http://localhost");
		
		if (url.pathname !== "/auth/callback") {
			res.statusCode = 404;
			res.end("Not found");
			return;
		}
		
		if (url.searchParams.get("state") !== state) {
			res.statusCode = 400;
			res.end("State mismatch");
			return;
		}
		
		const code = url.searchParams.get("code");
		if (!code) {
			res.statusCode = 400;
			res.end("Missing code");
			return;
		}
		
		receivedCode = code;
		res.setHeader("Content-Type", "text/html");
		res.end(SUCCESS_HTML);
	});

	return new Promise((resolve) => {
		server.listen(1455, "127.0.0.1", () => {
			resolve({
				port: 1455,
				close: () => server.close(),
				waitForCode: async () => {
					// Poll for 60 seconds
					for (let i = 0; i < 600; i++) {
						if (receivedCode) return { code: receivedCode };
						await new Promise((r) => setTimeout(r, 100));
					}
					return null;
				},
			});
		});

		server.on("error", () => {
			resolve({
				port: 1455,
				close: () => {},
				waitForCode: async () => null,
			});
		});
	});
}
