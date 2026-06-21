// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 1;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      contextWindow: "INTEGER",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  offices: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT",
      workspacePath: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
  },
  officeAgents: {
    columns: {
      id: "TEXT PRIMARY KEY",
      officeId: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      role: "TEXT",
      comboId: "TEXT",
      modelId: "TEXT",
      systemPrompt: "TEXT",
      characterSprite: "TEXT DEFAULT 'default'",
      seatX: "INTEGER DEFAULT 0",
      seatY: "INTEGER DEFAULT 0",
      managerId: "TEXT",
      thinkingBudget: "INTEGER DEFAULT 0",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_oa_office ON officeAgents(officeId)",
      "CREATE INDEX IF NOT EXISTS idx_oa_active ON officeAgents(officeId, isActive)",
    ],
  },
  chatMessages: {
    columns: {
      id: "TEXT PRIMARY KEY",
      officeId: "TEXT NOT NULL",
      agentId: "TEXT",
      role: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cm_office ON chatMessages(officeId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_cm_agent ON chatMessages(agentId, createdAt DESC)",
    ],
  },
  cronJobs: {
    columns: {
      id: "TEXT PRIMARY KEY",
      agentId: "TEXT NOT NULL",
      officeId: "TEXT NOT NULL",
      schedule: "TEXT NOT NULL",
      prompt: "TEXT NOT NULL",
      enabled: "INTEGER DEFAULT 1",
      lastRun: "TEXT",
      nextRun: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cj_agent ON cronJobs(agentId)",
      "CREATE INDEX IF NOT EXISTS idx_cj_office ON cronJobs(officeId)",
      "CREATE INDEX IF NOT EXISTS idx_cj_next ON cronJobs(nextRun)",
    ],
  },
  memoryEntries: {
    columns: {
      id: "TEXT PRIMARY KEY",
      agentId: "TEXT",
      officeId: "TEXT NOT NULL",
      key: "TEXT",
      type: "TEXT NOT NULL DEFAULT 'note'",
      content: "TEXT NOT NULL",
      embedding: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_me_agent ON memoryEntries(agentId)",
      "CREATE INDEX IF NOT EXISTS idx_me_office ON memoryEntries(officeId)",
    ],
  },
  a2aTasks: {
    columns: {
      id: "TEXT PRIMARY KEY",
      agentId: "TEXT NOT NULL",
      fromAgentId: "TEXT",
      officeId: "TEXT NOT NULL",
      status: "TEXT NOT NULL DEFAULT 'submitted'",
      input: "TEXT NOT NULL",
      output: "TEXT",
      error: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_at_agent ON a2aTasks(agentId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_at_office ON a2aTasks(officeId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_at_status ON a2aTasks(status)",
    ],
  },
  a2aMessages: {
    columns: {
      id: "TEXT PRIMARY KEY",
      fromAgentId: "TEXT NOT NULL",
      toAgentId: "TEXT",
      officeId: "TEXT NOT NULL",
      type: "TEXT NOT NULL DEFAULT 'message'",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_a2a_from ON a2aMessages(fromAgentId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_a2a_to ON a2aMessages(toAgentId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_a2a_office ON a2aMessages(officeId, createdAt DESC)",
    ],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
