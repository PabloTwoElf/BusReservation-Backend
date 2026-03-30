const express = require("express");
const router = express.Router();

// Helper: fetch con timeout de 4 segundos
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * @swagger
 * tags:
 *   name: SeatAPI
 *   description: Proxy para la API de Asientos (Render)
 */

// GET /api/seat/disponibles?rutaId=123&fecha=2026-01-26
/**
 * @swagger
 * /api/seat/disponibles:
 *   get:
 *     summary: Obtener asientos disponibles
 *     tags: [SeatAPI]
 *     parameters:
 *       - in: query
 *         name: rutaId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: fecha
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Lista de asientos disponibles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 available:
 *                   type: array
 *                   items:
 *                     type: integer
 */
router.get("/disponibles", async (req, res) => {
    try {
        const { rutaId, fecha } = req.query;
        if (!rutaId || !fecha) {
            return res.status(400).json({ ok: false, error: "Falta rutaId o fecha" });
        }

        const base = process.env.SEAT_API_URL;
        if (!base) {
            return res.status(500).json({ ok: false, error: "SEAT_API_URL no configurado" });
        }

        // Construir URL con parámetros
        const url = `${base}/api/asientos/disponibles?rutaId=${encodeURIComponent(
            rutaId
        )}&fecha=${encodeURIComponent(fecha)}`;

        const r = await fetchWithTimeout(url);

        // Propagar el status y el body
        const data = await r.json();
        return res.status(r.status).json(data);

    } catch (e) {
        console.error("Proxy GET error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/seat/reservar
/**
 * @swagger
 * /api/seat/reservar:
 *   post:
 *     summary: Reservar un asiento temporalmente (Hold)
 *     tags: [SeatAPI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rutaId
 *               - fecha
 *               - asiento
 *               - userId
 *             properties:
 *               rutaId:
 *                 type: string
 *               fecha:
 *                 type: string
 *               asiento:
 *                 type: integer
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Hold creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 holdId:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 */
router.post("/reservar", async (req, res) => {
    try {
        const base = process.env.SEAT_API_URL;
        if (!base) {
            return res.status(500).json({ ok: false, error: "SEAT_API_URL no configurado" });
        }

        const r = await fetchWithTimeout(`${base}/api/asientos/reservar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });

        const data = await r.json();
        return res.status(r.status).json(data);
    } catch (e) {
        console.error("Proxy POST error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// DELETE /api/seat/holds
/**
 * @swagger
 * /api/seat/holds:
 *   delete:
 *     summary: Liberar un asiento (Cancelar Hold)
 *     tags: [SeatAPI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rutaId
 *               - fecha
 *               - asiento
 *             properties:
 *               rutaId:
 *                 type: string
 *               fecha:
 *                 type: string
 *               asiento:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Hold eliminado
 */
router.delete("/holds", async (req, res) => {
    try {
        const base = process.env.SEAT_API_URL;
        if (!base) {
            return res.status(500).json({ ok: false, error: "SEAT_API_URL no configurado" });
        }

        const r = await fetchWithTimeout(`${base}/api/asientos/holds`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });

        const data = await r.json();
        return res.status(r.status).json(data);
    } catch (e) {
        console.error("Proxy DELETE hold error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/seat/reservar-definitivo
/**
 * @swagger
 * /api/seat/reservar-definitivo:
 *   post:
 *     summary: Confirmar reserva definitivamente
 *     tags: [SeatAPI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - holdId
 *             properties:
 *               holdId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reserva confirmada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 ticketId:
 *                   type: string
 */
router.post("/reservar-definitivo", async (req, res) => {
    try {
        const base = process.env.SEAT_API_URL;
        if (!base) {
            return res.status(500).json({ ok: false, error: "SEAT_API_URL no configurado" });
        }

        const r = await fetchWithTimeout(`${base}/api/asientos/reservar-definitivo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });

        const data = await r.json();
        return res.status(r.status).json(data);
    } catch (e) {
        console.error("Proxy POST confirm error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/seat/holds
/**
 * @swagger
 * /api/seat/holds:
 *   get:
 *     summary: Ver todos los holds activos
 *     tags: [SeatAPI]
 *     responses:
 *       200:
 *         description: Lista de holds activos
 */
router.get("/holds", async (req, res) => {
    try {
        const base = process.env.SEAT_API_URL;
        if (!base) {
            return res.status(500).json({ ok: false, error: "SEAT_API_URL no configurado" });
        }

        const r = await fetchWithTimeout(`${base}/api/asientos/holds`);
        const data = await r.json();
        return res.status(r.status).json(data);
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
