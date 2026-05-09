import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToMessage(row) {
  if (!row) return null;
  return { id: row.id, officeId: row.officeId, agentId: row.agentId, role: row.role, content: row.content, createdAt: row.createdAt };
}

export async function getChatMessages(officeId, { limit = 100, before } = {}) {
  const db = await getAdapter();
  if (before) {
    return db.all(`SELECT * FROM chatMessages WHERE officeId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?`, [officeId, before, limit]).map(rowToMessage).reverse();
  }
  return db.all(`SELECT * FROM chatMessages WHERE officeId = ? ORDER BY createdAt DESC LIMIT ?`, [officeId, limit]).map(rowToMessage).reverse();
}

export async function createMessage({ officeId, agentId, role, content }) {
  const db = await getAdapter();
  const msg = { id: uuidv4(), officeId, agentId, role, content, createdAt: new Date().toISOString() };
  db.run(`INSERT INTO chatMessages(id, officeId, agentId, role, content, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, [msg.id, msg.officeId, msg.agentId, msg.role, msg.content, msg.createdAt]);
  return msg;
}
