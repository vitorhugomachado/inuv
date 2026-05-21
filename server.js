import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuração PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('error', (err) => {
  console.error('Erro no pool de conexão:', err);
});

// ==========================================
// IN-MEMORY CACHE (TTL = 60 segundos)
// ==========================================

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 segundos

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function invalidateCache(...keys) {
  keys.forEach(k => cache.delete(k));
}

// Middleware helper para rotas GET com cache
function withCache(key, queryFn) {
  return async (req, res) => {
    const cached = getCache(key);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
    try {
      const result = await queryFn();
      setCache(key, result);
      res.setHeader('X-Cache', 'MISS');
      res.json(result);
    } catch (err) {
      console.error(`Erro em ${key}:`, err);
      res.status(500).json({ error: err.message });
    }
  };
}

// ==========================================
// ENDPOINTS - CATEGORIAS
// ==========================================

app.get('/api/categories', withCache('categories', async () => {
  const r = await pool.query('SELECT * FROM categories ORDER BY name');
  return r.rows || [];
}));

app.post('/api/categories', async (req, res) => {
  const { name, key } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO categories (name, key) VALUES ($1, $2) RETURNING *',
      [name, key]
    );
    invalidateCache('categories');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar categoria:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:key', async (req, res) => {
  const { key } = req.params;
  try {
    await pool.query('DELETE FROM categories WHERE key = $1', [key]);
    invalidateCache('categories');
    res.json({ message: 'Categoria deletada' });
  } catch (err) {
    console.error('Erro ao deletar categoria:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS - UNIDADES DE MEDIDA
// ==========================================

app.get('/api/units', withCache('units', async () => {
  const r = await pool.query('SELECT * FROM units ORDER BY name');
  return r.rows || [];
}));

app.post('/api/units', async (req, res) => {
  const { name, key } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO units (name, key) VALUES ($1, $2) RETURNING *',
      [name, key]
    );
    invalidateCache('units');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar unidade:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/units/:key', async (req, res) => {
  const { key } = req.params;
  try {
    await pool.query('DELETE FROM units WHERE key = $1', [key]);
    invalidateCache('units');
    res.json({ message: 'Unidade deletada' });
  } catch (err) {
    console.error('Erro ao deletar unidade:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS - MATERIAIS
// ==========================================

app.get('/api/materials', withCache('materials', async () => {
  const r = await pool.query('SELECT * FROM materials ORDER BY name');
  return r.rows || [];
}));

app.post('/api/materials', async (req, res) => {
  const { name, category, unit, quantity, unitValue, minStock } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO materials (name, category, unit, quantity, unit_value, min_stock) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, category, unit, quantity, unitValue, minStock]
    );
    invalidateCache('materials');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar material:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/materials/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, unit, quantity, unitValue, minStock } = req.body;
  try {
    const result = await pool.query(
      'UPDATE materials SET name=$1, category=$2, unit=$3, quantity=$4, unit_value=$5, min_stock=$6 WHERE id=$7 RETURNING *',
      [name, category, unit, quantity, unitValue, minStock, id]
    );
    invalidateCache('materials');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar material:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/materials/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM materials WHERE id = $1', [id]);
    invalidateCache('materials');
    res.json({ message: 'Material deletado' });
  } catch (err) {
    console.error('Erro ao deletar material:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS - DEPLOYMENTS
// ==========================================

app.get('/api/deployments', withCache('deployments', async () => {
  const r = await pool.query('SELECT * FROM deployments ORDER BY city');
  return r.rows || [];
}));

app.post('/api/deployments', async (req, res) => {
  const { name, city, address, status } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO deployments (name, city, address, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, city, address, status]
    );
    invalidateCache('deployments');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar deployment:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS - ENTREGAS
// ==========================================

app.get('/api/deliveries', withCache('deliveries', async () => {
  const r = await pool.query('SELECT * FROM deliveries ORDER BY date DESC');
  return r.rows || [];
}));

app.post('/api/deliveries', async (req, res) => {
  const { materialId, quantity, date, destination } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO deliveries (material_id, quantity, date, destination) VALUES ($1, $2, $3, $4) RETURNING *',
      [materialId, quantity, date, destination]
    );
    invalidateCache('deliveries', 'materials');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar entrega:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CACHE ADMIN
// ==========================================

app.delete('/api/cache', (req, res) => {
  const size = cache.size;
  cache.clear();
  console.log(`🗑️  Cache limpo (${size} entradas removidas)`);
  res.json({ message: `Cache limpo: ${size} entradas removidas` });
});

app.get('/api/cache/stats', (req, res) => {
  const stats = {};
  cache.forEach((v, k) => {
    stats[k] = {
      age_ms: Date.now() - v.ts,
      expires_in_ms: CACHE_TTL_MS - (Date.now() - v.ts)
    };
  });
  res.json({ size: cache.size, ttl_ms: CACHE_TTL_MS, entries: stats });
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      timestamp: result.rows[0].now,
      cache_entries: cache.size,
      message: 'Backend rodando e conectado ao PostgreSQL'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Erro na conexão com PostgreSQL',
      error: err.message
    });
  }
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================

app.listen(PORT, () => {
  console.log(`🚀 Backend INUV FIBRAS rodando em http://localhost:${PORT}`);
  console.log(`⚡ Cache em memória ativo (TTL: ${CACHE_TTL_MS / 1000}s)`);
  console.log(`📡 GET /api/materials  GET /api/deployments  GET /api/deliveries`);
  console.log(`   GET /api/categories GET /api/units        GET /api/health`);
  console.log(`   DEL /api/cache      GET /api/cache/stats`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  await pool.end();
  process.exit(0);
});
