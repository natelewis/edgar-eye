import { TradeStatus } from "@edgar-eye/database";
import type { OrderStatus } from "@edgar-eye/broker";

export function toTradeStatus(status: OrderStatus): TradeStatus {
  switch (status) {
    case "EXECUTED":
      return TradeStatus.EXECUTED;
    case "PENDING":
      return TradeStatus.PENDING;
    case "REJECTED":
      return TradeStatus.REJECTED;
    case "FAILED":
      return TradeStatus.FAILED;
  }
}
