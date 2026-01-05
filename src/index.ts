/**
 * LLM Chat Application Template
 * Cloudflare Workers + Workers AI (Streaming SSE)
 */

import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Serve frontend assets
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Chat API
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      return handleChatRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const body = await request.json();
    const messages: ChatMessage[] = body.messages || [];
    const useStream: boolean = body.stream === true;

    // Add system prompt if missing
    if (!messages.some((m) => m.role === "system")) {
      messages.unshift({
        role: "system",
        content: SYSTEM_PROMPT,
      });
    }

    // STREAM MODE (SSE)
    if (useStream) {
      const stream = await env.AI.run(MODEL_ID, {
        messages,
        max_tokens: 1024,
        stream: true,
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    //  HTTP MODE (JSON)
    const result = await env.AI.run(MODEL_ID, {
      messages,
      max_tokens: 1024,
      stream: false,
    });

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
      },
    });

  } catch (err) {
    console.error("Chat API error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
