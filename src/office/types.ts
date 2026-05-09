export interface AgentData {
  id: string;
  name: string;
  role?: string;
  seatX?: number;
  seatY?: number;
  characterSprite?: string;
}

export interface OfficeData {
  id: string;
  name: string;
  description?: string;
  agents: AgentData[];
}

export interface ChatMessage {
  id: string;
  officeId: string;
  agentId?: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
}

export interface CronJob {
  id: string;
  agentId: string;
  officeId: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface MemoryEntry {
  id: string;
  agentId?: string;
  officeId: string;
  type: string;
  content: string;
  embedding?: number[];
}
