// Meta Model API client (OpenAI-compatible chat completions, https://dev.meta.ai/docs).
// The key comes from META_API_KEY or ~/.fastb/secrets.env, never from the repo.
// Send no private data: on free credits, content may be used to improve Meta's models.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HOME } from "../paths.ts";

const BASE_URL = process.env.META_API_BASE ?? "https://api.meta.ai/v1";
export const MODEL = process.env.FASTB_MODEL ?? "muse-spark-1.3";

function apiKey(): string {
  if (process.env.META_API_KEY) return process.env.META_API_KEY;
  // The fastb home first, then the default one (a test home has no secrets).
  const files = [...new Set([join(HOME, "secrets.env"), join(homedir(), ".fastb", "secrets.env")])];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const m = /^META_API_KEY=(.+)$/m.exec(readFileSync(file, "utf8"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`no META_API_KEY (set it in the environment or in ${files[0]})`);
}

export interface JsonCall {
  system: string;
  user: string;
  name: string; // schema name
  schema: Record<string, unknown>; // JSON schema of the answer
  effort?: "minimal" | "low" | "medium" | "high"; // thinking before the answer; less is faster ("none" is refused)
  timeoutMs?: number;
}

// One chat call whose answer must match `schema`. Returns the parsed object.
export async function chatJson<T>(call: JsonCall): Promise<{ value: T; ms: number; tokens?: { in: number; out: number } }> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: call.system },
        { role: "user", content: call.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: call.name, schema: call.schema } },
      reasoning_effort: call.effort ?? "minimal",
    }),
    signal: AbortSignal.timeout(call.timeoutMs ?? 30000),
  });
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const value = JSON.parse(body.choices[0].message.content) as T;
  const tokens = body.usage ? { in: body.usage.prompt_tokens, out: body.usage.completion_tokens } : undefined;
  return { value, ms: Date.now() - started, tokens };
}
