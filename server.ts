import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { Server as SocketServer } from "socket.io";
import { initSocketHandlers } from "./src/lib/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketServer(server, {
    path: "/socket.io",
    cors: {
      origin: process.env.NEXT_PUBLIC_SOCKET_URL || "*",
      methods: ["GET", "POST"],
    },
  });

  initSocketHandlers(io);

  // Containers (Railway) must bind to all interfaces to be reachable.
  const host = process.env.HOST ?? (dev ? "127.0.0.1" : "0.0.0.0");
  server.listen(port, host, () => {
    console.log(`> Ready on http://${host}:${port}`);
    console.log(`> WebSocket server running on /socket.io`);
  });
});
