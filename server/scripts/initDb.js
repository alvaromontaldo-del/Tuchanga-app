/**
 * Crea tablas y usuarios mock de trabajadores (IDs alineados con la app).
 * Uso: DATABASE_URL=... node scripts/initDb.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

const WORKERS = [
  { id: '10000000-0000-4000-8000-000000000001', email: 'maria.mock@tuchanga.local', name: 'María' },
  { id: '10000000-0000-4000-8000-000000000002', email: 'lucas.mock@tuchanga.local', name: 'Lucas' },
  { id: '10000000-0000-4000-8000-000000000003', email: 'ana.mock@tuchanga.local', name: 'Ana' },
  { id: '10000000-0000-4000-8000-000000000004', email: 'roberto.mock@tuchanga.local', name: 'Roberto' },
  { id: '10000000-0000-4000-8000-000000000005', email: 'carolina.mock@tuchanga.local', name: 'Carolina' },
  { id: '10000000-0000-4000-8000-000000000006', email: 'diego.mock@tuchanga.local', name: 'Diego' },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL en .env');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  for (const w of WORKERS) {
    await pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email`,
      [w.id, w.email, w.name],
    );
  }
  console.log('DB lista: tablas + trabajadores mock.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
