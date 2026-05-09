import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToEntry(row) {
  if (!row) return null;
  return { id: row.id, agentId: row.agentId, officeId: row.officeId, type: row.type, content: row.content, embedding: row.embedding ? JSON.parse(row.embedding) : null, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function getMemoryEntries({ officeId, agentId } = {}) {
  const db = await getAdapter();
  if (agentId) return db.all(`SELECT * FROM memoryEntries WHERE agentId = ? ORDER BY createdAt DESC`, [agentId]).map(rowToEntry);
  if (officeId) return db.all(`SELECT * FROM memoryEntries WHERE officeId = ? AND agentId IS NULL ORDER BY createdAt DESC`, [officeId]).map(rowToEntry);
  return [];
}

export async function createMemoryEntry({ officeId, agentId, type, content, embedding }) {
  const db = await getAdapter();
  const entry = { id: uuidv4(), agentId: agentId || null, officeId, type: type || "note", content, embedding: embedding ? JSON.stringify(embedding) : null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.run(`INSERT INTO memoryEntries(id, agentId, officeId, type, content, embedding, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, [entry.id, entry.agentId, entry.officeId, entry.type, entry.content, entry.embedding, entry.createdAt, entry.updatedAt]);
  return entry;
}

export async function deleteMemoryEntry(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM memoryEntries WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function getAllMemoryForAgent(agentId, officeId) {
  const db = await getAdapter();
  const agentMem = db.all(`SELECT * FROM memoryEntries WHERE agentId = ?`, [agentId]).map(rowToEntry);
  const sharedMem = db.all(`SELECT * FROM memoryEntries WHERE officeId = ? AND agentId IS NULL`, [officeId]).map(rowToEntry);
  return [...agentMem, ...sharedMem];
}
