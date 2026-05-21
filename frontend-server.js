import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = 5500;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Servir arquivos estáticos
app.use(express.static(__dirname));
app.use(express.json());

// Rota padrão
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '✅ Frontend rodando' });
});

app.listen(PORT, () => {
  console.log(`\n🎨 Frontend INUV FIBRAS rodando em http://localhost:${PORT}`);
  console.log(`📡 Backend em http://localhost:3000`);
  console.log(`🔗 Abra http://localhost:${PORT} no navegador\n`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Frontend encerrado');
  process.exit(0);
});
