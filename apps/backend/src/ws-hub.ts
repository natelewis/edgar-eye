import type WebSocket from "ws";
import type { WsEvent } from "@edgar-eye/shared";
import type { EventBroadcaster } from "./event-broadcaster.js";

export class WsHub implements EventBroadcaster {
  private clients = new Set<WebSocket>();

  add(client: WebSocket): void {
    this.clients.add(client);
  }

  remove(client: WebSocket): void {
    this.clients.delete(client);
  }

  broadcast(event: WsEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState !== client.OPEN) {
        this.clients.delete(client);
        continue;
      }

      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
