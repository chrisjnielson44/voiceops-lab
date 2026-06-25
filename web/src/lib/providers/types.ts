/**
 * Model-provider abstraction. Every adapter (hosted, local, or the deterministic
 * demo engine) implements `LLMProvider`, so the router and benchmark code never
 * needs to know which backend is actually serving a request.
 *
 * The wire contract mirrors the OpenAI Chat Completions shape, which is what
 * OpenRouter and MLX LM both expose — that is why a single adapter shape works
 * for hosted and local models alike.
 */

export type ProviderId = "openrouter" | "mlx" | "demo";
export type ProviderKind = "hosted" | "local" | "demo";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ChatCompletionRequest {
  /** Registry model id, e.g. "anthropic/claude-sonnet-4.6". */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "error";

export interface ChatCompletionResult {
  text: string;
  model: string;
  providerId: ProviderId;
  latencyMs: number;
  usage: TokenUsage;
  costUsd: number;
  finishReason: FinishReason;
  /** True when produced by the deterministic demo adapter (no network). */
  demo: boolean;
  error?: string;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  configured: boolean;
  baseUrl?: string;
  /** Which env vars are missing for this provider to go live. */
  missingEnv: string[];
  detail: string;
}

export interface LLMProvider {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** True when env is sufficient to make real network calls. */
  isConfigured(): boolean;
  status(): ProviderStatus;
  /** OpenAI-compatible chat completion. */
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}
