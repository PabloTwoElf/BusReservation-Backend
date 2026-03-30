require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const connectDb = require('./config/db');
const routes = require('./routes');
const { swaggerUi, swaggerSpec } = require('./config/swagger');

const app = express();

// Middlewares
app.use(compression()); // Comprimir respuestas gzip

// Configurar Helmet sin CSP para evitar bloqueos
app.use(
  helmet({
    contentSecurityPolicy: false, // Deshabilitar CSP completamente
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(cors({
  origin: true, // Permitir cualquier origen
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Evitar 404 de favicon en consola del navegador
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Database
connectDb();

// Health check (antes de las rutas de API)
app.get('/health', (req, res) => res.json({ ok: true, name: 'BusReservation API' }));

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes API (deben estar antes de los archivos estáticos)
app.use('/api', routes);

// Servir archivos estáticos del frontend (si existe la carpeta public)
const publicDir = path.join(__dirname, '..', 'public');
const fs = require('fs');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  // Catch-all handler: servir index.html para rutas del frontend (SPA routing)
  // IMPORTANTE: Este debe ir después de las rutas de API
  app.get('*', (req, res) => {
    // No servir index.html para rutas de API
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  // Si no hay frontend compilado, solo mostrar API
  app.get('/', (req, res) => res.json({ ok: true, name: 'BusReservation API' }));
}

// 404 handler (solo para rutas que no coincidieron arriba)
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Not Found' });
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

// Error handler middleware (debe ser el último)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

module.exports = app;
