import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send } from "lucide-react";
import { sendChatMessage } from "./api";

export function Chatbot({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant", content: string }[]>([
    { role: "assistant", content: "Hi! I'm your Azure Log Analytics expert. How can I help you write or debug a KQL query today?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || isLoading) return;
    
    const newMessages = [...messages, { role: "user" as const, content: input }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await sendChatMessage(newMessages);
      setMessages([...newMessages, { role: "assistant", content: response }]);
    } catch (error) {
      setMessages([...newMessages, { role: "assistant", content: "Sorry, I encountered an error. Is Azure OpenAI properly configured?" }]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="chatbot-overlay">
      <div className="chatbot-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <MessageSquare size={18} color="#ec4899" />
          <span>KQL Assistant</span>
        </div>
        <button className="close-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="chatbot-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {isLoading && (
          <div className="chat-bubble assistant" style={{ fontStyle: "italic", opacity: 0.7 }}>
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chatbot-input">
        <input 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Ask a KQL question..."
          disabled={isLoading}
        />
        <button onClick={handleSend} disabled={isLoading || !input.trim()}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
