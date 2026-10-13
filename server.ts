import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { cloudTelegramBot } from './src/server/cloudBotService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Cloud Run / Reverse Proxy ortida ishlaganda protokollar va IP larni to'g'ri aniqlash
  app.set('trust proxy', true);

  app.use(express.json());

  app.use((req: Request, res: Response, next) => {
    cloudTelegramBot.updateBaseUrl(req);
    next();
  });

  // 1. Health-check endpoint
  app.get(['/api/health', '/healthz'], (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      cloud_bot: cloudTelegramBot.getStatus(),
    });
  });

  // 2. Telegram Bot Status endpoint
  app.get('/api/telegram/status', (req: Request, res: Response) => {
    res.json(cloudTelegramBot.getStatus());
  });

  // 3. Telegram Send / Proxy endpoint (Dublikatlarni oldini oluvchi kesh bilan)
  const serverProxyDedupeCache = new Map<string, { time: number; data: any }>();

  app.post('/api/telegram/send', async (req: Request, res: Response) => {
    try {
      const { token, chat_id, text } = req.body;
      if (!token || !chat_id || !text) {
        return res.status(400).json({ ok: false, error: 'Token, chat_id va text kiritilishi shart' });
      }

      // Keshni tozalash va dublikatni tekshirish
      const now = Date.now();
      const dedupeKey = `${String(token).slice(-6)}_${String(chat_id)}_${String(text).trim()}`;
      const cached = serverProxyDedupeCache.get(dedupeKey);
      if (cached && now - cached.time < 15000) {
        return res.json({ ...cached.data, deduplicated: true });
      }

      const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      const data = await tgRes.json();

      // Agar guruh superguruhga o'tgan bo'lsa (migrate_to_chat_id)
      if (!data.ok && data.parameters?.migrate_to_chat_id) {
        const newChatId = String(data.parameters.migrate_to_chat_id);
        console.log(`[Telegram Proxy] Guruh superguruhga o'tdi: ${chat_id} -> ${newChatId}`);
        const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: newChatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        const retryData = await retryRes.json();
        const finalResult = {
          ...retryData,
          migrated_to: newChatId,
        };
        serverProxyDedupeCache.set(dedupeKey, { time: now, data: finalResult });
        return res.json(finalResult);
      }

      serverProxyDedupeCache.set(dedupeKey, { time: now, data });
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message || 'Server xatosi' });
    }
  });

  // 4. TELEGRAM WEBHOOK ENDPOINT (0.05s TEZLIKDA JAVOB, KOMPYUTER O'CHSA HAM 24/7 BULUTDA ISHLAYDI)
  app.all(['/api/telegram-webhook', '/api/telegram-webhook/'], async (req: Request, res: Response) => {
    // Har qanday so'rovga darhol 200 OK qaytariladi (Telegram talabi)
    res.status(200).json({ ok: true });
    try {
      if (req.method === 'POST' && req.body && req.body.update_id !== undefined) {
        await cloudTelegramBot.handleWebhookUpdate(req.body, req);
      }
    } catch (err: any) {
      console.error('[Telegram Webhook Error]', err?.message || err);
    }
  });

  // 5. Telegram Webhook-ni o'rnatish
  app.post('/api/telegram/webhook/set', async (req: Request, res: Response) => {
    try {
      let origin = (req.body?.url || `${req.protocol}://${req.get('host')}`).trim();
      // Telegram webhook qat'iy ravishda HTTPS bo'lishi shart!
      if (origin.startsWith('http://') && !origin.includes('localhost')) {
        origin = origin.replace('http://', 'https://');
      }
      const webhookUrl = `${origin.replace(/\/$/, '')}/api/telegram-webhook`;
      const result = await cloudTelegramBot.setWebhook(webhookUrl);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Xatolik' });
    }
  });

  // 6. Telegram Webhook-ni o'chirish (Polling rejimiga qaytish)
  app.post('/api/telegram/webhook/delete', async (req: Request, res: Response) => {
    try {
      const result = await cloudTelegramBot.deleteWebhook();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Xatolik' });
    }
  });

  // 7. Telegram Webhook holatini tekshirish
  app.get('/api/telegram/webhook/info', async (req: Request, res: Response) => {
    try {
      const result = await cloudTelegramBot.getWebhookInfo();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Xatolik' });
    }
  });

  // 24/7 Bulutli Telegram Botini ishga tushirish
  cloudTelegramBot.start().catch((err) => {
    console.error('[CloudBot] Ishga tushirishda xatolik:', err);
  });

  // API lar uchun 404 handler (SPA router bilan aralashib ketmasligi uchun)
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'API endpoint topilmadi' });
  });

  // Dev va Prod rejimlarini moslashtirish
  const distPath = path.join(__dirname, 'dist');
  const distExists = fs.existsSync(distPath);
  const isProduction = process.env.NODE_ENV === 'production' || distExists;

  if (isProduction && distExists) {
    app.use(express.static(distPath));
    app.use((req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`Navo Market Tizimi http://0.0.0.0:${PORT} portida ishga tushdi.`);
    console.log(`24/7 Bulutli Telegram Boti va Firestore sinxronizatsiyasi faol!`);
    console.log(`=======================================================`);
  });

  // To'xtatish signallari (SIGINT, SIGTERM) qabul qilinganda botni toza o'chirish
  const handleShutdown = (signal: string) => {
    console.log(`[Server] ${signal} qabul qilindi. Telegram Bot polling to'xtatilmoqda...`);
    cloudTelegramBot.stop();
    server.close(() => {
      console.log('[Server] Server to\'xtatildi.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

startServer().catch((err) => {
  console.error('Serverni ishga tushirishda jiddiy xato:', err);
  process.exit(1);
});
