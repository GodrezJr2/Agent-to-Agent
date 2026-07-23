export default {
  id: "deepseek-web",
  priority: 111,
  alias: "dsw",
  aliases: [
    "deepseek-web",
  ],
  uiAlias: "dsw",
  display: {
    name: "DeepSeek Web",
    icon: "auto_awesome",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://chat.deepseek.com",
    notice: {
      text: "Paste the Bearer token value from chat.deepseek.com network requests",
    },
  },
  // Bearer token scraped from the chat.deepseek.com session, not a real API key,
  // but it is entered and stored exactly like one — so it belongs in the apikey
  // category (the dashboard renders it on the providers page, not under cookies).
  category: "apikey",
  authType: "apikey",
  authHint: "Paste the Bearer token value from chat.deepseek.com network requests",
  serviceKinds: ["llm"],
  // Traffic is driven entirely by executors/deepseek-web.js (POW challenge +
  // chat_session chaining against the web endpoints), so there is no plain
  // OpenAI-compatible transport to declare here.
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
  },
  // Model id = feature flags for the web UI: {instant|expert}[-deepthink][-search]
  // plus the -agentic variant. Resolved by MODEL_FLAGS in the executor.
  models: [
    { id: "instant", name: "DeepSeek Instant" },
    { id: "instant-search", name: "DeepSeek Instant (Search)" },
    { id: "instant-deepthink", name: "DeepSeek Instant (DeepThink)" },
    { id: "instant-deepthink-search", name: "DeepSeek Instant (DeepThink + Search)" },
    { id: "expert", name: "DeepSeek Expert" },
    { id: "expert-search", name: "DeepSeek Expert (Search)" },
    { id: "expert-deepthink", name: "DeepSeek Expert (DeepThink)" },
    { id: "expert-deepthink-search", name: "DeepSeek Expert (DeepThink + Search)" },
  ],
};
