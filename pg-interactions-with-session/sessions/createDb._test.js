import {promisify} from 'util'
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
    const sql = await promisify(fs.readFile)(path.join(evolutionsDir, '001.sql'));
    await client.query(sql.toString());
  } finally {
    await client.end();
  }
}
