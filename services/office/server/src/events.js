// Office event hub. `post` persists a timeline entry and pushes it to every
// open SSE stream for that office; `activity` is transient (drives the pixel
// office animation: who is typing, reading, delegating) and is not stored.
import { EventEmitter } from "node:events";

export function createEventHub(db) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  // Last activity per agent, so a freshly opened UI can paint current state.
  const activityByAgent = new Map();

  return {
    post(entry) {
      const row = db.addFeed(entry);
      emitter.emit(entry.officeId, { type: "feed", data: row });
      return row;
    },
    activity(officeId, agentId, state, detail = "") {
      const data = { agentId, state, detail, at: new Date().toISOString() };
      if (state === "idle") activityByAgent.delete(agentId);
      else activityByAgent.set(agentId, { officeId, ...data });
      emitter.emit(officeId, { type: "activity", data });
    },
    currentActivity(officeId) {
      return [...activityByAgent.values()].filter((a) => a.officeId === officeId);
    },
    /** Notify listeners that office structure (agents, schedules) changed. */
    changed(officeId, what) {
      emitter.emit(officeId, { type: "changed", data: { what } });
    },
    subscribe(officeId, listener) {
      emitter.on(officeId, listener);
      return () => emitter.off(officeId, listener);
    },
  };
}
