import { getGatewayRealtimeProtocols } from "@ai-sdk/gateway";
import type {
  Experimental_RealtimeClientEvent,
  Experimental_RealtimeModel,
  Experimental_RealtimeServerEvent,
  Experimental_RealtimeSessionConfig,
} from "ai";

export function vercelRealtimeModel(modelId = "openai/gpt-realtime-2"): Experimental_RealtimeModel {
  return {
    specificationVersion: "v4",
    provider: "gateway.realtime",
    modelId,
    async doCreateClientSecret() {
      throw new Error("Use the /api/realtime/token endpoint for Vercel realtime setup.");
    },
    getWebSocketConfig({ token, url }) {
      return {
        url,
        protocols: getGatewayRealtimeProtocols(token),
      };
    },
    parseServerEvent(raw: unknown) {
      return raw as Experimental_RealtimeServerEvent;
    },
    serializeClientEvent(event: Experimental_RealtimeClientEvent) {
      return event;
    },
    buildSessionConfig(config: Experimental_RealtimeSessionConfig) {
      return config;
    },
  };
}
