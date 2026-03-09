import { Client } from "pg";

const neon = new Client({
  connectionString: "postgresql://neondb_owner:npg_cUQs2pej0JPI@ep-shy-lab-a4oc9o85-pooler.us-east-1.aws.neon.tech/prisma_migrate_shadow_db_50336d30-ddae-4f20-8412-7c3e5ba9fced?sslmode=require&channel_binding=require",
  ssl: { rejectUnauthorized: false },
});

const railway = new Client({
  connectionString: "postgresql://postgres:CMyFDlmdgpnlkzEHcGJYKZMwlXifrrLv@maglev.proxy.rlwy.net:13432/railway",
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  await neon.connect();
  await railway.connect();

  // Get all tables
  const tables = await neon.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public';
  `);

  for (const row of tables.rows) {
    const table = row.tablename;

    console.log("Migrating:", table);

    const data = await neon.query(`SELECT * FROM ${table}`);

    if (data.rows.length === 0) continue;

    for (const record of data.rows) {
      const columns = Object.keys(record);
      const values = Object.values(record);

      const query = `
        INSERT INTO ${table} (${columns.join(",")})
        VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})
        ON CONFLICT DO NOTHING
      `;

      await railway.query(query, values);
    }
  }

  await neon.end();
  await railway.end();

  console.log("✅ Migration Complete");
}

migrate();