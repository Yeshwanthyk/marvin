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
		try {
			const url = new URL(req.url || "", "http://localhost");

			console.log(`[OAuth] ${req.method} ${url.pathname}`);

			if (url.pathname !== "/auth/callback") {
				res.statusCode = 404;
				res.end("Not found");
				return;
			}

			const reqState = url.searchParams.get("state");
			console.log(`[OAuth] State check: expected=${state.substring(0, 8)}..., received=${reqState?.substring(0, 8)}...`);

			if (reqState !== state) {
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

			console.log(`[OAuth] ✓ Received authorization code`);
			receivedCode = code;
			res.setHeader("Content-Type", "text/html");
			res.end(SUCCESS_HTML);
		} catch (err) {
			console.error(`[OAuth] Error handling request:`, err);
			res.statusCode = 500;
			res.end("Internal server error");
		}
	});

	return new Promise((resolve) => {
		server.listen(1455, "0.0.0.0", () => {
			console.log(`[OAuth] Server listening on http://localhost:1455/auth/callback`);
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

		server.on("error", (err) => {
			console.error(`[OAuth] Server error:`, err);
			resolve({
				port: 1455,
				close: () => {},
				waitForCode: async () => null,
			});
		});
	});
}
