import http from "node:http";

export interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export const startMockSseServer = async (
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<MockServer> => {
  const server = http.createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock server");
  }

  const baseUrl = `http://${address.address}:${address.port}`;
  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
};

export const writeSse = (res: http.ServerResponse, data: unknown) => {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
};

