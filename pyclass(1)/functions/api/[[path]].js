const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hash(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });

export async function onRequest({ request, env }) {
  const db = env.DB, m = request.method;
  const [a, b, c] = new URL(request.url).pathname.replace(/^\/api\//, '').split('/');
  const body = m === 'GET' ? {} : await request.json().catch(() => ({}));
  const sid = (request.headers.get('cookie') || '').match(/sid=(\w+)/);
  const me = sid ? await db.prepare('select u.id,u.name,u.username,u.role,u.section from sessions s join users u on u.id=s.user_id where s.token=? and s.exp>?').bind(sid[1], Date.now()).first() : null;
  const session = async id => { const t = rnd(24); await db.prepare('insert into sessions values(?,?,?)').bind(t, id, Date.now() + 6048e5).run(); return { 'set-cookie': `sid=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` }; };
  const count = async () => (await db.prepare('select count(*) n from users').first()).n;

  if (a === 'me') return J({ me, needsSetup: !me && (await count()) === 0 });
  if (a === 'setup' && m === 'POST') {
    if (await count()) return J({ error: 'Already set up' }, 403);
    const salt = rnd(8), u = String(body.username || '').toLowerCase();
    if (!u || !body.password) return J({ error: 'Username and password required' }, 400);
    const r = await db.prepare("insert into users(username,name,role,salt,hash) values(?,?,'teacher',?,?)").bind(u, body.name || u, salt, await hash(body.password, salt)).run();
    return J({ ok: 1 }, 200, await session(r.meta.last_row_id));
  }
  if (a === 'login' && m === 'POST') {
    const u = await db.prepare('select * from users where username=?').bind(String(body.username || '').toLowerCase()).first();
    if (!u || (await hash(body.password || '', u.salt)) !== u.hash) return J({ error: 'Wrong username or password' }, 401);
    return J({ ok: 1 }, 200, await session(u.id));
  }
  if (!me) return J({ error: 'Please sign in' }, 401);
  if (a === 'logout') { await db.prepare('delete from sessions where token=?').bind(sid[1]).run(); return J({ ok: 1 }, 200, { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); }
  const T = me.role === 'teacher';

  if (a === 'assignments' && !b && m === 'GET') {
    if (T) return J((await db.prepare('select a.id,a.title,a.kind,a.unit,a.due,a.section,(select count(*) from submissions where assignment_id=a.id) subs from assignments a order by a.id desc').all()).results);
    return J((await db.prepare("select a.id,a.title,a.kind,a.unit,a.due,s.score,s.submitted_at from assignments a left join submissions s on s.assignment_id=a.id and s.user_id=? where a.section='' or a.section=? order by a.id desc").bind(me.id, me.section).all()).results);
  }
  if (a === 'assignments' && !b && m === 'POST' && T) {
    await db.prepare('insert into assignments(title,kind,unit,due,section,prompt,questions,created) values(?,?,?,?,?,?,?,?)').bind(body.title, body.kind, +body.unit, body.due || '', body.section || '', body.prompt || '', JSON.stringify(body.questions || []), Date.now()).run();
    return J({ ok: 1 });
  }
  if (a === 'assignments' && b && !c && m === 'GET') {
    const as = await db.prepare('select * from assignments where id=?').bind(b).first();
    if (!as) return J({ error: 'Not found' }, 404);
    as.questions = JSON.parse(as.questions || '[]');
    if (T) { as.subs = (await db.prepare('select s.*,u.name from submissions s join users u on u.id=s.user_id where assignment_id=? order by u.name').bind(b).all()).results; return J(as); }
    as.questions = as.questions.map(q => ({ q: q.q, options: q.options }));
    as.mine = await db.prepare('select answers,score,feedback from submissions where assignment_id=? and user_id=?').bind(b, me.id).first();
    return J(as);
  }
  if (a === 'assignments' && b && !c && m === 'DELETE' && T) {
    await db.batch([db.prepare('delete from submissions where assignment_id=?').bind(b), db.prepare('delete from assignments where id=?').bind(b)]);
    return J({ ok: 1 });
  }
  if (a === 'assignments' && b && c === 'submit' && m === 'POST' && !T) {
    const as = await db.prepare('select * from assignments where id=?').bind(b).first();
    const ex = await db.prepare('select id from submissions where assignment_id=? and user_id=?').bind(b, me.id).first();
    let score = null;
    if (as.kind === 'quiz') {
      if (ex) return J({ error: 'Quiz already submitted' }, 409);
      const qs = JSON.parse(as.questions); let r = 0;
      qs.forEach((q, i) => { const x = (body.answers || [])[i]; if (q.options ? x === q.answer : String(x ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase()) r++; });
      score = Math.round(100 * r / (qs.length || 1));
    }
    await db.prepare('insert into submissions(assignment_id,user_id,answers,score,submitted_at) values(?,?,?,?,?) on conflict(assignment_id,user_id) do update set answers=excluded.answers,score=excluded.score,feedback=null,submitted_at=excluded.submitted_at').bind(b, me.id, JSON.stringify(body.answers), score, Date.now()).run();
    return J({ score });
  }
  if (!T) return J({ error: 'Teachers only' }, 403);

  if (a === 'submissions' && b && c === 'grade' && m === 'POST') {
    await db.prepare('update submissions set score=?,feedback=? where id=?').bind(body.score === '' ? null : +body.score, body.feedback || '', b).run();
    return J({ ok: 1 });
  }
  if (a === 'students' && !b && m === 'GET') return J((await db.prepare("select id,name,username,section from users where role='student' order by section,name").all()).results);
  if (a === 'students' && !b && m === 'POST') {
    const out = [];
    for (const line of String(body.text || '').split('\n').map(x => x.trim()).filter(Boolean)) {
      const [name, section = ''] = line.split(',').map(x => x.trim());
      const username = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + Math.floor(10 + Math.random() * 90);
      const password = rnd(3), salt = rnd(8);
      await db.prepare("insert into users(username,name,role,section,salt,hash) values(?,?,'student',?,?,?)").bind(username, name, section, salt, await hash(password, salt)).run();
      out.push({ name, section, username, password });
    }
    return J(out);
  }
  if (a === 'students' && b && c === 'reset' && m === 'POST') {
    const password = rnd(3), salt = rnd(8);
    await db.prepare('update users set salt=?,hash=? where id=?').bind(salt, await hash(password, salt), b).run();
    return J({ password });
  }
  if (a === 'students' && b && m === 'DELETE') {
    await db.batch([db.prepare('delete from submissions where user_id=?').bind(b), db.prepare('delete from sessions where user_id=?').bind(b), db.prepare("delete from users where id=? and role='student'").bind(b)]);
    return J({ ok: 1 });
  }
  if (a === 'grades') {
    const [st, as, su] = await Promise.all([
      db.prepare("select id,name,section from users where role='student' order by section,name").all(),
      db.prepare('select id,title,section from assignments order by id').all(),
      db.prepare('select assignment_id,user_id,score from submissions').all()]);
    return J({ students: st.results, assignments: as.results, subs: su.results });
  }
  return J({ error: 'Not found' }, 404);
}
