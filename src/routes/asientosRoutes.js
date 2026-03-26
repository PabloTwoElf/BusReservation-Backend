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
    // Excluir asientos que están en hold local
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
    // Intentar llamar a API externa
    const response = await axios.get(`${EXTERNAL_SEAT_API}/disponibles`, {
      params: { rutaId, fecha },
      timeout: 10000
    });

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible, usando fallback local');

    // Fallback: generar datos locales
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
    // Intentar llamar a API externa
    const response = await axios.get(`${EXTERNAL_SEAT_API}/holds`, {
      timeout: 10000
    });

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para holds, usando fallback local');

    // Fallback: retornar holds locales
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

  // Verificar si ya existe un hold
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
    // Intentar llamar a API externa
    const response = await axios.post(`${EXTERNAL_SEAT_API}/reservar`, {
      rutaId,
      fecha,
      asiento,
      userId: userId || clientId
    }, { timeout: 10000 });

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para reservar, usando fallback local');

    // Fallback: crear hold local
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
    // Intentar llamar a API externa
    const response = await axios.delete(`${EXTERNAL_SEAT_API}/holds`, {
      data: { holdId, rutaId, fecha, asiento },
      timeout: 10000
    });

    // También eliminar del almacenamiento local si existe
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

    // Fallback: eliminar del almacenamiento local
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
    // Intentar llamar a API externa
    const response = await axios.post(`${EXTERNAL_SEAT_API}/reservar-definitivo`, {
      holdId,
      rutaId,
      fecha,
      asiento
    }, { timeout: 10000 });

    // Eliminar del almacenamiento local
    const holdKey = `${rutaId}_${fecha}_${asiento}`;
    localHolds.delete(holdKey);

    return res.json({
      ok: true,
      ...response.data
    });
  } catch (error) {
    console.log('[AsientosRoutes] API externa no disponible para confirmar, usando fallback local');

    // Fallback: confirmar localmente
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

  // Si viene cantidad, usar la API de pricing externa
  if (cantidad && cantidad > 0) {
    try {
      console.log(`[AsientosRoutes] Llamando pricing API con cantidad: ${cantidad}`);

      const response = await axios.post(`${PRICING_API}/calcular-precio`, {
        cantidad: Number(cantidad)
      }, { timeout: 15000 });

      console.log('[AsientosRoutes] Pricing API response:', response.data);

      return res.json({
        ok: true,
        ...response.data
      });
    } catch (error) {
      console.error('[AsientosRoutes] Error llamando pricing API:', error.message);

      // Fallback: cálculo local
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

  // Si no viene cantidad, usar rutaId y fecha (lógica anterior)
  if (!rutaId || !fecha) {
    return res.status(400).json({
      ok: false,
      error: "cantidad o (rutaId y fecha) son requeridos"
    });
  }

  // Fallback simple para rutaId/fecha
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
