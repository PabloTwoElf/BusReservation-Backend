const express = require("express");
const router = express.Router();
const axios = require('axios');
const Ruta = require('../models/rutaModel');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @swagger
 * tags:
 *   name: Pricing
 *   description: Cálculo de precios usando lógica de descuentos de API externa pero precios locales
 */

const PRICING_API = process.env.PRICING_API || 'https://apiconsumidorac.vercel.app';

/**
 * POST /api/pricing/calcular-precio
 * Calcula precio usando:
 * - Precio base: de la ruta local (o precio por defecto)
 * - Lógica de descuentos: de la API externa (o fallback local)
 */
router.post("/calcular-precio", asyncHandler(async (req, res) => {
    const { cantidad, rutaId } = req.body;

    if (!cantidad || cantidad <= 0) {
        return res.status(400).json({
            ok: false,
            error: "cantidad es requerida y debe ser mayor a 0"
        });
    }

    // 1. Obtener precio base de la ruta local (si se proporciona rutaId)
    let precioUnitario = 50000; // Precio por defecto

    if (rutaId) {
        try {
            const ruta = await Ruta.findById(rutaId).lean();
            if (ruta && ruta.price) {
                precioUnitario = ruta.price;
                console.log(`[PricingProxy] Usando precio de ruta local: $${precioUnitario}`);
            }
        } catch (err) {
            console.log('[PricingProxy] Error obteniendo ruta, usando precio por defecto');
        }
    }

    // 2. Obtener lógica de descuentos de API externa
    try {
        console.log(`[PricingProxy] Llamando API externa para descuentos con cantidad: ${cantidad}`);

        const response = await axios.post(`${PRICING_API}/calcular-precio`, {
            cantidad: Number(cantidad)
        }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });

        // Extraer solo el porcentaje de descuento de la API externa
        const apiData = response.data;
        const porcentajeDescuento = apiData.porcentajeDescuento || 0;

        console.log(`[PricingProxy] API externa retornó ${porcentajeDescuento}% de descuento`);

        // 3. Calcular con precio local + descuento de API externa
        const subtotal = cantidad * precioUnitario;
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
            _source: 'local_price_external_discount'
        });

    } catch (error) {
        console.error('[PricingProxy] Error llamando API externa, usando cálculo local:', error.message);

        // Fallback: cálculo 100% local
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
            _isFallback: true,
            _source: 'local_only'
        });
    }
}));

module.exports = router;
