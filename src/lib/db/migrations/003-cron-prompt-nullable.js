// Make cronJobs.prompt nullable (pipeline jobs have no single prompt)
export default {
  version: 3,
  name: "cron-prompt-nullable",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cronJobs_new (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        officeId TEXT NOT NULL,
        schedule TEXT NOT NULL,
        prompt TEXT,
        enabled INTEGER DEFAULT 1,
        lastRun TEXT,
        nextRun TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        pipeline TEXT
      );
      INSERT INTO cronJobs_new SELECT * FROM cronJobs;
      DROP TABLE cronJobs;
      ALTER TABLE cronJobs_new RENAME TO cronJobs;
    `);
  },
};
