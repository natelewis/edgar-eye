import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { loadEnv } from "@edgar-eye/shared";
import { isAuthorizedWebSocketUpgrade } from "./auth.js";
import { createApp } from "./app.js";
import { TradingPipeline } from "./trading-pipeline.js";
import { WsHub } from "./ws-hub.js";

const env = loadEnv();
const wsHub = new WsHub();
const pipeline = new TradingPipeline(wsHub);
const app = createApp(pipeline, env);
const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  if (!request.url?.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  if (!isAuthorizedWebSocketUpgrade(env, request)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (socket) => {
  wsHub.add(socket);
  void pipeline.publishStatus();

  socket.on("close", () => {
    wsHub.remove(socket);
  });
});

const statusInterval = setInterval(() => {
  void pipeline.publishStatus();
}, 15_000);

server.listen(env.PORT, () => {
  console.log(`[Backend] Listening on http://localhost:${env.PORT}`);
  console.log(`[Backend] Trading mode: ${env.TRADING_MODE}`);
  if (env.API_SECRET_KEY) {
    console.log("[Backend] API authentication enabled");
  }
  void pipeline.start();
});

process.on("SIGINT", () => {
  pipeline.stop();
  clearInterval(statusInterval);
  server.close();
  process.exit(0);
});
