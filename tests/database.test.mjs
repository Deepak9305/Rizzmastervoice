import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const session = '00000000-0000-4000-8000-000000000003';
test('real schema: RLS isolation, denied direct writes, quotas, revocation and deletion cascade', async t => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${a}'), ('${b}'); insert into auth.sessions values ('${session}', '${a}');`);
  await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into voice_profiles(user_id) values ('${a}'), ('${b}');
    insert into voice_sessions(user_id,title,mode,coach,messages) values ('${a}','A','advice','wingman','[]'),('${b}','B','advice','wingman','[]');`);
  await t.test('authenticated users read only their own rows and cannot change access', async () => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`);
    assert.equal((await db.query('select * from voice_profiles')).rows.length, 1);
    assert.equal((await db.query('select title from voice_sessions')).rows[0].title, 'A');
    for (const sql of [`update voice_profiles set age_confirmed=true`, `insert into voice_purchases(purchase_token,user_id,state) values('fake','${a}','ACTIVE')`, `select * from voice_purchases`, `select voice_reserve_turn('${a}')`, `select voice_session_active('${a}','${session}')`]) await assert.rejects(db.exec(sql), /permission denied/);
    await db.exec('reset role');
  });
  await t.test('anonymous readers are denied', async () => {
    await db.exec('set role anon'); await assert.rejects(db.exec('select * from voice_profiles'), /permission denied/); await db.exec('reset role');
  });
  await t.test('concurrent free requests reserve exactly five turns', async () => {
    await db.exec('set role service_role');
    const results = await Promise.all(Array.from({ length: 16 }, () => db.query(`select voice_reserve_turn('${a}') as quota`)));
    assert.equal(results.filter(r => r.rows[0].quota.allowed).length, 5);
    assert.equal((await db.query(`select turns from voice_usage where user_id='${a}'`)).rows[0].turns, 5);
    await db.exec('reset role');
  });
  await t.test('verified premium has sixty turns, expiration immediately downgrades', async () => {
    await db.exec(`insert into voice_purchases(purchase_token,user_id,state,active,plan,expires_at) values ('verified-token','${b}','SUBSCRIPTION_STATE_ACTIVE',true,'monthly',now()+interval '1 day'); set role service_role;`);
    const results = await Promise.all(Array.from({ length: 65 }, () => db.query(`select voice_reserve_turn('${b}') as quota`)));
    assert.equal(results.filter(r => r.rows[0].quota.allowed).length, 60);
    await db.exec(`update voice_purchases set expires_at=now()-interval '1 second' where user_id='${b}'`);
    const quota = (await db.query(`select voice_reserve_turn('${b}') as quota`)).rows[0].quota;
    assert.equal(quota.allowed, false); assert.equal(quota.limit, 5);
    await db.exec('reset role');
  });
  await t.test('reports limited to twenty per UTC day', async () => {
    await db.exec('set role service_role');
    const results = await Promise.all(Array.from({ length: 25 }, () => db.query(`select voice_reserve_report('${a}') as allowed`)));
    assert.equal(results.filter(r => r.rows[0].allowed).length, 20); await db.exec('reset role');
  });
  await t.test('revoked or mismatched sessions reject stale tokens', async () => {
    assert.equal((await db.query(`select voice_session_active('${a}','${session}') as active`)).rows[0].active, true);
    assert.equal((await db.query(`select voice_session_active('${b}','${session}') as active`)).rows[0].active, false);
    await db.exec(`delete from auth.sessions where id='${session}'`);
    assert.equal((await db.query(`select voice_session_active('${a}','${session}') as active`)).rows[0].active, false);
  });
  await t.test('account deletion cascades through all app tables', async () => {
    await db.exec(`insert into voice_reports(user_id,reason,content) values('${b}','Harmful advice','Example'); delete from auth.users where id='${b}'`);
    for (const table of ['voice_profiles','voice_sessions','voice_purchases','voice_usage','voice_reports']) assert.equal((await db.query(`select count(*)::integer as n from ${table} where user_id='${b}'`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::integer as n from voice_profiles where user_id='${a}'`)).rows[0].n, 1);
  });
  await db.close();
});
