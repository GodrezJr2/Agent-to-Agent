import { create } from "zustand";
import type { AgentData } from "../types";

// Minimal interfaces matching what the game engine expects
interface CharacterData {
  id: string;
  name: string;
  seatX: number;
  seatY: number;
  sprite: string;
  active: boolean;
  toolName?: string;
  showPermissionBubble: boolean;
}

export interface OfficeStoreState {
  layout: any;
  characters: Map<string, CharacterData>;
  activeToolIds: Map<string, string>;

  setLayout: (layout: any) => void;
  addAgent: (agent: AgentData) => void;
  removeAgent: (agentId: string) => void;
  setAgentActive: (agentId: string, toolName: string) => void;
  setAgentIdle: (agentId: string) => void;
  setAgentPermission: (agentId: string) => void;
  clearAgentPermission: (agentId: string) => void;
  update: (dt: number) => void;
}

export const useOfficeStore = create<OfficeStoreState>((set, get) => ({
  layout: null,
  characters: new Map(),
  activeToolIds: new Map(),

  setLayout: (layout) => set({ layout }),

  addAgent: (agent) => {
    const state = get();
    if (state.characters.has(agent.id)) return;
    const char: CharacterData = {
      id: agent.id,
      name: agent.name,
      seatX: agent.seatX ?? 0,
      seatY: agent.seatY ?? 0,
      sprite: agent.characterSprite ?? "default",
      active: false,
      showPermissionBubble: false,
    };
    const newChars = new Map(state.characters);
    newChars.set(agent.id, char);
    set({ characters: newChars });
  },

  removeAgent: (agentId) => {
    const state = get();
    const newChars = new Map(state.characters);
    newChars.delete(agentId);
    const newActive = new Map(state.activeToolIds);
    newActive.delete(agentId);
    set({ characters: newChars, activeToolIds: newActive });
  },

  setAgentActive: (agentId, toolName) => {
    const state = get();
    const char = state.characters.get(agentId);
    if (!char) return;
    const updated = { ...char, active: true, toolName };
    const newChars = new Map(state.characters);
    newChars.set(agentId, updated);
    const newActive = new Map(state.activeToolIds);
    newActive.set(agentId, toolName);
    set({ characters: newChars, activeToolIds: newActive });
  },

  setAgentIdle: (agentId) => {
    const state = get();
    const char = state.characters.get(agentId);
    if (!char) return;
    const updated = { ...char, active: false, toolName: undefined };
    const newChars = new Map(state.characters);
    newChars.set(agentId, updated);
    const newActive = new Map(state.activeToolIds);
    newActive.delete(agentId);
    set({ characters: newChars, activeToolIds: newActive });
  },

  setAgentPermission: (agentId) => {
    const state = get();
    const char = state.characters.get(agentId);
    if (!char) return;
    const updated = { ...char, showPermissionBubble: true };
    const newChars = new Map(state.characters);
    newChars.set(agentId, updated);
    set({ characters: newChars });
  },

  clearAgentPermission: (agentId) => {
    const state = get();
    const char = state.characters.get(agentId);
    if (!char) return;
    const updated = { ...char, showPermissionBubble: false };
    const newChars = new Map(state.characters);
    newChars.set(agentId, updated);
    set({ characters: newChars });
  },

  update: (_dt) => {
    // Character animation update — called every frame by game loop
    // Will be expanded with proper character FSM in later integration
  },
}));
