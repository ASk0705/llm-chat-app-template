import { Ai } from "@cloudflare/ai";

export interface Env {
  AI: Ai;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const MODEL_ID = "@cf/meta/llama-3-8b-instruct";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const messages = body.messages as ChatMessage[];
    const stream = body.stream === true;

    if (!messages || !Array.isArray(messages)) {
      return new Response("Invalid request body", { status: 400 });
    }

    const ai = new Ai(env.AI);

    /* =========================
       RUN MODEL
       ========================= */
    const aiResponse = await ai.run(MODEL_ID, {
      messages,
      stream,
    });

    /* =========================
       SSE MODE
       ========================= */
    if (stream) {
      return new Response(aiResponse as any, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no", // prevents proxy buffering
        },
      });
    }

    /* =========================
       HTTP MODE (COLLECT FULL RESPONSE)
       ========================= */
    let fullText = "";

    try {
      for await (const chunk of aiResponse as any) {
        if (!chunk) continue;

        // Workers AI streaming format
        if (typeof chunk === "object" && chunk.response) {
          fullText += chunk.response;
        }

        // OpenAI-compatible fallback
        if (chunk.choices?.[0]?.delta?.content) {
          fullText += chunk.choices[0].delta.content;
        }
      }
    } catch (err) {
      console.error("Error reading AI response:", err);
      return new Response("AI response error", { status: 500 });
    }

    return new Response(
      JSON.stringify({ response: fullText }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  },
};
