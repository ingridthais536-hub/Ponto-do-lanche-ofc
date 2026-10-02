const express = require('express');
const http = require('http');
const path = require('path');
const cookie = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.JWT_SECRET || 'change-me-in-production';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function q(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories(
      id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INTEGER DEFAULT 0, active BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS products(
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', price NUMERIC(12,2) NOT NULL,
      category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL, photo TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE, stock BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers(
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders(
      id BIGSERIAL PRIMARY KEY, number TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
      service TEXT DEFAULT 'viagem', table_no TEXT DEFAULT '', payment TEXT DEFAULT 'pix', change_for NUMERIC(12,2) DEFAULT 0,
      change_value NUMERIC(12,2) DEFAULT 0, total NUMERIC(12,2) NOT NULL, notes TEXT DEFAULT '',
      status TEXT DEFAULT 'Novo', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items(
      id BIGSERIAL PRIMARY KEY, order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT, name TEXT NOT NULL, qty INTEGER NOT NULL, price NUMERIC(12,2) NOT NULL, notes TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS cash(
      id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, description TEXT, category TEXT, value NUMERIC(12,2) NOT NULL,
      payment TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory(
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, kind TEXT, qty NUMERIC(12,3) DEFAULT 0, min_qty NUMERIC(12,3) DEFAULT 0,
      unit TEXT, cost NUMERIC(12,2) DEFAULT 0, supplier TEXT
    );
    CREATE TABLE IF NOT EXISTS notes(
      id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT, category TEXT, pinned BOOLEAN DEFAULT FALSE,
      done BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tasks(
      id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN DEFAULT FALSE, due TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS audit(
      id BIGSERIAL PRIMARY KEY, action TEXT, detail TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || '123456';
  const existing = await q('SELECT 1 FROM users WHERE username=$1', [adminUser]);
  if (!existing.rowCount) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await q('INSERT INTO users(username,password) VALUES($1,$2)', [adminUser, hash]);
  }

  const cats = ['Salgados','Bolos','Café','Bebidas','Doces','Merendas','Outros'];
  for (let i = 0; i < cats.length; i++) {
    await q('INSERT INTO categories(name,sort) VALUES($1,$2) ON CONFLICT(name) DO NOTHING', [cats[i], i]);
  }

  const count = await q('SELECT COUNT(*)::int AS c FROM products');
  if (count.rows[0].c === 0) {
    const catRows = await q('SELECT id,name FROM categories');
    const ids = Object.fromEntries(catRows.rows.map(x => [x.name, x.id]));
    const products = [
      ['Coxinha','Coxinha de frango com queijo',5,'Salgados'],
      ['Pastel','Opção prática para qualquer hora',5,'Salgados'],
      ['Bomba','Presunto e queijo',5.5,'Salgados'],
      ['Esfirra','Esfirra assada',5,'Salgados'],
      ['Rosquinha recheada','Doce recheado',6.5,'Doces'],
      ['Crepe','Crepe feito na hora',6,'Merendas'],
      ['Coca-Cola 2L','Refrigerante',12,'Bebidas']
    ];
    for (const [name, desc, price, cat] of products) {
      await q('INSERT INTO products(name,description,price,category_id) VALUES($1,$2,$3,$4)', [name, desc, price, ids[cat]]);
    }
  }

  const defaults = {
    name: 'Ponto do Lanche',
    whatsapp: '',
    hours: '06:30 – 17:00',
    address: 'BR-020, próximo à Oficina do Antônio Mecânico e perto de Dirceu Arcoverde',
    tagline: 'Seu lanche gostoso, do jeitinho que você gosta.'
  };
  for (const [key, value] of Object.entries(defaults)) {
    await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key, value]);
  }
}

function auth(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) throw new Error('missing');
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Não autorizado' });
  }
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookie());
app.use(express.static(path.join(__dirname, 'site')));

app.get('/healthz', async (_req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true, service: 'ponto-do-lanche' }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get('/api/menu', async (_req,res) => {
  const r = await q(`SELECT p.id,p.name,p.description,p.price,p.category_id,p.photo,p.active,p.stock,c.name AS category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.active=TRUE AND p.stock=TRUE ORDER BY c.sort,p.id`);
  res.json(r.rows);
});
app.get('/api/categories', async (_req,res) => {
  const r = await q('SELECT * FROM categories WHERE active=TRUE ORDER BY sort,id'); res.json(r.rows);
});

app.post('/api/login', async (req,res) => {
  const r = await q('SELECT * FROM users WHERE username=$1', [req.body.username]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password))) return res.status(401).json({error:'Usuário ou senha inválidos'});
  const token = jwt.sign({id:u.id,username:u.username}, SECRET, {expiresIn:'8h'});
  res.cookie('token', token, {httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:8*60*60*1000});
  res.json({ok:true});
});
app.post('/api/logout', (_req,res) => { res.clearCookie('token'); res.json({ok:true}); });
app.get('/api/me', auth, (req,res) => res.json(req.user));

app.post('/api/orders', async (req,res) => {
  const b=req.body;
  if(!b.name || !b.phone || !Array.isArray(b.items) || !b.items.length) return res.status(400).json({error:'Dados incompletos'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let total=0, items=[];
    for(const x of b.items){
      const p=(await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE AND stock=TRUE',[x.productId])).rows[0];
      if(!p) throw new Error('Produto indisponível');
      const qty=Math.max(1,Number(x.qty)||1); total += Number(p.price)*qty; items.push({...p,qty,notes:x.notes||''});
    }
    const number='PL-'+String(Date.now()).slice(-7);
    const r=await client.query(`INSERT INTO orders(number,name,phone,service,table_no,payment,change_for,total,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,number,total`,
      [number,b.name,b.phone,b.service||'viagem',b.tableNo||'',b.payment||'pix',Number(b.changeFor)||0,total,b.notes||'']);
    const order=r.rows[0];
    for(const x of items){ await client.query('INSERT INTO order_items(order_id,product_id,name,qty,price,notes) VALUES($1,$2,$3,$4,$5,$6)',[order.id,x.id,x.name,x.qty,x.price,x.notes]); }
    await client.query(`INSERT INTO customers(name,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name`,[b.name,b.phone]);
    await client.query('COMMIT');
    io.emit('order:new', order);
    res.json(order);
  } catch(e) { await client.query('ROLLBACK'); res.status(400).json({error:e.message}); }
  finally { client.release(); }
});

app.get('/api/orders/:number', async (req,res) => {
  const r=await q('SELECT * FROM orders WHERE number=$1',[req.params.number]); const o=r.rows[0];
  if(!o) return res.status(404).json({error:'Pedido não encontrado'});
  o.items=(await q('SELECT * FROM order_items WHERE order_id=$1',[o.id])).rows; res.json(o);
});

app.get('/api/admin/orders', auth, async (_req,res)=>res.json((await q('SELECT * FROM orders ORDER BY id DESC LIMIT 300')).rows));
app.get('/api/admin/orders/:id', auth, async (req,res)=>{const r=await q('SELECT * FROM orders WHERE id=$1',[req.params.id]);const o=r.rows[0];if(!o)return res.status(404).json({error:'Pedido não encontrado'});o.items=(await q('SELECT * FROM order_items WHERE order_id=$1',[o.id])).rows;res.json(o);});
app.patch('/api/admin/orders/:id', auth, async (req,res)=>{
  const allowed=['Novo','Confirmado','Em preparo','Pronto','Entregue','Cancelado'];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Status inválido'});
  await q('UPDATE orders SET status=$1 WHERE id=$2',[req.body.status,req.params.id]);
  await q('INSERT INTO audit(action,detail) VALUES($1,$2)',['order-status',`Pedido ${req.params.id}: ${req.body.status}`]);
  io.emit('order:status',{id:Number(req.params.id),status:req.body.status}); res.json({ok:true});
});

app.get('/api/admin/products',auth,async (_req,res)=>res.json((await q(`SELECT p.*,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC`)).rows));
app.post('/api/admin/products',auth,async(req,res)=>{const b=req.body;const r=await q('INSERT INTO products(name,description,price,category_id,active,stock) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.name,b.description||'',Number(b.price)||0,Number(b.category_id)||null,b.active===false?false:true,b.stock===false?false:true]);res.json({id:r.rows[0].id});});
app.put('/api/admin/products/:id',auth,async(req,res)=>{const b=req.body;await q('UPDATE products SET name=$1,description=$2,price=$3,category_id=$4,active=$5,stock=$6 WHERE id=$7',[b.name,b.description||'',Number(b.price)||0,Number(b.category_id)||null,b.active?true:false,b.stock?true:false,req.params.id]);res.json({ok:true});});
app.delete('/api/admin/products/:id',auth,async(req,res)=>{await q('DELETE FROM products WHERE id=$1',[req.params.id]);res.json({ok:true});});
app.post('/api/admin/categories',auth,async(req,res)=>{await q('INSERT INTO categories(name) VALUES($1)',[req.body.name]);res.json({ok:true});});
app.delete('/api/admin/categories/:id',auth,async(req,res)=>{await q('UPDATE categories SET active=FALSE WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/cash',auth,async(_req,res)=>res.json((await q('SELECT * FROM cash ORDER BY id DESC LIMIT 500')).rows));
app.post('/api/admin/cash',auth,async(req,res)=>{const b=req.body;await q('INSERT INTO cash(type,description,category,value,payment,notes) VALUES($1,$2,$3,$4,$5,$6)',[b.type,b.description,b.category||'Outros',Number(b.value)||0,b.payment||'',b.notes||'']);res.json({ok:true});});
app.delete('/api/admin/cash/:id',auth,async(req,res)=>{await q('DELETE FROM cash WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/inventory',auth,async(_req,res)=>res.json((await q('SELECT * FROM inventory ORDER BY id DESC')).rows));
app.post('/api/admin/inventory',auth,async(req,res)=>{const b=req.body;await q('INSERT INTO inventory(name,kind,qty,min_qty,unit,cost,supplier) VALUES($1,$2,$3,$4,$5,$6,$7)',[b.name,b.kind||'Outros',Number(b.qty)||0,Number(b.min_qty)||0,b.unit||'un',Number(b.cost)||0,b.supplier||'']);res.json({ok:true});});
app.put('/api/admin/inventory/:id',auth,async(req,res)=>{const b=req.body;await q('UPDATE inventory SET name=$1,kind=$2,qty=$3,min_qty=$4,unit=$5,cost=$6,supplier=$7 WHERE id=$8',[b.name,b.kind,Number(b.qty),Number(b.min_qty),b.unit,b.cost,b.supplier,req.params.id]);res.json({ok:true});});
app.delete('/api/admin/inventory/:id',auth,async(req,res)=>{await q('DELETE FROM inventory WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/notes',auth,async(_req,res)=>res.json((await q('SELECT * FROM notes ORDER BY pinned DESC,id DESC')).rows));
app.post('/api/admin/notes',auth,async(req,res)=>{const b=req.body;await q('INSERT INTO notes(title,body,category,pinned,done) VALUES($1,$2,$3,$4,$5)',[b.title,b.body,b.category||'Geral',!!b.pinned,!!b.done]);res.json({ok:true});});
app.put('/api/admin/notes/:id',auth,async(req,res)=>{const b=req.body;await q('UPDATE notes SET title=$1,body=$2,category=$3,pinned=$4,done=$5 WHERE id=$6',[b.title,b.body,b.category,!!b.pinned,!!b.done,req.params.id]);res.json({ok:true});});
app.delete('/api/admin/notes/:id',auth,async(req,res)=>{await q('DELETE FROM notes WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/tasks',auth,async(_req,res)=>res.json((await q('SELECT * FROM tasks ORDER BY done,due,id DESC')).rows));
app.post('/api/admin/tasks',auth,async(req,res)=>{await q('INSERT INTO tasks(title,due) VALUES($1,$2)',[req.body.title,req.body.due||'']);res.json({ok:true});});
app.patch('/api/admin/tasks/:id',auth,async(req,res)=>{await q('UPDATE tasks SET done=$1 WHERE id=$2',[!!req.body.done,req.params.id]);res.json({ok:true});});
app.delete('/api/admin/tasks/:id',auth,async(req,res)=>{await q('DELETE FROM tasks WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/dashboard',auth,async(_req,res)=>{
  const sales=(await q(`SELECT COALESCE(SUM(total),0)::numeric AS v FROM orders WHERE status!='Cancelado' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`)).rows[0].v;
  const orders=(await q(`SELECT COUNT(*)::int AS c FROM orders WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`)).rows[0].c;
  const pending=(await q(`SELECT COUNT(*)::int AS c FROM orders WHERE status IN ('Novo','Confirmado','Em preparo','Pronto')`)).rows[0].c;
  const cashIn=(await q(`SELECT COALESCE(SUM(value),0)::numeric AS v FROM cash WHERE type='entrada' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`)).rows[0].v;
  const cashOut=(await q(`SELECT COALESCE(SUM(value),0)::numeric AS v FROM cash WHERE type='saida' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`)).rows[0].v;
  const top=(await q(`SELECT name,SUM(qty)::int AS qty FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='Cancelado' GROUP BY name ORDER BY qty DESC LIMIT 8`)).rows;
  res.json({sales:Number(sales),orders,pending,cashIn:Number(cashIn),cashOut:Number(cashOut),balance:Number(cashIn)-Number(cashOut),top});
});

app.get('/api/admin/settings',auth,async(_req,res)=>{const r=await q('SELECT key,value FROM settings');res.json(Object.fromEntries(r.rows.map(x=>[x.key,x.value])));});
app.put('/api/admin/settings',auth,async(req,res)=>{for(const [k,v] of Object.entries(req.body)){await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[k,String(v)]);}res.json({ok:true});});

app.use('/admin', express.static(path.join(__dirname,'admin')));
app.get('/admin/*', (_req,res)=>res.sendFile(path.join(__dirname,'admin','index.html')));

io.on('connection', socket => socket.emit('connected'));

(async()=>{
  await initDb();
  server.listen(PORT,'0.0.0.0',()=>console.log(`Ponto do Lanche online na porta ${PORT}`));
})().catch(err=>{console.error(err);process.exit(1);});
