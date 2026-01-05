/**
 * LLM Chat App Frontend
 * Supports SSE (streaming) + HTTP (fake typing)
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
  {
    role: "assistant",
    content: "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
  },
];

let isProcessing = false;

/* -------------------- helpers -------------------- */

function getSelectedMode() {
  const selected = document.querySelector('input[name="mode"]:checked');
  return selected ? selected.value : "sse";
}

function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p></p>`;
  messageEl.querySelector("p").textContent = content;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return messageEl;
}

function consumeSseEvents(buffer) {
  let normalized = buffer.replace(/\r/g, "");
  const events = [];
  let idx;

  while ((idx = normalized.indexOf("\n\n")) !== -1) {
    const rawEvent = normalized.slice(0, idx);
    normalized = normalized.slice(idx + 2);

    const lines = rawEvent.split("\n");
    const dataLines = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());

    if (dataLines.length) {
      events.push(dataLines.join("\n"));
    }
  }

  return { events, buffer: normalized };
}

/* -------------------- UI handlers -------------------- */

userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

/* -------------------- main logic -------------------- */

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addMessageToChat("user", message);
  chatHistory.push({ role: "user", content: message });

  userInput.value = "";
  userInput.style.height = "auto";

  typingIndicator.classList.add("visible");

  const assistantEl = addMessageToChat("assistant", "");
  const assistantTextEl = assistantEl.querySelector("p");

  try {
    const mode = getSelectedMode();

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatHistory,
        stream: mode === "sse",
      }),
    });

    if (!response.ok) throw new Error("API error");

    /* ---------- SSE MODE (existing behavior) ---------- */
    if (mode === "sse") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let responseText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parsed = consumeSseEvents(buffer);
        buffer = parsed.buffer;

        for (const data of parsed.events) {
          if (data === "[DONE]") break;

          try {
            const json = JSON.parse(data);
            let content =
              json.response ||
              json.choices?.[0]?.delta?.content ||
              "";

            if (content) {
              responseText += content;
              assistantTextEl.textContent = responseText;
              chatMessages.scrollTop = chatMessages.scrollHeight;
            }
          } catch {}
        }
      }

      if (responseText) {
        chatHistory.push({ role: "assistant", content: responseText });
      }

    /* ---------- HTTP MODE (fake typing) ---------- */
    } else {
      const json = await response.json();
      const fullText =
        json.response ||
        json.choices?.[0]?.message?.content ||
        "";

      let index = 0;
      const speed = 20;

      const typer = setInterval(() => {
        assistantTextEl.textContent += fullText[index++];
        chatMessages.scrollTop = chatMessages.scrollHeight;

        if (index >= fullText.length) {
          clearInterval(typer);
          chatHistory.push({ role: "assistant", content: fullText });
        }
      }, speed);
    }

  } catch (err) {
    console.error(err);
    assistantTextEl.textContent = "Error processing request.";
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}
