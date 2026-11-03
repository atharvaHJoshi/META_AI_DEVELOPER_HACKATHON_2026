import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      DROP TABLE IF EXISTS schema_migrations, ai_calls, audit_events, decision_audit,
        scenario_runs, decision_proposals, ticket_links, tickets, task_dependencies,
        tasks, milestones, requirements, plan_versions, project_members, projects, users
      CASCADE;
    `);
    console.log("database reset");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
