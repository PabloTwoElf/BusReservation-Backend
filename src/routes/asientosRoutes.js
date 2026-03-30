const express = require("express");
const router = express.Router();
const axios = require('axios');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @swagger
 * tags:
 *   name: Asientos
 *   description: API de Asientos (local + proxy a API externa)
 */

// URL de la API externa de asientos
const EXTERNAL_SEAT_API = process.env.EXTERNAL_SEAT_API || 'https://apiconsumidorac.vercel.app';
const PRICING_API = process.env.PRICING_API || 'https://apiconsumidorac.vercel.app';

// Almacenamiento en memoria para holds (demo/fallback)
const localHolds = new Map();
const HOLD_EXPIRY_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Genera lista de asientos disponibles por defecto (1-40)
 */
function generateDefaultSeats(rutaId, fecha) {
  const available = [];
  for (let i = 1; i <= 40; i++) {
    const holdKey = `${rutaId}_${fecha}_${i}`;
    if (!localHolds.has(holdKey)) {
      available.push(i);
    }
  }
  return available;
}

/**
 * Limpia holds expirados
 */
function cleanupExpiredHolds() {
  const now = Date.now();
  for (const [key, hold] of localHolds.entries()) {
    if (new Date(hold.expiresAt).getTime() < now) {
      localHolds.delete(key);
    }
  }
}

// Limpiar holds expirados cada 30 segundos
setInterval(cleanupExpiredHolds, 30000);

/**
 * GET /api/asientos/view-model
 * View Model completo del mapa de asientos para la interfaz visual.
 * Reemplaza las llamadas paralelas a /disponibles + /holds.
 */
router.get("/view-model", asyncHandler(async (req, res) => {
  const { rutaId, fecha, userId } = req.query;

  if (!rutaId || !fecha) {
    return res.status(400).json({ ok: false, error: "rutaId y fecha son requeridos" });
  }

  cleanupExpiredHolds();

  try {
    const response = await axios.get(`${EXTERNAL_SEAT_API}/view-model`, {
      params: { rutaId, fecha, userId },
      timeout: 10000,
    });
    return res.json({ ok: true, ...response.data });
  } catch (error) {
    console.log('[AsientosRoutes] view-model API no disponible, generando fallback local');

    const available = generateDefaultSeats(rutaId, fecha);
    const availableSet = new Set(available);
    const now = Date.now();

    const asientos = Array.from({ length: 40 }, (_, i) => {
      const num = i + 1;
      const holdKey = `${rutaId}_${fecha}_${num}`;
      const hold = localHolds.get(holdKey);
      let estado;
      if (availableSet.has(num)) {
        estado = 'disponible';
      } else if (hold) {
        estado = (userId && hold.userId === userId) ? 'miHold' : 'en_hold';
      } else {
        estado = 'ocupado';
      }
      return {
        numero: num,
        estado,
        holdId: hold ? hold.holdId : null,
        expiresAt: hold ? hold.expiresAt : null,
        remainingMs: hold ? Math.max(0, new Date(hold.expiresAt).getTime() - now) : null,
      };
    });

    return res.json({
      ok: true,
      rutaId,
      fecha,
      totalAsientos: 40,
      asientos,
      available,
      total: available.length,
      resumen: {
        disponibles: available.length,
        enHold: asientos.filter(a => a.estado === 'en_hold').length,
        miHold: asientos.filter(a => a.estado === 'miHold').length,
        ocupados: asientos.filter(a => a.estado === 'ocupado').length,
      },
      _isFallback: true,
    });
  }
}));

/**
 * GET /api/asientos/disponibles
 * Obtiene asientos disponibles para una ruta y fecha
 */
router.get("/disponibles", asyncHandler(async (req, res) => {
  const { rutaId, fecha } = req.query;

  if (!rutaId || !fecha) {
    return res.status(400).json({
      ok: false,
      error: "rutaId y fecha son requeridos"
    });
  }

  cleanupExpiredHolds();

  try {
    const response = await axios.get(`${EXTERNAL_SEAT_API}/disponibles`, {
      params: { rutaId, fecha },
      timeout: 4000
    });

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible, usando fallback local');

    const available = generateDefaultSeats(rutaId, fecha);

    return res.json({
      ok: true,
      rutaId,
      fecha,
      available,
      total: 40,
      _isFallback: true
    });
  }
}));

/**
 * GET /api/asientos/holds
 * Obtiene holds activos
 */
router.get("/holds", asyncHandler(async (req, res) => {
  cleanupExpiredHolds();

  try {
    const response = await axios.get(`${EXTERNAL_SEAT_API}/holds`, {
      timeout: 4000
    });

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para holds, usando fallback local');

    const holds = Array.from(localHolds.values());

    return res.json({
      ok: true,
      holds,
      count: holds.length,
      _isFallback: true
    });
  }
}));

/**
 * POST /api/asientos/reservar
 * Crear un hold temporal sobre un asiento
 */
router.post("/reservar", asyncHandler(async (req, res) => {
  const { rutaId, fecha, asiento, userId, clientId } = req.body;

  if (!rutaId || !fecha || !asiento) {
    return res.status(400).json({
      ok: false,
      error: "rutaId, fecha y asiento son requeridos"
    });
  }

  cleanupExpiredHolds();

  const holdKey = `${rutaId}_${fecha}_${asiento}`;

  if (localHolds.has(holdKey)) {
    const existingHold = localHolds.get(holdKey);
    if (existingHold.userId !== (userId || clientId)) {
      return res.status(409).json({
        ok: false,
        error: "Este asiento ya está reservado por otro usuario"
      });
    }
  }

  try {
    const response = await axios.post(`${EXTERNAL_SEAT_API}/reservar`, {
      rutaId,
      fecha,
      asiento,
      userId: userId || clientId
    }, { timeout: 4000 });

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para reservar, usando fallback local');

    const holdId = `hold_${Date.now()}_${asiento}`;
    const expiresAt = new Date(Date.now() + HOLD_EXPIRY_MS).toISOString();

    const hold = {
      holdId,
      rutaId: String(rutaId),
      fecha: String(fecha),
      asiento: Number(asiento),
      userId: userId || clientId || 'guest',
      expiresAt,
      remainingMs: HOLD_EXPIRY_MS,
      createdAt: new Date().toISOString()
    };

    localHolds.set(holdKey, hold);

    return res.json({
      ok: true,
      ...hold,
      _isFallback: true
    });
  }
}));

/**
 * DELETE /api/asientos/holds
 * Liberar un hold (cancelar reserva temporal)
 */
router.delete("/holds", asyncHandler(async (req, res) => {
  const { holdId, rutaId, fecha, asiento } = req.body;

  cleanupExpiredHolds();

  try {
    const response = await axios.delete(`${EXTERNAL_SEAT_API}/holds`, {
      data: { holdId, rutaId, fecha, asiento },
      timeout: 4000
    });

    if (rutaId && fecha && asiento) {
      const holdKey = `${rutaId}_${fecha}_${asiento}`;
      localHolds.delete(holdKey);
    }

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para delete, usando fallback local');

    if (rutaId && fecha && asiento) {
      const holdKey = `${rutaId}_${fecha}_${asiento}`;
      localHolds.delete(holdKey);
    }

    return res.json({
      ok: true,
      released: true,
      _isFallback: true
    });
  }
}));

/**
 * POST /api/asientos/reservar-definitivo
 * Confirmar un hold como reserva definitiva
 */
router.post("/reservar-definitivo", asyncHandler(async (req, res) => {
  const { holdId, rutaId, fecha, asiento } = req.body;

  if (!holdId || !rutaId || !fecha || !asiento) {
    return res.status(400).json({
      ok: false,
      error: "holdId, rutaId, fecha y asiento son requeridos"
    });
  }

  cleanupExpiredHolds();

  try {
    const response = await axios.post(`${EXTERNAL_SEAT_API}/reservar-definitivo`, {
      holdId,
      rutaId,
      fecha,
      asiento
    }, { timeout: 4000 });

    const holdKey = `${rutaId}_${fecha}_${asiento}`;
    localHolds.delete(holdKey);

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para confirmar, usando fallback local');

    const holdKey = `${rutaId}_${fecha}_${asiento}`;
    localHolds.delete(holdKey);

    return res.json({
      ok: true,
      reservedAt: new Date().toISOString(),
      asiento,
      rutaId,
      fecha,
      _isFallback: true
    });
  }
}));

/**
 * POST /api/asientos/calcular-precio
 * Proxy para la API de pricing externa (evita CORS)
 */
router.post("/calcular-precio", asyncHandler(async (req, res) => {
  const { cantidad, rutaId, fecha, isHoliday } = req.body;

  if (cantidad && cantidad > 0) {
    try {
      const response = await axios.post(`${PRICING_API}/calcular-precio`, {
        cantidad: Number(cantidad)
      }, { timeout: 4000 });

      return res.json({ ok: true, ...response.data });
    } catch (error) {
      const precioUnitario = 50000;
      const subtotal = cantidad * precioUnitario;
      let porcentajeDescuento = 0;
      if (cantidad >= 5) porcentajeDescuento = 10;
      else if (cantidad >= 4) porcentajeDescuento = 10;
      else if (cantidad >= 3) porcentajeDescuento = 7;
      else if (cantidad >= 2) porcentajeDescuento = 5;
      const montoDescuento = Math.round(subtotal * (porcentajeDescuento / 100));
      const total = subtotal - montoDescuento;
      return res.json({
        ok: true,
        cantidad,
        precioUnitario,
        subtotal,
        porcentajeDescuento,
        montoDescuento,
        total,
        ahorros: montoDescuento,
        _isFallback: true
      });
    }
  }

  if (!rutaId || !fecha) {
    return res.status(400).json({ ok: false, error: "cantidad o (rutaId y fecha) son requeridos" });
  }

  return res.json({
    ok: true,
    precioBase: 50000,
    descuento: 0,
    recargo: 0,
    totalPagar: 50000,
    _isFallback: true
  });
}));

module.exports = router;
