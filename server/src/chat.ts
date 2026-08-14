import { AzureOpenAI } from "openai";
import { config } from "./config.js";

const SYSTEM_PROMPT = `You are an AI assistant built into an Azure Log Analytics KQL application.
Your ONLY purpose is to help users write, debug, and understand Kusto Query Language (KQL) queries and Azure Log Analytics logs (such as AzureDiagnostics, StorageFileLogs, AppGatewayAccessLogs, AzureFirewall logs).
If the user asks a question that is unrelated to KQL, Azure, Log Analytics, or the application itself, politely refuse to answer. Do not write code in other languages unless it's directly related to executing KQL. Keep answers concise.`;

export async function generateChatResponse(messages: { role: "system" | "user" | "assistant", content: string }[]) {
  if (!config.AZURE_OPENAI_API_KEY || !config.AZURE_OPENAI_ENDPOINT || !config.AZURE_OPENAI_DEPLOYMENT) {
    throw new Error("Azure OpenAI is not fully configured in the environment.");
  }

  const client = new AzureOpenAI({
    endpoint: config.AZURE_OPENAI_ENDPOINT,
    apiKey: config.AZURE_OPENAI_API_KEY,
    apiVersion: "2024-02-15-preview", // Commonly used API version, adjust if needed
    deployment: config.AZURE_OPENAI_DEPLOYMENT
  });

  const chatMessages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
  ];

  const response = await client.chat.completions.create({
    model: config.AZURE_OPENAI_DEPLOYMENT,
    messages: chatMessages,
    temperature: 0.1, // Low temperature for more deterministic/technical answers
  });

  return response.choices[0]?.message?.content || "No response generated.";
}
