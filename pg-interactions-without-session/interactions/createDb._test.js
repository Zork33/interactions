import path from 'path'
import fs from 'fs'
import {Client as PGClient} from 'pg'
import configAPI from 'config'

export async function createDb() {
  const dbConfig = configAPI.get('postgres');
  const client = new PGClient({...dbConfig, database: 'postgres'});
  try {
    await client.connect();
    await client.query(`drop database if exists ${dbConfig.database};`);
    await client.query(`create database ${dbConfig.database};`);
  } catch (err) {
    await client.end();
  }
}

export async function rebuildDbSchema() {
  const dbConfig = configAPI.get('postgres');
  const client = new PGClient(dbConfig);
  try {
    await client.connect();
    const evolutionsDir = path.resolve(process.cwd(), './db/evolutions');
    const sql1 = await Promise.promisify(fs.readFile)(path.join(evolutionsDir, 'schema/002 create interaction.sql'));
    await client.query(sql1.toString());
  } finally {
    await client.end();
  }
}
