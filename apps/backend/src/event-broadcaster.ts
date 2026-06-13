import type { WsEvent } from "@edgar-eye/shared";

export interface EventBroadcaster {
  broadcast(event: WsEvent): void;
}
