/**
 * LLM Chat App Frontend
 * Supports BOTH:
 *  - SSE streaming
 *  - Normal HTTP response with fake typing
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const modeToggle = document.getElementById("modeToggle"); // ✅ NEW

// Chat state
let chatHistory = [
  {
    role: "assistant",
    content:
      "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
  },
];
let isProcessing = false;

// Auto-resize textarea
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button
sendButton.addEventListener("click", sendMessage);

/**
 * Fake typing animation (HTTP mode)
 */
async function fakeTyping(element, text, delay = 18) {
  element.textContent = "";
  for (const ch of text) {
    element.textContent += ch;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    await new Promise((r) => setTimeout(r, delay));
  }
}

/**
 * Sends a message to the chat API
 */
async function sendMessage() {
  const message = userInput.value.trim();
  if (message === "" || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addMessageToChat("user", message);
  userInput.value = "";
  userInput.style.height = "auto";

  typingIndicator.classList.add("visible");
  chatHistory.push({ role: "user", content: message });

  try {
    // Create assistant message
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    assistantMessageEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantMessageEl);
    const assistantTextEl = assistantMessageEl.querySelector("p");
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });

    if (!response.ok) throw new Error("Failed to get response");

    const useSse = modeToggle?.checked === true;

    // =========================================================
    // ======================= SSE MODE =========================
    // =========================================================
    if (useSse) {
      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let responseText = "";
      let buffer = "";

      const flushAssistantText = () => {
        assistantTextEl.textContent = responseText;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          const parsed = consumeSseEvents(buffer + "\n\n");
          for (const data of parsed.events) {
            if (data === "[DONE]") break;
            try {
              const jsonData = JSON.parse(data);
              const content =
                jsonData.response ||
                jsonData.choices?.[0]?.delta?.content ||
                "";
              if (content) {
                responseText += content;
                flushAssistantText();
              }
            } catch (e) {
              console.error("SSE parse error:", e);
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = consumeSseEvents(buffer);
        buffer = parsed.buffer;

        for (const data of parsed.events) {
          if (data === "[DONE]") {
            buffer = "";
            break;
          }
          try {
            const jsonData = JSON.parse(data);
            const content =
              jsonData.response ||
              jsonData.choices?.[0]?.delta?.content ||
              "";
            if (content) {
              responseText += content;
              flushAssistantText();
            }
          } catch (e) {
            console.error("SSE parse error:", e);
          }
        }
      }

      chatHistory.push({ role: "assistant", content: responseText });

    // =========================================================
    // ====================== HTTP MODE =========================
    // =========================================================
    } else {
      const data = await response.json();

      const fullText =
        data.content ||
        data.response ||
        data.choices?.[0]?.message?.content ||
        "";

      await fakeTyping(assistantTextEl, fullText);
      chatHistory.push({ role: "assistant", content: fullText });
    }

  } catch (error) {
    console.error("Error:", error);
    addMessageToChat(
      "assistant",
      "Sorry, there was an error processing your request."
    );
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Add message to UI
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${content}</p>`;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * SSE parser (unchanged)
 */
function consumeSseEvents(buffer) {
  let normalized = buffer.replace(/\r/g, "");
  const events = [];
  let eventEndIndex;

  while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
    const rawEvent = normalized.slice(0, eventEndIndex);
    normalized = normalized.slice(eventEndIndex + 2);

    const lines = rawEvent.split("\n");
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length > 0) {
      events.push(dataLines.join("\n"));
    }
  }
  return { events, buffer: normalized };
}
