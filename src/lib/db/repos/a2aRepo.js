import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToA2a(row) {
  if (!row) return null;
  return { id: row.id, fromAgentId: row.fromAgentId, toAgentId: row.toAgentId, officeId: row.officeId, type: row.type, content: row.content, createdAt: row.createdAt };
}

export async function getA2aMessages(officeId, { limit = 50, before } = {}) {
  const db = await getAdapter();
  if (before) {
    return db.all(`SELECT * FROM a2aMessages WHERE officeId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?`, [officeId, before, limit]).map(rowToA2a).reverse();
  }
  return db.all(`SELECT * FROM a2aMessages WHERE officeId = ? ORDER BY createdAt DESC LIMIT ?`, [officeId, limit]).map(rowToA2a).reverse();
}

export async function createA2aMessage({ fromAgentId, toAgentId, officeId, type, content }) {
  const db = await getAdapter();
  const msg = { id: uuidv4(), fromAgentId, toAgentId: toAgentId || null, officeId, type: type || "message", content, createdAt: new Date().toISOString() };
  db.run(`INSERT INTO a2aMessages(id, fromAgentId, toAgentId, officeId, type, content, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`, [msg.id, msg.fromAgentId, msg.toAgentId, msg.officeId, msg.type, msg.content, msg.createdAt]);
  return msg;
}
