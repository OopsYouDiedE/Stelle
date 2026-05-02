export type TextIngressSource = string;
export type TextIngressKind =
  | "text"
  | "super_chat"
  | "gift"
  | "guard"
  | "entrance"
  | "follow"
  | "like"
  | "system"
  | "unknown";

export interface TextIngressEvent {
  id: string;
  platformEventId?: string;
  fingerprint?: string;
  source: TextIngressSource;
  kind: TextIngressKind;
  priority: "low" | "medium" | "high";
  receivedAt: number;
  roomId?: string;
  user?: {
    id?: string;
    name?: string;
  };
  text: string;
  trustedPayment?: {
    amount?: number;
    currency?: string;
    giftName?: string;
    rawType: "super_chat" | "gift" | "guard";
  };
  metadata?: Record<string, unknown>;
}
