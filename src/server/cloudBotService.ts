import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { firebaseConfig } from '../lib/firebaseConfig.ts';
import type { User, Attendance, MarketSettings } from '../types.ts';

import {
  calculateShiftWorkedMinutes,
  getAccurateAttendanceMinutes,
  getTashkentDateString,
  getTashkentTimeString,
  parseTimeParts,
  parseDateParts,
  formatMinutesToHours as formatMinutes,
  calculateLateMinutes,
  haversineDistanceMeters,
} from '../utils/calculations.ts';

// Toshkent vaqti
export function getTashkentNow(): Date {
  return new Date();
}

export { getTashkentDateString, getTashkentTimeString };

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Firebase initsializatsiyasi
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export class CloudTelegramBot {
  private isRunning = false;
  private shouldRun = true;
  private currentOffset = 0;
  private botToken = '';
  private adminIds: string[] = [];
  private notifyTargetIds: string[] = [];
  private shopName = 'Navo Market';
  private webappUrl = process.env.APP_URL || process.env.WEBAPP_URL || 'https://ais-pre-jzx3h6wrsjjnjrsu6xnas6-3620319891.asia-east1.run.app';
  private botUsername: string | null = null;
  private pollAbortController: AbortController | null = null;
  private consecutiveErrors = 0;
  private instanceId = `srv_${process.pid}_${Math.random().toString(36).substring(2, 8)}`;
  private isLeader = false;
  private lastLeaderCheck = 0;
  private isWebhookMode = false;
  private webhookUrl: string | null = null;
  private lastUpdateReceivedAt: string | null = null;
  private updatesProcessedCount = 0;
  private cronInterval: any = null;
  private last6hSlot = '';
  private lastDailyClosingReportDate = '';
  // Xabarlar va Telegram yangilanishlarini 2-3 martadan yuborishni oldini oluvchi keshlar (Deduplication)
  private processedUpdateIds = new Set<number>();
  private recentSentMessageCache = new Map<string, number>();
  private userActionLocks = new Map<string, number>();
  // GPS sozlamalari va lokatsiya kutish holati (Kelish va Ketish uchun)
  private gpsRequired = true;
  private gpsCheckoutRequired = false;
  private marketLatitude = 38.829651;
  private marketLongitude = 65.810833;
  private gpsRadiusMeters = 100;
  private pendingLocationUsers = new Map<string, { chatId: number; isAdm: boolean; isGroup: boolean; timestamp: number }>();
  private pendingCheckoutLocationUsers = new Map<string, { chatId: number; isAdm: boolean; isGroup: boolean; timestamp: number }>();

  constructor() {
    this.listenToSettings();
  }

  public getStatus() {
    return {
      running: this.isRunning,
      isLeader: this.isLeader,
      isWebhookMode: this.isWebhookMode,
      webhookUrl: this.webhookUrl,
      lastUpdateReceivedAt: this.lastUpdateReceivedAt,
      updatesProcessedCount: this.updatesProcessedCount,
      instanceId: this.instanceId,
      botUsername: this.botUsername,
      hasToken: Boolean(this.botToken),
      adminCount: this.adminIds.length,
      notifyTargetCount: this.notifyTargetIds.length,
      notifyTargets: this.notifyTargetIds,
      shopName: this.shopName,
      consecutiveErrors: this.consecutiveErrors,
      timestamp: getTashkentNow().toISOString(),
    };
  }

  // --- TELEGRAM WEBHOOK (YASHIN TEZLIKDA 0.05s JAVOB, KOMPYUTER O'CHIQ BO'LSA HAM 24/7) ---
  public async handleWebhookUpdate(update: any) {
    if (!update) return;
    if (update.update_id) {
      if (this.processedUpdateIds.has(update.update_id)) {
        return; // Dublikat update to'xtatildi
      }
      this.processedUpdateIds.add(update.update_id);
      if (this.processedUpdateIds.size > 2000) {
        const first = this.processedUpdateIds.values().next().value;
        if (first) this.processedUpdateIds.delete(first);
      }
    }
    this.lastUpdateReceivedAt = getTashkentNow().toISOString();
    this.updatesProcessedCount++;
    await this.processUpdate(update);
  }

  public async setWebhook(url: string) {
    if (!this.botToken) return { ok: false, error: "Bot token kiritilmagan" };
    try {
      let finalUrl = url.trim();
      // Telegram webhook qat'iy ravishda HTTPS bo'lishi shart!
      if (finalUrl.startsWith('http://') && !finalUrl.includes('localhost')) {
        finalUrl = finalUrl.replace('http://', 'https://');
      }

      this.isWebhookMode = true;
      this.webhookUrl = finalUrl;
      if (this.pollAbortController) {
        this.pollAbortController.abort();
        this.pollAbortController = null;
      }
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: finalUrl,
          drop_pending_updates: true,
          allowed_updates: ['message', 'callback_query'],
        }),
      });
      const data = await res.json();
      console.log(`[CloudBot Webhook] Webhook o'rnatildi (${finalUrl}):`, data);
      await this.fetchBotInfo();
      return data;
    } catch (err: any) {
      console.error('[CloudBot Webhook] setWebhook xatosi:', err);
      return { ok: false, error: err.message };
    }
  }

  public async deleteWebhook() {
    if (!this.botToken) return { ok: false, error: "Bot token kiritilmagan" };
    try {
      this.isWebhookMode = false;
      this.webhookUrl = null;
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/deleteWebhook?drop_pending_updates=false`);
      const data = await res.json();
      console.log(`[CloudBot Webhook] Webhook tozalandi, Long Polling rejimiga o'tildi:`, data);
      this.restartPolling();
      return data;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async getWebhookInfo() {
    if (!this.botToken) return { ok: false, error: "Bot token kiritilmagan" };
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getWebhookInfo`);
      return await res.json();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // Firestore sozlamalarini jonli tinglash
  private listenToSettings() {
    const settingsDoc = doc(db, 'settings', 'general_settings');
    onSnapshot(
      settingsDoc,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Partial<MarketSettings>;
          const newToken = (data.bot_token || '').trim();
          const newAdmin = (data.admin_telegram_id || '').trim();
          const newGroup = (data.group_telegram_id || '').trim();
          this.shopName = data.shop_name || 'Navo Market';

          // Shaxsiy admin ID lari (faqat musbat sonlar)
          const adminsList = newAdmin
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('-'));

          const adminIdsArray = Array.isArray(data.admin_ids) ? data.admin_ids.map(String) : [];
          const adminsArray = Array.isArray(data.admins) ? data.admins.map((a: any) => String(a.telegram_id || '')) : [];
          const combinedAdminList = [...adminsList, ...adminIdsArray, ...adminsArray]
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('-'));

          // Xabarnoma yuboriladigan barcha ID lar (shaxsiy adminlar + guruhlar)
          const allTargets = [
            ...combinedAdminList,
            ...newGroup.split(/[,;\s]+/),
          ]
            .map((s) => s.trim())
            .filter(Boolean);

          const tokenChanged = newToken !== this.botToken;
          this.botToken = newToken;
          this.adminIds = Array.from(new Set(combinedAdminList));
          this.notifyTargetIds = Array.from(new Set(allTargets));

          // GPS sozlamalarini yangilash
          this.gpsRequired = data.gps_required !== false;
          this.gpsCheckoutRequired = Boolean(data.gps_checkout_required);
          if (typeof data.market_latitude === 'number' && !isNaN(data.market_latitude)) {
            this.marketLatitude = data.market_latitude;
          }
          if (typeof data.market_longitude === 'number' && !isNaN(data.market_longitude)) {
            this.marketLongitude = data.market_longitude;
          }
          if (typeof data.gps_radius_meters === 'number' && !isNaN(data.gps_radius_meters)) {
            this.gpsRadiusMeters = data.gps_radius_meters;
          }

          console.log(`[CloudBot] Sozlamalar yangilandi: Adminlar=${this.adminIds.join(',')}, GPS Kelish=${this.gpsRequired}, GPS Ketish=${this.gpsCheckoutRequired}, Radius=${this.gpsRadiusMeters}m`);

          if (tokenChanged) {
            console.log(`[CloudBot] Telegram bot tokeni yangilandi. Qayta ishga tushirilmoqda...`);
            this.restartPolling();
          }
        }
      },
      (err) => {
        console.error('[CloudBot] Sozlamalarni tinglashda xato:', err);
      }
    );
  }

  public async start() {
    this.shouldRun = true;

    // Webhook holatini tekshirish va noto'g'ri HTTP URL larni to'g'irlash
    try {
      if (this.botToken) {
        const webhookInfo = await this.getWebhookInfo();
        if (webhookInfo.ok && webhookInfo.result?.url) {
          const currentUrl = webhookInfo.result.url;
          if (currentUrl.startsWith('http://') && !currentUrl.includes('localhost')) {
            console.warn(`[CloudBot] Noto'g'ri HTTP webhook aniqlandi (${currentUrl}). HTTPS ga yangilanmoqda...`);
            const httpsUrl = currentUrl.replace('http://', 'https://');
            await this.setWebhook(httpsUrl);
          } else {
            this.isWebhookMode = true;
            this.webhookUrl = currentUrl;
          }
        }
      }
    } catch (e) {
      console.warn('[CloudBot] Webhook holatini tekshirishda ogohlantirish:', e);
    }

    if (!this.isRunning) {
      this.runPollingLoop();
    }
  }

  public stop() {
    this.shouldRun = false;
    this.isRunning = false;
    this.releaseLeadership().catch(() => {});
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  // 100% 409 Conflictni oldini olish: Faqat bitta server bot xabarlarini o'qiydi (Leader Election)
  private async acquireLeadership(): Promise<boolean> {
    try {
      const now = Date.now();
      // Agar allaqachon leader bo'lsak, har 4 soniyada bir marta yangilab turamiz
      if (this.isLeader && now - this.lastLeaderCheck < 4000) {
        return true;
      }

      const leaderDocRef = doc(db, 'settings', 'bot_leader');
      const snapshot = await getDoc(leaderDocRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        const currentLeader = data.leader_id;
        const lastHeartbeat = Number(data.last_heartbeat) || 0;

        // 1. Agar hozirgi leader biz bo'lsak, heartbeat'ni yangilaymiz
        if (currentLeader === this.instanceId) {
          await setDoc(leaderDocRef, { leader_id: this.instanceId, last_heartbeat: now, updated_at: new Date().toISOString() }, { merge: true });
          this.isLeader = true;
          this.lastLeaderCheck = now;
          return true;
        }

        // 2. Agar avvalgi leader 7 soniyadan beri javob bermasa (o'chgan, kompyuter o'chgan yoki qayta ishga tushgan bo'lsa)
        if (now - lastHeartbeat > 7000) {
          console.log(`[CloudBot] Avvalgi server/kompyuter javob bermadi. Bulutli server (${this.instanceId}) asosiy Liderlikni oldi (24/7 rejim)!`);
          await setDoc(leaderDocRef, { leader_id: this.instanceId, last_heartbeat: now, updated_at: new Date().toISOString() }, { merge: true });
          this.isLeader = true;
          this.lastLeaderCheck = now;
          return true;
        }

        // 3. Boshqa server faol ishlab turibdi, ushbu server Standby rejimida turadi
        if (this.isLeader) {
          console.log('[CloudBot] Boshqa server liderlikni oldi, ushbu server Standby rejimiga o\'tdi.');
        }
        this.isLeader = false;
        this.lastLeaderCheck = now;
        return false;
      } else {
        await setDoc(leaderDocRef, { leader_id: this.instanceId, last_heartbeat: now, updated_at: new Date().toISOString() });
        this.isLeader = true;
        this.lastLeaderCheck = now;
        return true;
      }
    } catch {
      return this.isLeader;
    }
  }

  private async releaseLeadership() {
    try {
      if (this.isLeader) {
        const leaderDocRef = doc(db, 'settings', 'bot_leader');
        await setDoc(leaderDocRef, { leader_id: null, last_heartbeat: 0 }, { merge: true });
        this.isLeader = false;
      }
    } catch {}
  }

  private restartPolling() {
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
    this.currentOffset = 0;
    this.consecutiveErrors = 0;
  }

  // Asosiy 24/7 Long Polling tsikli (Tezkor va xatoliklarsiz)
  private async runPollingLoop() {
    this.isRunning = true;
    console.log('[CloudBot] 24/7 Doimiy Polling tsikli ishga tushdi.');

    // 6 soatlik fon monitoringini avtomatik ishga tushiramiz
    this.startSixHourScheduler();

    while (this.shouldRun) {
      // Agar Webhook rejimida bo'lsa, Telegram o'zi push qiladi, polling qilish shart emas!
      if (this.isWebhookMode) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      if (!this.botToken) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      // Leaderlik tekshiruvi (faqat 1 ta bulutli instansiya polling qiladi)
      const isLeader = await this.acquireLeadership();
      if (!isLeader) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      try {
        if (!this.botUsername) {
          await this.clearWebhook();
          await this.fetchBotInfo();
        }

        this.pollAbortController = new AbortController();
        const timeoutSeconds = 4; // 4 soniya - tezkor javob uchun minimal kutish
        const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.currentOffset}&timeout=${timeoutSeconds}&allowed_updates=["message","callback_query"]`;

        const res = await fetch(url, {
          signal: this.pollAbortController.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 409) {
            this.consecutiveErrors++;
            console.warn(`[CloudBot] 409 Conflict: Bot boshqa joyda faol. 2 soniyadan so'ng qayta tekshiriladi...`);
            this.isLeader = false;
            this.lastLeaderCheck = 0;
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`Telegram API HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          this.consecutiveErrors = 0;
          for (const update of data.result) {
            this.currentOffset = update.update_id + 1;
            if (this.processedUpdateIds.has(update.update_id)) {
              continue; // Allaqachon qayta ishlangan
            }
            this.processedUpdateIds.add(update.update_id);
            if (this.processedUpdateIds.size > 2000) {
              const first = this.processedUpdateIds.values().next().value;
              if (first) this.processedUpdateIds.delete(first);
            }
            this.lastUpdateReceivedAt = getTashkentNow().toISOString();
            this.updatesProcessedCount++;
            await this.processUpdate(update);
          }
        } else {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          continue;
        }
        this.consecutiveErrors++;
        console.error(`[CloudBot] Polling xatoligi (${this.consecutiveErrors}):`, err?.message || err);
        const delay = Math.min(this.consecutiveErrors * 1000, 4000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.isRunning = false;
  }

  private async clearWebhook() {
    try {
      if (!this.botToken) return;
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/deleteWebhook?drop_pending_updates=false`);
      const data = await res.json();
      if (data.ok) {
        console.log('[CloudBot] Telegram Webhook tozalandi, getUpdates polling uchun tayyor.');
      }
    } catch (e: any) {
      console.warn('[CloudBot] deleteWebhook ogohlantirishi:', e?.message || e);
    }
  }

  private async fetchBotInfo() {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
      const data = await res.json();
      if (data.ok && data.result?.username) {
        this.botUsername = data.result.username;
        console.log(`[CloudBot] Muvaffaqiyatli ulandi: @${this.botUsername} (24/7 faol!)`);

        // 1. Telegram bot buyruqlarini (Commands) ro'yxatdan o'tkazish
        try {
          const commands = [
            { command: 'start', description: 'Botni ishga tushirish / Yangilash' },
            { command: 'keldim', description: '📍 Ishga kelganlikni belgilash' },
            { command: 'ketdim', description: '🏃‍♂️ Ishdan ketganlikni belgilash' },
            { command: 'tanaffus', description: '☕️ Tanaffusga chiqish' },
            { command: 'qaytdim', description: '▶️ Tanaffusdan qaytish' },
            { command: 'soat', description: '⏱ Mening oylik soatlarim' },
            { command: 'bugun', description: '📅 Bugungi kunlik hisobot' },
            { command: 'kpi', description: '🏆 KPI va soatlar reytingi' },
            { command: 'live', description: '🔴 Hozir ishda kim bor (Admin)' },
            { command: 'hisobot', description: '📊 Oylik umumiy hisobot (Admin)' },
            { command: 'ishchilar', description: '👥 Ishchilar ro\'yxati (Admin)' },
            { command: 'monitoring', description: '📢 6 soatlik monitoring (Admin)' },
            { command: 'eslatma', description: '🔔 Aqlli eslatmalar (Admin)' },
            { command: 'portal', description: '🌐 Veb-portal (Mini App)' },
            { command: 'yordam', description: 'ℹ️ Yordam va yo\'riqnoma' },
          ];

          await fetch(`https://api.telegram.org/bot${this.botToken}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commands }),
          });
          console.log(`[CloudBot] Telegram bot buyruqlari muvaffaqiyatli sozlandi.`);
        } catch (cErr) {
          console.warn('[CloudBot] setMyCommands sozlashda xato:', cErr);
        }

        // 2. Telegram menyusini standart Buyruqlar menyusiga sozlash (Google cookie/login xatolari chiqmasligi uchun)
        try {
          const menuRes = await fetch(
            `https://api.telegram.org/bot${this.botToken}/setChatMenuButton`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                menu_button: {
                  type: 'commands',
                },
              }),
            }
          );
          const menuData = await menuRes.json();
          if (menuData.ok) {
            console.log(`[CloudBot] Telegram Menyusi "Buyruqlar" ga o'tkazildi (Telegram iframe cookie xatosi oldi olindi)!`);
          }
        } catch (mErr) {
          console.warn('[CloudBot] Menu button sozlashda xato:', mErr);
        }
      }
    } catch (e) {
      console.error('[CloudBot] getMe xatosi:', e);
    }
  }

  // Telegramga xabar yuborish (superguruhga o'tish holatini avtomatik hal qiladi, dublikat xabarlardan himoyalangan)
  public async sendMessage(
    chatId: string | number,
    text: string,
    replyMarkup?: any
  ): Promise<{ ok: boolean; newChatId?: string; error?: string }> {
    if (!this.botToken) return { ok: false, error: 'Token mavjud emas' };
    
    // Tugmachasiz oddiy bildirishnoma xabarlarini 12 soniya ichida takroran jo'natishning oldini olish
    if (!replyMarkup) {
      const dedupeKey = `${chatId}_${text.trim()}`;
      const lastSent = this.recentSentMessageCache.get(dedupeKey);
      if (lastSent && Date.now() - lastSent < 12000) {
        return { ok: true };
      }
      this.recentSentMessageCache.set(dedupeKey, Date.now());
      if (this.recentSentMessageCache.size > 2000) {
        const first = this.recentSentMessageCache.keys().next().value;
        if (first) this.recentSentMessageCache.delete(first);
      }
    }

    try {
      const body: any = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      if (replyMarkup) body.reply_markup = replyMarkup;

      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      // Telegram superguruhga o'tish (group chat was upgraded to a supergroup chat)
      if (!data.ok && data.parameters?.migrate_to_chat_id) {
        const newChatId = String(data.parameters.migrate_to_chat_id);
        console.log(`[CloudBot] Guruh superguruhga o'tdi: ${chatId} -> ${newChatId}`);

        // Targetlar ro'yxatini yangilash
        this.notifyTargetIds = this.notifyTargetIds.map((t) =>
          String(t) === String(chatId) ? newChatId : t
        );
        if (!this.notifyTargetIds.includes(newChatId)) {
          this.notifyTargetIds.push(newChatId);
        }

        // Bazadagi sozlamalarda ham guruh ID sini darhol yangilab qo'yamiz
        try {
          await setDoc(
            doc(db, 'settings', 'general_settings'),
            { group_telegram_id: newChatId },
            { merge: true }
          );
          console.log(`[CloudBot] Firestore sozlamalari yangi guruh ID (${newChatId}) bilan yangilandi.`);
        } catch (dbErr) {
          console.error('[CloudBot] Guruh ID bazada yangilanishda xatolik:', dbErr);
        }

        // Yangi superguruh ID siga qayta jo'natamiz
        body.chat_id = newChatId;
        const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const retryData = await retryRes.json();
        return { ok: Boolean(retryData.ok), newChatId, error: retryData.description };
      }

      return { ok: Boolean(data.ok), error: data.description };
    } catch (e: any) {
      console.error(`[CloudBot] sendMessage xatosi (${chatId}):`, e);
      return { ok: false, error: e?.message || 'Tarmoq xatosi' };
    }
  }

  // Admin va guruhlarga bildirishnoma yuborish (Telegram Rate Limitga tushmasdan ketma-ket yuborish)
  private async notifyAdmins(text: string) {
    const rawTargets = this.notifyTargetIds.length > 0 ? this.notifyTargetIds : this.adminIds;
    const uniqueTargets = Array.from(new Set(rawTargets.map((t) => String(t).trim()))).filter(
      (t) => Boolean(t) && t !== '123456789'
    );
    for (const target of uniqueTargets) {
      try {
        await this.sendMessage(target, text);
        // Telegram API 30 msg/sec cheklovidan himoyalanish uchun 50ms kutish
        await new Promise((r) => setTimeout(r, 50));
      } catch (e) {
        console.error(`[CloudBot] Bildirishnoma yuborishda xato (${target}):`, e);
      }
    }
  }

  private isAdmin(tgId: string | number): boolean {
    const idStr = String(tgId).trim();
    return this.adminIds.includes(idStr);
  }

  // Klaviatura
  private getMainKeyboard(isAdminUser: boolean) {
    const keyboard: any[][] = [
      [{ text: '📍 Ishga keldim' }, { text: '🏃‍♂️ Ishdan ketdim' }],
      [{ text: '☕️ Tanaffusga chiqish' }, { text: '▶️ Tanaffusdan qaytish' }],
      [{ text: '⏱ Mening soatlarim' }, { text: '🌐 Veb-portal' }],
    ];

    if (isAdminUser) {
      keyboard.push([{ text: '🔴 Hozir ishda kim bor?' }, { text: '🔔 Eslatmalar' }]);
      keyboard.push([{ text: '🏆 KPI Reyting' }, { text: '📢 6 Soatlik Monitoring' }]);
      keyboard.push([{ text: '📊 Oylik umumiy hisobot' }, { text: '👥 Ishchilar ro\'yxati' }]);
    }

    return {
      keyboard,
      resize_keyboard: true,
      persistent: true,
    };
  }

  // Kelgan yangilanishni (xabarni) qayta ishlash
  private async processUpdate(update: any) {
    // 0. Tugma bosilganda (Callback Query)
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;
      const fromId = String(cb.from.id);
      const isAdmUser = this.isAdmin(fromId);
      if (data === 'send_6h_now' && isAdmUser && cb.message) {
        await this.sendMessage(cb.message.chat.id, "📢 6 soatlik monitoring xabari yuborilmoqda...");
        const sent = await this.sendSixHourSummary();
        await this.sendMessage(cb.message.chat.id, `✅ 6 soatlik monitoring muvaffaqiyatli jo'natildi! (${sent} ta chatga)`);
      }
      return;
    }

    const message = update.message;
    if (!message || !message.from) return;

    const chatId = message.chat.id;
    const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';
    const tgUserId = String(message.from.id);
    const firstName = message.from.first_name || 'Foydalanuvchi';
    const isAdm = this.isAdmin(tgUserId);
    const rawText = (message.text || '').trim();

    // 0. Superguruhga migratsiya bo'lganda (Telegram avtomatik yuboradi)
    if (message.migrate_to_chat_id) {
      const newChatId = String(message.migrate_to_chat_id);
      console.log(`[CloudBot] Guruh superguruhga migratsiya qildi: ${chatId} -> ${newChatId}`);
      this.notifyTargetIds = this.notifyTargetIds.map((t) =>
        String(t) === String(chatId) ? newChatId : t
      );
      if (!this.notifyTargetIds.includes(newChatId)) {
        this.notifyTargetIds.push(newChatId);
      }
      try {
        await setDoc(
          doc(db, 'settings', 'general_settings'),
          { group_telegram_id: newChatId },
          { merge: true }
        );
      } catch (err) {
        console.error('[CloudBot] Migratsiyani saqlashda xatolik:', err);
      }
      return;
    }

    // 1. Kontakt yuborilganda
    if (message.contact) {
      await this.handleContact(message);
      return;
    }

    // 1.1 Geolokatsiya yuborilganda (GPS tasdiqlash)
    if (message.location) {
      await this.handleLocationReceived(message, isAdm, isGroup);
      return;
    }

    // Buyruqni tozalash (masalan: /keldim@NavoMarketBot -> /keldim)
    const cleanCmd = rawText.split('@')[0].trim().toLowerCase();

    // 1.2 Bekor qilish tugmasi
    if (cleanCmd === '❌ bekor qilish' || cleanCmd === 'bekor qilish' || cleanCmd === '/bekor') {
      this.pendingLocationUsers.delete(tgUserId);
      this.pendingCheckoutLocationUsers.delete(tgUserId);
      await this.sendMessage(chatId, "Amal bekor qilindi.", this.getMainKeyboard(isAdm));
      return;
    }

    // 2. Chat/Guruh ID sini bilish buyrug'i (/id, /chatid, /guruh)
    if (cleanCmd === '/id' || cleanCmd === '/chatid' || cleanCmd === '/guruh') {
      const chatType = isGroup ? 'guruh' : 'shaxsiy chat';
      await this.sendMessage(
        chatId,
        `🆔 <b>Ushbu ${chatType} ID raqami:</b> <code>${chatId}</code>\n\n` +
          `<i>Nusxa olish uchun raqam ustiga bosing va tizim sozlamalariga kiriting!</i>`
      );
      return;
    }

    // 3. /start buyrug'i
    if (cleanCmd === '/start') {
      if (isGroup) {
        await this.sendMessage(
          chatId,
          `🏪 <b>${escapeHtml(this.shopName)}</b> davomat boti guruhda faol!\n\n` +
            `Guruhda ishlatiladigan buyruqlar:\n` +
            `📍 <b>/keldim</b> — Ishga kelganingizni qayd etish\n` +
            `🏃‍♂️ <b>/ketdim</b> — Ishdan ketganingizni qayd etish\n` +
            `☕️ <b>/tanaffus</b> — Tanaffusga chiqish\n` +
            `▶️ <b>/qaytdim</b> — Tanaffusdan qaytish\n` +
            `⏱ <b>/soatlarim</b> — Oylik ishlagan soatlaringiz\n` +
            `📅 <b>/bugun</b> — Bugungi davomat ro'yxati\n` +
            `🆔 <b>/id</b> — Ushbu guruh ID raqamini ko'rish\n\n` +
            `<i>Yangi xodimlar tizimda to'liq ro'yxatdan o'tish uchun botga shaxsiy xabar yozing: @${this.botUsername || 'bot'}</i>`
        );
      } else {
        await this.handleStart(chatId, tgUserId, firstName, isAdm);
      }
      return;
    }

    // 4. Davomat buyruqlari (ham shaxsiy botda, ham guruhda ishlaydi)
    if (
      cleanCmd === '📍 ishga keldim' ||
      cleanCmd === 'ishga keldim' ||
      cleanCmd === '/keldim' ||
      cleanCmd === '/in' ||
      cleanCmd === 'keldim' ||
      cleanCmd === 'ishga kelish'
    ) {
      await this.handleCheckIn(chatId, tgUserId, isAdm);
    } else if (
      cleanCmd === '☕️ tanaffusga chiqish' ||
      cleanCmd === '☕ tanaffusga chiqish' ||
      cleanCmd === 'tanaffusga chiqish' ||
      cleanCmd === '/tanaffus' ||
      cleanCmd === '/break' ||
      cleanCmd === 'tanaffus'
    ) {
      await this.handleBreakStart(chatId, tgUserId);
    } else if (
      cleanCmd === '▶️ tanaffusdan qaytish' ||
      cleanCmd === '▶ tanaffusdan qaytish' ||
      cleanCmd === 'tanaffusdan qaytish' ||
      cleanCmd === '/qaytdim' ||
      cleanCmd === '/resume' ||
      cleanCmd === 'qaytdim'
    ) {
      await this.handleBreakEnd(chatId, tgUserId);
    } else if (
      cleanCmd === '🏃‍♂️ ishdan ketdim' ||
      cleanCmd === '🏃 ishdan ketdim' ||
      cleanCmd === 'ishdan ketdim' ||
      cleanCmd === '/ketdim' ||
      cleanCmd === '/out' ||
      cleanCmd === 'ketdim' ||
      cleanCmd === 'ishdan ketish'
    ) {
      await this.handleCheckOut(chatId, tgUserId);
    } else if (
      cleanCmd === '⏱ mening soatlarim' ||
      cleanCmd === 'mening soatlarim' ||
      cleanCmd === 'soatlarim' ||
      cleanCmd === '/soatlarim' ||
      cleanCmd === '/soat' ||
      cleanCmd === '/vaqtim' ||
      cleanCmd === 'soat'
    ) {
      await this.handleMyHours(chatId, tgUserId);
    } else if (
      cleanCmd === '🔴 hozir ishda kim bor?' ||
      cleanCmd === 'hozir ishda kim bor?' ||
      cleanCmd === 'hozir ishda kim bor' ||
      cleanCmd === '/live' ||
      cleanCmd === 'live'
    ) {
      if (isAdm) {
        await this.handleAdminLive(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Ushbu ma'lumot faqat do'kon ma'muri (Admin) uchun ochiq. O'zingizning ishlagan vaqtingizni ko'rish uchun <b>'⏱ Mening soatlarim'</b> tugmasini bosing.`
        );
      }
    } else if (
      cleanCmd === '🏆 kpi reyting' ||
      cleanCmd === 'kpi reyting' ||
      cleanCmd === '/kpi' ||
      cleanCmd === '/reyting' ||
      cleanCmd === 'kpi' ||
      cleanCmd === 'reyting'
    ) {
      await this.handleKpiRatingCommand(chatId);
    } else if (
      cleanCmd === '📊 oylik umumiy hisobot' ||
      cleanCmd === 'oylik umumiy hisobot' ||
      cleanCmd === '/hisobot' ||
      cleanCmd === 'hisobot'
    ) {
      if (isAdm) {
        await this.handleAdminReport(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Oylik umumiy hisobot faqat do'kon ma'muri (Admin) uchun ochiq. Shaxsiy soatlaringizni <b>'⏱ Mening soatlarim'</b> orqali bilib olasiz.`
        );
      }
    } else if (
      cleanCmd === '👥 ishchilar ro\'yxati' ||
      cleanCmd === '👥 ishchilar royxati' ||
      cleanCmd === 'ishchilar ro\'yxati' ||
      cleanCmd === 'ishchilar royxati' ||
      cleanCmd === 'ishchilar ro‘yxati' ||
      cleanCmd === '/ishchilar' ||
      cleanCmd === 'ishchilar'
    ) {
      if (isAdm) {
        await this.handleAdminWorkers(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Ishchilar ro'yxati faqat do'kon ma'muri uchun ochiq.`
        );
      }
    } else if (cleanCmd === '/bugun' || cleanCmd === 'bugun') {
      await this.handleTodaySummary(chatId, tgUserId, isAdm);
    } else if (
      cleanCmd === '/app' ||
      cleanCmd === '/webapp' ||
      cleanCmd === '/portal' ||
      cleanCmd === '🌐 veb-portal' ||
      cleanCmd === 'veb-portal' ||
      cleanCmd === 'veb portal' ||
      cleanCmd === 'portal'
    ) {
      await this.handleAppCommand(chatId);
    } else if (
      cleanCmd === '📢 6 soatlik monitoring' ||
      cleanCmd === '6 soatlik monitoring' ||
      cleanCmd === '/send6h' ||
      cleanCmd === '/monitoring' ||
      cleanCmd === '/xulosa6h' ||
      cleanCmd === 'monitoring'
    ) {
      if (isAdm) {
        await this.handleSend6hCommand(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ 6 soatlik monitoring xulosasini faqat Admin yuborishi mumkin.`
        );
      }
    } else if (
      cleanCmd === '🔔 eslatmalar' ||
      cleanCmd === 'eslatmalar' ||
      cleanCmd === '/eslatma' ||
      cleanCmd === '/eslatmalar'
    ) {
      if (isAdm) {
        await this.handleAdminRemindersCommand(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Eslatmalar menyusi faqat do'kon ma'muri uchun ochiq.`
        );
      }
    } else if (
      cleanCmd === '🏁 kunlik hisobot' ||
      cleanCmd === 'kunlik hisobot' ||
      cleanCmd === '/kunyakun' ||
      cleanCmd === '/bugunyakun' ||
      cleanCmd === '/yopilish'
    ) {
      if (isAdm) {
        await this.handleDailyClosingReportCommand(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Kunlik yakuniy hisobot faqat do'kon ma'muri uchun ochiq.`
        );
      }
    } else if (cleanCmd === '/help' || cleanCmd === '/yordam' || cleanCmd === 'yordam') {
      await this.handleHelp(chatId, isAdm);
    } else if (!isGroup) {
      // Shaxsiy chatda noma'lum matn yozilsa, foydalanuvchiga yordam berish
      await this.sendMessage(
        chatId,
        `Kechirasiz, ushbu buyruqni tushunmadim.\n\n` +
          `Iltimos, pastdagi klaviatura tugmalaridan foydalaning yoki <b>/help</b> buyrug'ini bosing.`,
        this.getMainKeyboard(isAdm)
      );
    }
  }

  // --- /start ---
  private async handleStart(chatId: number, tgUserId: string, firstName: string, isAdm: boolean) {
    // Foydalanuvchini Firestore dan qidirish
    const user = await this.findUserByTelegramId(tgUserId);

    if (isAdm) {
      await this.sendMessage(
        chatId,
        `Assalomu alaykum, Hurmatli Admin!\n\n` +
          `🏪 <b>${escapeHtml(this.shopName)}</b> davomat botiga xush kelibsiz.\n` +
          `Bot Google Cloud serverida <b>24/7 uzluksiz</b> ishlab turibdi.\n` +
          `Barcha ma'lumotlar avtomatik tarzda xavfsiz Firestore bulutli bazasiga yoziladi.`,
        this.getMainKeyboard(true)
      );
      return;
    }

    if (!user) {
      const contactKeyboard = {
        keyboard: [
          [{ text: '📱 Telefon raqamni yuborish', request_contact: true }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      };
      await this.sendMessage(
        chatId,
        `Assalomu alaykum, <b>${escapeHtml(firstName)}</b>!\n\n` +
          `<b>${escapeHtml(this.shopName)}</b> xodimlari ish vaqti hisobi botiga xush kelibsiz.\n` +
          `Tizimda hisobingizni faollashtirish uchun quyidagi <b>'📱 Telefon raqamni yuborish'</b> tugmasini bosing:`,
        contactKeyboard
      );
    } else {
      await this.sendMessage(
        chatId,
        `Assalomu alaykum, <b>${escapeHtml(user.full_name)}</b>!\n\n` +
          `Siz tizimda ro'yxatdan o'tgansiz.\n` +
          `Kelganingizda <b>'📍 Ishga keldim'</b>, ketayotganingizda <b>'🏃‍♂️ Ishdan ketdim'</b> tugmasini bosing.`,
        this.getMainKeyboard(false)
      );
    }
  }

  // --- Kontaktni qabul qilish ---
  private async handleContact(message: any) {
    const tgUserId = String(message.from.id);
    const contact = message.contact;
    const rawPhone = contact.phone_number || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const standardPhone = cleanPhone.startsWith('998')
      ? cleanPhone
      : cleanPhone.length === 9
      ? '998' + cleanPhone
      : cleanPhone;

    const fName = (message.from.first_name || '').trim();
    const lName = (message.from.last_name || '').trim();
    const fullName = `${fName} ${lName}`.trim() || 'Xodim';

    // Firestore da qidirish yoki yangi xodim qo'shish
    const usersRef = collection(db, 'users');
    const qPhone = query(usersRef, where('phone', '==', `+${standardPhone}`));
    const snap = await getDocs(qPhone);

    let finalUserId: number;
    let finalUser: User;

    if (!snap.empty) {
      const docSnap = snap.docs[0];
      const existing = docSnap.data() as User;
      finalUserId = existing.id;
      finalUser = {
        ...existing,
        telegram_id: tgUserId,
        phone: `+${standardPhone}`,
      };
      await setDoc(doc(db, 'users', String(finalUserId)), finalUser, { merge: true });
    } else {
      finalUserId = Date.now();
      finalUser = {
        id: finalUserId,
        full_name: fullName,
        phone: `+${standardPhone}`,
        telegram_id: tgUserId,
        role: 'worker',
        position: 'Xodim',
        work_start_time: '08:00',
        work_end_time: '20:00',
        is_active: true,
        created_at: getTashkentNow().toISOString(),
      };
      await setDoc(doc(db, 'users', String(finalUserId)), finalUser);
    }

    const isAdm = this.isAdmin(tgUserId);
    await this.sendMessage(
      message.chat.id,
      `✅ <b>Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>\n\n` +
        `👤 Xodim: <b>${escapeHtml(finalUser.full_name)}</b>\n` +
        `📱 Telefon: <b>${finalUser.phone}</b>\n\n` +
        `Endi bemalol ish vaqtingizni belgilashingiz mumkin:`,
      this.getMainKeyboard(isAdm)
    );

    await this.notifyAdmins(
      `👤 <b>Yangi xodim Telegram orqali ulandi:</b>\n` +
        `Ism: <b>${escapeHtml(finalUser.full_name)}</b>\n` +
        `Tel: ${finalUser.phone}`
    );
  }

  // --- 📍 Ishga keldim ---
  private async handleCheckIn(
    chatId: number,
    tgUserId: string,
    isAdm: boolean,
    coords?: { lat: number; lon: number; dist: number }
  ) {
    const lastAction = this.userActionLocks.get(tgUserId);
    if (lastAction && Date.now() - lastAction < 3000) {
      return; // Tez-tez qayta bosishni to'xtatish
    }
    this.userActionLocks.set(tgUserId, Date.now());

    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(
        chatId,
        `Iltimos, avval /start buyrug'ini bosing va telefon raqamingizni yuborib ro'yxatdan o'ting.`
      );
      return;
    }

    const now = getTashkentNow();
    const todayStr = getTashkentDateString(now);
    const timeStr = getTashkentTimeString(now, true);

    // Ochiq smenani qidirish
    const activeShift = await this.findActiveShift(user.id);

    if (activeShift) {
      if (activeShift.status === 'on_break') {
        await this.sendMessage(
          chatId,
          `☕️ Siz hozir tanaffusdasiz (boshlangan vaqti: <b>${activeShift.check_in_time.slice(0, 5)}</b>).\n\n` +
            `Ishni davom ettirish uchun iltimos <b>'▶️ Tanaffusdan qaytish'</b> tugmasini bosing.`,
          this.getMainKeyboard(isAdm)
        );
        return;
      }

      // Agar avvalgi smena juda uzoq (16+ soat yoki eski kungi) bo'lsa, xavfsiz yopamiz
      const isOldDay = activeShift.date < todayStr;
      if (isOldDay) {
        const endTime = user.work_end_time || '20:00';
        const calcMinutes = calculateShiftWorkedMinutes(
          activeShift.date,
          activeShift.check_in_time,
          activeShift.date,
          endTime,
          activeShift.total_break_minutes || 0
        );
        const resolvedMinutes = calcMinutes > 0 && calcMinutes <= 840 ? calcMinutes : 600;

        await setDoc(
          doc(db, 'attendance', String(activeShift.id)),
          {
            status: 'completed',
            check_out_date: activeShift.date,
            check_out_time: `${endTime}:00`,
            worked_minutes: resolvedMinutes,
            note: 'Avvalgi kungi unutilgan smena ish rejasi bo\'yicha avtomatik yopildi',
          },
          { merge: true }
        );
        await this.sendMessage(
          chatId,
          `⚠️ <i>Eslatma: Avvalgi smenangizda ketish belgilanmagan ekan. Eski smena ish rejasi (${endTime}) bo'yicha xavfsiz yopildi va yangisi ochildi.</i>`
        );
      } else {
        await this.sendMessage(
          chatId,
          `⚠️ Siz allaqachon ishdasiz!\n` +
            `Kelgan vaqtingiz: <b>${activeShift.check_in_time.slice(0, 5)}</b>\n\n` +
            `Ish yakunlanganda <b>'🏃‍♂️ Ishdan ketdim'</b> tugmasini bosing.`,
          this.getMainKeyboard(isAdm)
        );
        return;
      }
    }

    const isGroup = chatId < 0;

    // AGAR GPS MAJBURIY BO'LSA VA LOKATSIYA HALI TASDIQLANMAGAN BO'LSA:
    if (this.gpsRequired && !coords) {
      this.pendingLocationUsers.set(tgUserId, {
        chatId,
        isAdm,
        isGroup,
        timestamp: Date.now(),
      });

      if (!isGroup) {
        await this.sendMessage(
          chatId,
          `📍 <b>Do'konda ekanligingizni tasdiqlash uchun geolokatsiyangizni yuboring!</b>\n\n` +
            `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
            `📏 Ruxsat etilgan masofa: <b>${this.gpsRadiusMeters} metr</b>\n\n` +
            `👇 Pastdagi <b>«📍 Do'kondan lokatsiya yuborish»</b> tugmasini bosing:`,
          {
            keyboard: [
              [{ text: "📍 Do'kondan lokatsiya yuborish", request_location: true }],
              [{ text: "❌ Bekor qilish" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        );
      } else {
        await this.sendMessage(
          chatId,
          `📍 <b>${escapeHtml(user.full_name)}, do'konda ekanligingizni tasdiqlash uchun geolokatsiya kerak!</b>\n\n` +
            `🏢 Ruxsat etilgan masofa: <b>${this.gpsRadiusMeters} metr</b>.\n` +
            `Iltimos, guruhga Telegram orqali <b>📎 Joylashuv (Location)</b> yuboring yoki shaxsiy botga kirib yuboring: @${this.botUsername || 'bot'}`
        );
      }
      return;
    }

    // Bugungi yakunlangan smenalar sonini bilish
    const completedToday = await this.countCompletedShiftsToday(user.id, todayStr);
    const shiftNum = completedToday + 1;

    // Yangi smena yaratish
    const newAttId = Date.now();
    const locNote = coords
      ? `GPS tasdiqlandi (${coords.dist}m)`
      : this.gpsRequired
      ? 'GPS orqali'
      : 'Bot orqali';

    const newAttendance: Attendance = {
      id: newAttId,
      user_id: user.id,
      date: todayStr,
      check_in_time: timeStr,
      total_break_minutes: 0,
      worked_minutes: 0,
      status: 'working',
      created_at: now.toISOString(),
      note: locNote,
    };

    await setDoc(doc(db, 'attendance', String(newAttId)), newAttendance);

    const isFirstShift = completedToday === 0;
    const shiftText = completedToday > 0 ? ` (${shiftNum}-smena)` : '';
    let lateNote = '';
    if (isFirstShift) {
      const lateMins = calculateLateMinutes(timeStr, user.work_start_time || '08:00');
      if (lateMins > 0) {
        lateNote = `\n⚠️ Rejadan kechikish: <b>${lateMins} daqiqa</b> (Reja: ${user.work_start_time || '08:00'})`;
      } else {
        lateNote = `\n✅ O'z vaqtida keldi (Reja: ${user.work_start_time || '08:00'})`;
      }
    } else {
      lateNote = `\n🔄 <b>${shiftNum}-smena</b> (Qaytadan kirish — kechikish hisoblanmaydi)`;
    }

    const locTextForUser = coords
      ? `\n📍 Lokatsiya: <b>Do'konda (GPS tasdiqlandi: ${coords.dist}m)</b>`
      : '';

    await this.sendMessage(
      chatId,
      `✅ <b>Ishga kelganingiz qayd etildi!${shiftText}</b>\n\n` +
        `👤 Xodim: <b>${escapeHtml(user.full_name)}</b>\n` +
        `🕒 Kelgan vaqt: <b>${timeStr.slice(0, 5)}</b> (${todayStr})` +
        locTextForUser +
        `${lateNote}\n\n` +
        `Kuningiz barakali va sermahsul o'tsin!`,
      this.getMainKeyboard(isAdm)
    );

    const adminLocLine = coords
      ? `📍 Masofa: <b>Do'konda (${coords.dist} metr)</b>\n`
      : '';

    await this.notifyAdmins(
      `🟢 <b>Ishga keldi:</b> ${escapeHtml(user.full_name)}\n` +
        `🕒 Vaqt: <b>${timeStr.slice(0, 5)}</b> (${todayStr})\n` +
        adminLocLine +
        `Smena: <b>${shiftNum}</b>${isFirstShift ? '' : ' (Qaytadan kirish — kechikish yo\'q)'}`
    );
  }

  // --- 📍 Geolokatsiya xabari kelganda ---
  private async handleLocationReceived(message: any, isAdm: boolean, isGroup: boolean) {
    const tgUserId = String(message.from.id);
    const chatId = message.chat.id;
    const { latitude, longitude } = message.location;

    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(
        chatId,
        `Iltimos, avval /start buyrug'ini bosing va telefon raqamingizni yuborib ro'yxatdan o'ting.`
      );
      return;
    }

    // Masofani o'lchash
    const dist = haversineDistanceMeters(
      latitude,
      longitude,
      this.marketLatitude,
      this.marketLongitude
    );
    const roundedDist = Math.round(dist);

    const isCheckoutPending = this.pendingCheckoutLocationUsers.has(tgUserId);

    if (isCheckoutPending) {
      if (this.gpsCheckoutRequired && roundedDist > this.gpsRadiusMeters) {
        await this.sendMessage(
          chatId,
          `❌ <b>Siz do'kondan juda uzoqdasiz (${roundedDist} metr)!</b>\n\n` +
            `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
            `📏 Ruxsat etilgan radius: <b>${this.gpsRadiusMeters} metr</b>.\n\n` +
            `Ishdan ketishni qayd etish uchun do'konda ekanligingizni tasdiqlashingiz kerak. Iltimos, do'kondan chiqishdan oldin lokatsiya yuboring.` +
            (isAdm
              ? `\n\n<i>🛡 Boshqaruvchi uchun: Agar masofani kengaytirmoqchi bo'lsangiz, tizim Sozlamalarida GPS radiusini o'zgartirishingiz mumkin.</i>`
              : ''),
          this.getMainKeyboard(isAdm)
        );
        this.pendingCheckoutLocationUsers.delete(tgUserId);
        return;
      }

      this.pendingCheckoutLocationUsers.delete(tgUserId);
      await this.handleCheckOut(chatId, tgUserId, {
        lat: latitude,
        lon: longitude,
        dist: roundedDist,
      });
      return;
    }

    if (this.gpsRequired && roundedDist > this.gpsRadiusMeters) {
      await this.sendMessage(
        chatId,
        `❌ <b>Siz do'kondan juda uzoqdasiz (${roundedDist} metr)!</b>\n\n` +
          `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
          `📏 Ruxsat etilgan radius: <b>${this.gpsRadiusMeters} metr</b>.\n\n` +
          `Iltimos, haqiqatan ham do'konga yetib borgach qaytadan lokatsiya yuboring.` +
          (isAdm
            ? `\n\n<i>🛡 Boshqaruvchi uchun: Agar masofani kengaytirmoqchi bo'lsangiz, tizim Sozlamalarida GPS radiusini o'zgartirishingiz mumkin.</i>`
            : ''),
        this.getMainKeyboard(isAdm)
      );
      this.pendingLocationUsers.delete(tgUserId);
      return;
    }

    // Radius ichida bo'lsa -> Ishga kelishni tasdiqlash
    this.pendingLocationUsers.delete(tgUserId);
    await this.handleCheckIn(chatId, tgUserId, isAdm, {
      lat: latitude,
      lon: longitude,
      dist: roundedDist,
    });
  }

  // --- ☕️ Tanaffusga chiqish ---
  private async handleBreakStart(chatId: number, tgUserId: string) {
    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(
        chatId,
        `⚠️ <b>Siz hali tizimda ro'yxatdan o'tmagansiz!</b>\n\n` +
          `Iltimos, avval <b>/start</b> buyrug'ini bosing va telefon raqamingizni yuborib ro'yxatdan o'ting.`
      );
      return;
    }

    const activeShift = await this.findActiveShift(user.id);
    if (!activeShift) {
      await this.sendMessage(chatId, `⚠️ Siz hali ish boshlamagansiz. Avval '📍 Ishga keldim' tugmasini bosing.`);
      return;
    }

    if (activeShift.status === 'on_break') {
      await this.sendMessage(chatId, `☕️ Siz allaqachon tanaffusdasiz. Qaytganingizda '▶️ Tanaffusdan qaytish' tugmasini bosing.`);
      return;
    }

    const now = getTashkentNow();
    const timeStr = getTashkentTimeString(now, false);

    await setDoc(
      doc(db, 'attendance', String(activeShift.id)),
      {
        status: 'on_break',
        note: `Tanaffus: ${Date.now()}`,
      },
      { merge: true }
    );

    await this.sendMessage(
      chatId,
      `☕️ <b>Tanaffus boshlandi!</b>\n` +
        `Vaqt: <b>${timeStr}</b>\n\n` +
        `Dam olib qaytganingizda <b>'▶️ Tanaffusdan qaytish'</b> tugmasini bosing.`
    );

    await this.notifyAdmins(
      `☕️ <b>Tanaffusga chiqdi:</b> ${escapeHtml(user.full_name)}\n` +
        `🕒 Vaqt: <b>${timeStr}</b>`
    );
  }

  // --- ▶️ Tanaffusdan qaytish ---
  private async handleBreakEnd(chatId: number, tgUserId: string) {
    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(
        chatId,
        `⚠️ <b>Siz hali tizimda ro'yxatdan o'tmagansiz!</b>\n\n` +
          `Iltimos, avval <b>/start</b> buyrug'ini bosing va telefon raqamingizni yuborib ro'yxatdan o'ting.`
      );
      return;
    }

    const activeShift = await this.findActiveShift(user.id);
    if (!activeShift || activeShift.status !== 'on_break') {
      await this.sendMessage(chatId, `⚠️ Siz hozir tanaffusda emassiz.`);
      return;
    }

    const now = getTashkentNow();
    const timeStr = getTashkentTimeString(now, false);

    let breakMinutes = 15;
    if (activeShift.note && activeShift.note.startsWith('Tanaffus: ')) {
      try {
        const rawNote = activeShift.note.replace('Tanaffus: ', '').trim();
        const startMs = /^\d+$/.test(rawNote) ? parseInt(rawNote, 10) : new Date(rawNote).getTime();
        const diffMs = Date.now() - startMs;
        breakMinutes = Math.max(1, Math.round(diffMs / 60000));
        if (breakMinutes > 240) breakMinutes = 180; // 4 soatdan oshib ketganda max 3 soat deb qat'iy cheklanadi
      } catch {
        breakMinutes = 15;
      }
    }

    const newTotalBreak = (activeShift.total_break_minutes || 0) + breakMinutes;

    await setDoc(
      doc(db, 'attendance', String(activeShift.id)),
      {
        status: 'working',
        total_break_minutes: newTotalBreak,
        note: null,
      },
      { merge: true }
    );

    await this.sendMessage(
      chatId,
      `▶️ <b>Tanaffus yakunlandi!</b>\n` +
        `Vaqt: <b>${timeStr}</b> (Davomiyligi: <b>${formatMinutes(breakMinutes)}</b>)\n\n` +
        `Ish davom etmoqda. Omad!`
    );

    await this.notifyAdmins(
      `▶️ <b>Tanaffusdan qaytdi:</b> ${escapeHtml(user.full_name)}\n` +
        `🕒 Vaqt: <b>${timeStr}</b> (Tanaffus: ${formatMinutes(breakMinutes)})`
    );
  }

  // --- 🏃‍♂️ Ishdan ketdim ---
  private async handleCheckOut(
    chatId: number,
    tgUserId: string,
    coords?: { lat: number; lon: number; dist: number }
  ) {
    const lastAction = this.userActionLocks.get(tgUserId);
    if (lastAction && Date.now() - lastAction < 3000) {
      return; // Tez-tez qayta bosishni to'xtatish
    }
    this.userActionLocks.set(tgUserId, Date.now());

    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(
        chatId,
        `⚠️ <b>Siz hali tizimda ro'yxatdan o'tmagansiz!</b>\n\n` +
          `Iltimos, avval <b>/start</b> buyrug'ini bosing va telefon raqamingizni yuborib ro'yxatdan o'ting.`
      );
      return;
    }

    const activeShift = await this.findActiveShift(user.id);
    if (!activeShift) {
      await this.sendMessage(
        chatId,
        `⚠️ Siz hali ish boshlamagansiz. Avval '📍 Ishga keldim' tugmasini bosing.`
      );
      return;
    }

    const isGroup = chatId < 0;

    // AGAR KETISHDA GPS MAJBURIY BO'LSA VA LOKATSIYA HALI TASDIQLANMAGAN BO'LSA:
    if (this.gpsCheckoutRequired && !coords) {
      this.pendingCheckoutLocationUsers.set(tgUserId, {
        chatId,
        isAdm: this.isAdmin(tgUserId),
        isGroup,
        timestamp: Date.now(),
      });

      if (!isGroup) {
        await this.sendMessage(
          chatId,
          `📍 <b>Ishdan ketayotganingizni tasdiqlash uchun geolokatsiyangizni yuboring!</b>\n\n` +
            `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
            `📏 Ruxsat etilgan masofa: <b>${this.gpsRadiusMeters} metr</b>\n\n` +
            `👇 Pastdagi <b>«📍 Do'kondan lokatsiya yuborish (Ketish)»</b> tugmasini bosing:`,
          {
            keyboard: [
              [{ text: "📍 Do'kondan lokatsiya yuborish (Ketish)", request_location: true }],
              [{ text: "❌ Bekor qilish" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        );
      } else {
        await this.sendMessage(
          chatId,
          `📍 <b>${escapeHtml(user.full_name)}, ketishni qayd etish uchun geolokatsiya kerak!</b>\n\n` +
            `🏢 Ruxsat etilgan masofa: <b>${this.gpsRadiusMeters} metr</b>.\n` +
            `Iltimos, Telegram orqali <b>📎 Joylashuv (Location)</b> yuboring yoki shaxsiy botga kirib yuboring: @${this.botUsername || 'bot'}`
        );
      }
      return;
    }

    const now = getTashkentNow();
    const todayStr = getTashkentDateString(now);
    const timeStr = getTashkentTimeString(now, true);

    // Tanaffusda bo'lsa, uni ham qo'shib yopamiz
    let totalBreak = activeShift.total_break_minutes || 0;
    if (activeShift.status === 'on_break' && activeShift.note?.startsWith('Tanaffus: ')) {
      try {
        const rawNote = activeShift.note.replace('Tanaffus: ', '').trim();
        const startMs = /^\d+$/.test(rawNote) ? parseInt(rawNote, 10) : new Date(rawNote).getTime();
        const extraBreak = Math.max(1, Math.round((Date.now() - startMs) / 60000));
        totalBreak += Math.min(extraBreak, 180);
      } catch {}
    }

    // Ishlangan vaqtni mutlaq aniqlikda hisoblash
    const workedMinutes = calculateShiftWorkedMinutes(
      activeShift.date,
      activeShift.check_in_time,
      todayStr,
      timeStr,
      totalBreak
    );

    const locNote = coords
      ? `Ketishda GPS tasdiqlandi (${coords.dist}m)`
      : this.gpsCheckoutRequired
      ? 'Ketish: GPS orqali'
      : null;

    await setDoc(
      doc(db, 'attendance', String(activeShift.id)),
      {
        status: 'completed',
        check_out_date: todayStr,
        check_out_time: timeStr,
        worked_minutes: workedMinutes,
        total_break_minutes: totalBreak,
        note: locNote,
      },
      { merge: true }
    );

    // Bugungi jami daqiqalar (bazadan haqqoniy hisoblanadi)
    const todayTotalMinutes = await this.getTodayTotalMinutes(user.id, todayStr);
    const formattedWorked = formatMinutes(workedMinutes);
    const formattedTodayTotal = formatMinutes(todayTotalMinutes);

    const breakText = totalBreak > 0 ? ` (☕️ Tanaffus: ${formatMinutes(totalBreak)})` : '';
    const locTextForUser = coords
      ? `\n📍 Lokatsiya: <b>Do'konda (GPS tasdiqlandi: ${coords.dist}m)</b>`
      : '';

    await this.sendMessage(
      chatId,
      `🏁 <b>Ishdan ketganingiz qayd etildi!</b>\n\n` +
        `👤 Xodim: <b>${escapeHtml(user.full_name)}</b>\n` +
        `🟢 Kelgan: <b>${activeShift.check_in_time.slice(0, 5)}</b> | 🔴 Ketgan: <b>${timeStr.slice(0, 5)}</b>\n` +
        `⏱ Ushbu smenada: <b>${formattedWorked}</b>${breakText}` +
        locTextForUser +
        `\n\n` +
        `📊 <b>Bugun jami ishlangan:</b> <b>${formattedTodayTotal}</b>\n\n` +
        `💡 <i>Agar bugun yana qaytib kelsangiz, istalgan vaqt '📍 Ishga keldim'ni bosishingiz mumkin!</i>`
    );

    const adminLocLine = coords
      ? `📍 Ketish masofasi: <b>Do'konda (${coords.dist} metr)</b>\n`
      : '';

    await this.notifyAdmins(
      `🔴 <b>Ishdan ketdi:</b> ${escapeHtml(user.full_name)}\n` +
        `⏱ Smena: <b>${formattedWorked}</b>${breakText}\n` +
        adminLocLine +
        `📊 Bugungi jami: <b>${formattedTodayTotal}</b>`
    );

    // BARCHA ISHCHILAR ISHINI TUGATGANLIGINI TEKSHIRISH:
    // Faqat barcha ishchilar ishni to'liq yakunlagandan keyingina avtomat kunlik yakuniy hisobot jo'natiladi!
    await this.checkAndTriggerDailyClosingReportIfAllFinished(todayStr);
  }

  // --- ⏱ Mening soatlarim ---
  private async handleMyHours(chatId: number, tgUserId: string) {
    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(chatId, `Iltimos, avval /start bosing.`);
      return;
    }

    const now = getTashkentNow();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const attRef = collection(db, 'attendance');
    const q = query(
      attRef,
      where('user_id', '==', user.id),
      where('status', '==', 'completed')
    );
    const snap = await getDocs(q);

    const monthlyShifts: Attendance[] = [];
    snap.forEach((d) => {
      const att = d.data() as Attendance;
      if (att.date.startsWith(currentMonthPrefix)) {
        monthlyShifts.push(att);
      }
    });

    monthlyShifts.sort((a, b) => b.id - a.id);

    const totalMinutes = monthlyShifts.reduce((sum, s) => sum + getAccurateAttendanceMinutes(s), 0);
    const uniqueDays = new Set(monthlyShifts.map((s) => s.date)).size;

    const active = await this.findActiveShift(user.id);
    let statusLine = '';
    if (active) {
      statusLine =
        active.status === 'working'
          ? `\n<i>🟢 Hozir ishdasiz (Kelgan vaqtingiz: ${active.check_in_time.slice(0, 5)})</i>\n`
          : `\n<i>☕️ Hozir tanaffusdasiz</i>\n`;
    }

    let text =
      `📊 <b>${escapeHtml(user.full_name)} ning oylik hisoboti (${now.getMonth() + 1}.${now.getFullYear()}):</b>\n\n` +
      `📅 Kelgan kunlar: <b>${uniqueDays} kun</b> (${monthlyShifts.length} ta smena)\n` +
      `⏱ <b>JAMI ISHLANGAN VAQT:</b> <b>${formatMinutes(totalMinutes)}</b> (${(totalMinutes / 60).toFixed(1)} soat)\n` +
      statusLine;

    if (monthlyShifts.length > 0) {
      text += `\nSo'nggi keldi-ketdilar:\n`;
      for (const s of monthlyShifts.slice(0, 5)) {
        const outT = s.check_out_time ? s.check_out_time.slice(0, 5) : '--:--';
        text += `• ${s.date.slice(5)}: ${s.check_in_time.slice(0, 5)} ➡️ ${outT} (${formatMinutes(getAccurateAttendanceMinutes(s))})\n`;
      }
    }

    await this.sendMessage(chatId, text);
  }

  // --- Admin: Hozir ishda kim bor? ---
  private async handleAdminLive(chatId: number) {
    const attRef = collection(db, 'attendance');
    const q = query(attRef, where('status', 'in', ['working', 'on_break']));
    const snap = await getDocs(q);

    if (snap.empty) {
      await this.sendMessage(chatId, `Hozirda do'konda ishlayotgan xodimlar yo'q (hamma ketgan).`);
      return;
    }

    const usersSnap = await getDocs(collection(db, 'users'));
    const userMap = new Map<number, string>();
    usersSnap.forEach((d) => {
      const u = d.data() as User;
      userMap.set(u.id, u.full_name);
    });

    const now = getTashkentNow();
    let text =
      `🔴 <b>HOZIR ISHDA BO'LGANLAR (${snap.size} kishi):</b>\n` +
      `🕒 Vaqt: <b>${getTashkentTimeString(now, false)}</b> (${getTashkentDateString(now)})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n`;

    let idx = 1;
    snap.forEach((d) => {
      const att = d.data() as Attendance;
      const workerName = userMap.get(att.user_id) || `Xodim #${att.user_id}`;
      const statusBadge = att.status === 'working' ? '🟢 Ishlamoqda' : '☕️ Tanaffusda';
      text += `${idx}. <b>${escapeHtml(workerName)}</b> — ${statusBadge}\n`;
      text += `   Keldi: ${att.check_in_time.slice(0, 5)} (${att.date})\n\n`;
      idx++;
    });

    await this.sendMessage(chatId, text);
  }

  // --- Admin: Oylik hisobot ---
  private async handleAdminReport(chatId: number) {
    const now = getTashkentNow();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const usersSnap = await getDocs(collection(db, 'users'));
    const workers: User[] = [];
    usersSnap.forEach((d) => {
      const u = d.data() as User;
      if (u.role === 'worker') workers.push(u);
    });

    const attSnap = await getDocs(
      query(collection(db, 'attendance'), where('status', '==', 'completed'))
    );

    const shiftsByUser = new Map<number, Attendance[]>();
    attSnap.forEach((d) => {
      const a = d.data() as Attendance;
      if (a.date.startsWith(currentMonthPrefix)) {
        const list = shiftsByUser.get(a.user_id) || [];
        list.push(a);
        shiftsByUser.set(a.user_id, list);
      }
    });

    let totalStoreMinutes = 0;
    let text =
      `📋 <b>${escapeHtml(this.shopName)} XODIMLARINING OYLIK HISOBOTI</b>\n` +
      `🗓 Oy: <b>${now.getMonth() + 1}.${now.getFullYear()}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const w of workers) {
      const shifts = shiftsByUser.get(w.id) || [];
      const days = new Set(shifts.map((s) => s.date)).size;
      const totalM = shifts.reduce((acc, s) => acc + (s.worked_minutes || 0), 0);
      totalStoreMinutes += totalM;

      text += `👤 <b>${escapeHtml(w.full_name)}</b>\n`;
      text += `   • Ishlagan kunlari: <b>${days} kun</b> (${shifts.length} ta smena)\n`;
      text += `   • Jami ishlagan vaqti: <b>${formatMinutes(totalM)}</b> (${(totalM / 60).toFixed(1)} soat)\n\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━\n`;
    text += `🏪 <b>Do'kon bo'yicha jami:</b> <b>${formatMinutes(totalStoreMinutes)}</b> (${(totalStoreMinutes / 60).toFixed(1)} soat)`;

    await this.sendMessage(chatId, text);
  }

  // --- Admin: Ishchilar ro'yxati ---
  private async handleAdminWorkers(chatId: number) {
    const snap = await getDocs(collection(db, 'users'));
    const workers: User[] = [];
    snap.forEach((d) => {
      const u = d.data() as User;
      if (u.role === 'worker') workers.push(u);
    });

    if (workers.length === 0) {
      await this.sendMessage(chatId, `Bazada hech qanday ishchilar mavjud emas.`);
      return;
    }

    let text = `👥 <b>Ro'yxatdan o'tgan ishchilar (${workers.length} kishi):</b>\n\n`;
    workers.forEach((w, idx) => {
      const tgStatus = w.telegram_id ? `<code>${w.telegram_id}</code> (Ulangan)` : `<i>Ulanmagan</i>`;
      text += `${idx + 1}. <b>${escapeHtml(w.full_name)}</b> (${escapeHtml(w.position || 'Xodim')})\n`;
      text += `   Tel: ${w.phone || 'Kiritilmagan'}\n`;
      text += `   Telegram: ${tgStatus}\n\n`;
    });

    await this.sendMessage(chatId, text);
  }

  // --- /bugun ---
  private async handleTodaySummary(chatId: number, tgUserId: string, isAdm: boolean) {
    const now = getTashkentNow();
    const todayStr = getTashkentDateString(now);

    if (isAdm) {
      const q = query(collection(db, 'attendance'), where('date', '==', todayStr));
      const snap = await getDocs(q);

      if (snap.empty) {
        await this.sendMessage(chatId, `📅 Bugun (${todayStr}) hali hech kim kelmadi.`);
        return;
      }

      const usersSnap = await getDocs(collection(db, 'users'));
      const userMap = new Map<number, string>();
      usersSnap.forEach((d) => {
        const u = d.data() as User;
        userMap.set(u.id, u.full_name);
      });

      let text = `📅 <b>Bugungi kunlik davomat (${todayStr}):</b>\n\n`;
      snap.forEach((d) => {
        const a = d.data() as Attendance;
        const name = userMap.get(a.user_id) || `Xodim #${a.user_id}`;
        let outT = a.check_out_time ? a.check_out_time.slice(0, 5) : 'Hozir ishda';
        if (a.status === 'on_break') outT = '☕️ Tanaffusda';
        const wStr = a.worked_minutes ? formatMinutes(a.worked_minutes) : 'davom etmoqda';
        text += `👤 <b>${escapeHtml(name)}</b>\n   Keldi: ${a.check_in_time.slice(0, 5)} | Ketdi: ${outT} (${wStr})\n\n`;
      });

      await this.sendMessage(chatId, text);
    } else {
      const user = await this.findUserByTelegramId(tgUserId);
      if (!user) {
        await this.sendMessage(
          chatId,
          `⚠️ <b>Siz hali tizimda ro'yxatdan o'tmagansiz!</b>\n\n` +
            `Iltimos, avval <b>/start</b> buyrug'ini bosing va telefon raqamingizni yuborib ro'yxatdan o'ting.`
        );
        return;
      }

      const q = query(
        collection(db, 'attendance'),
        where('user_id', '==', user.id),
        where('date', '==', todayStr)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        await this.sendMessage(chatId, `📅 Bugun hali ishga kelmadingiz.`);
        return;
      }

      let text = `📅 <b>Sizning bugungi davomatingiz (${todayStr}):</b>\n\n`;
      let totalM = 0;
      snap.forEach((d) => {
        const a = d.data() as Attendance;
        let outT = a.check_out_time ? a.check_out_time.slice(0, 5) : 'Hozir ishda';
        if (a.status === 'on_break') outT = '☕️ Tanaffusda';
        totalM += a.worked_minutes || 0;
        const wStr = a.worked_minutes ? formatMinutes(a.worked_minutes) : 'davom etmoqda';
        text += `• ${a.check_in_time.slice(0, 5)} ➡️ ${outT} (${wStr})\n`;
      });
      text += `\n📊 <b>Bugun jami:</b> <b>${formatMinutes(totalM)}</b>`;

      await this.sendMessage(chatId, text);
    }
  }

  // --- 6 Soatlik Monitoring Xabari Matni ---
  public async generateSixHourSummaryText(): Promise<string> {
    const todayStr = getTashkentDateString();
    const timeStr = getTashkentTimeString();

    // 1. Hozir ishda bo'lganlar
    const qActive = query(
      collection(db, 'attendance'),
      where('status', 'in', ['working', 'on_break'])
    );
    const snapActive = await getDocs(qActive);

    // 2. Barcha faol xodimlar
    const qWorkers = query(
      collection(db, 'users'),
      where('role', '==', 'worker')
    );
    const snapWorkers = await getDocs(qWorkers);
    const allWorkers: User[] = [];
    const userMap = new Map<number, User>();
    snapWorkers.forEach((d) => {
      const u = d.data() as User;
      if (u.is_active !== false) {
        allWorkers.push(u);
      }
      userMap.set(u.id, u);
    });

    // 3. Bugun kelganlar
    const qToday = query(
      collection(db, 'attendance'),
      where('date', '==', todayStr)
    );
    const snapToday = await getDocs(qToday);
    const checkedInUserIds = new Set<number>();
    snapToday.forEach((d) => {
      checkedInUserIds.add((d.data() as Attendance).user_id);
    });

    const notCheckedIn = allWorkers.filter((w) => !checkedInUserIds.has(w.id));

    let text = `📢 <b>${escapeHtml(this.shopName)} — DAVOMAT VA ISH VAQTI MONITORINGI (6 SOATLIK XULOSA)</b>\n`;
    text += `⏰ Vaqt: <b>${timeStr}</b> | Sana: <b>${todayStr}</b>\n\n`;

    // Ishda bo'lganlar
    if (!snapActive.empty) {
      text += `🟢 <b>HOZIR ISHDA BO'LGANLAR (${snapActive.size} kishi):</b>\n`;
      let idx = 1;
      snapActive.forEach((d) => {
        const a = d.data() as Attendance;
        const u = userMap.get(a.user_id);
        const name = u?.full_name || `Xodim #${a.user_id}`;
        const pos = u?.position ? ` — ${u.position}` : '';
        const breakBadge = a.status === 'on_break' ? ' (☕️ tanaffusda)' : '';
        text += `${idx++}. <b>${escapeHtml(name)}</b>${pos} (kelgan: ${a.check_in_time.slice(0, 5)}${breakBadge})\n`;
      });
    } else {
      text += `🟢 <b>HOZIR ISHDA BO'LGANLAR:</b>\n<i>Hozircha smenada faol xodim yo'q</i>\n`;
    }

    text += `\n`;

    // Bugun hali kelmaganlar
    if (notCheckedIn.length > 0) {
      text += `🔴 <b>BUGUN HALI KELMAGANLAR / ISHDA BO'LMAGANLAR (${notCheckedIn.length} kishi):</b>\n`;
      notCheckedIn.forEach((w, idx) => {
        const pos = w.position ? ` — ${w.position}` : '';
        text += `${idx + 1}. ${escapeHtml(w.full_name)}${pos}\n`;
      });
    } else {
      text += `🔴 <b>BUGUN KELMAGANLAR:</b>\n✅ <i>Barcha faol xodimlar bugun davomatdan o'tgan!</i>\n`;
    }

    text += `\n`;
    text += `⚠️ <b>DIQQAT! ISH TARTIB-QOIDASI VA QAT'IY ESLATMA:</b>\n`;
    text += `Hurmatli xodimlar!\n`;
    text += `Do'konga kelganingizda darhol <b>«📍 ISHGA KELDIM»</b> va ishdan ketayotganingizda albatta <b>«🏃‍♂️ ISHDAN KETDIM»</b> tugmasini bosing!\n\n`;
    text += `<i>Davomat avtomat tizimda daqiqama-daqiqa hisoblanadi. O'z vaqtida bosilmagan vaqt hisobga olinmasligi mumkin!</i>`;

    return text;
  }

  public async sendSixHourSummary(): Promise<number> {
    const text = await this.generateSixHourSummaryText();
    const targets = this.notifyTargetIds.length > 0 ? this.notifyTargetIds : this.adminIds;
    let sentCount = 0;
    for (const target of targets) {
      if (target && target !== '123456789') {
        const res = await this.sendMessage(target, text);
        if (res.ok) sentCount++;
      }
    }
    return sentCount;
  }

  private startSixHourScheduler() {
    if (this.cronInterval) return;
    console.log('[CloudBot] 6 soatlik bulutli avto-monitoring jadvali faollashtirildi (06:00, 12:00, 18:00, 00:00)...');
    this.cronInterval = setInterval(async () => {
      try {
        const now = getTashkentNow();
        const hour = now.getHours();
        const minute = now.getMinutes();

        // 1. 6 soatlik rejali monitoring
        if ([0, 6, 12, 18].includes(hour) && minute === 0) {
          const slot = `${getTashkentDateString(now)}_${hour}`;
          if (this.last6hSlot !== slot) {
            this.last6hSlot = slot;
            console.log(`[CloudBot Cron] ${slot} da 6 soatlik monitoring avtomat yuborilmoqda...`);
            await this.sendSixHourSummary();
          }
        }

        // 2. Kechki payt (18:00 dan 23:59 gacha) har 2 daqiqada:
        // Agar barcha ishchilar ishni tugatgan bo'lsa va hisobot hali jo'natilmagan bo'lsa,
        // AVTOMAT TARZDA KUNLIK YAKUNIY HISOBOTNI GURUHGA JO'NATISH!
        if (hour >= 18 && minute % 2 === 0) {
          await this.checkAndTriggerDailyClosingReportIfAllFinished();
        }
      } catch (err) {
        console.error('[CloudBot Cron Error]', err);
      }
    }, 30000);
  }

  // --- BARCHA ISHCHILAR ISHINI TUGATGANDAN KEYINGINA KUNLIK YAKUNIY HISOBOT ---
  public async checkAndTriggerDailyClosingReportIfAllFinished(todayStr = getTashkentDateString(), force = false): Promise<boolean> {
    try {
      // 1. Hozir hali ishlayotgan yoki tanaffusda bo'lgan faol smenalar bormi?
      const qActive = query(
        collection(db, 'attendance'),
        where('date', '==', todayStr),
        where('status', 'in', ['working', 'on_break'])
      );
      const snapActive = await getDocs(qActive);

      // Agar hali kamida 1 ta xodim ishlayotgan bo'lsa - hisobot YUBORILMAYDI!
      // ("faqat va faqat barcha ishchilar ishni tugatgandan keyingina")
      if (!snapActive.empty && !force) {
        return false;
      }

      // 2. Bugun tugallangan smenalar bormi?
      const qCompleted = query(
        collection(db, 'attendance'),
        where('date', '==', todayStr),
        where('status', '==', 'completed')
      );
      const snapCompleted = await getDocs(qCompleted);

      // Agar bugun umuman hech kim ishlamagan bo'lsa, yuborilmaydi
      if (snapCompleted.empty) {
        return false;
      }

      // 3. Ushbu sana va shu smenalar soni uchun hisobot avval yuborilganmi?
      const closingKey = `${todayStr}_shifts_${snapCompleted.size}`;
      if (!force && this.lastDailyClosingReportDate === closingKey) {
        return false;
      }

      // 4. Barcha faol xodimlarni olish (kelmaganlarni ham aniqlash uchun)
      const qWorkers = query(
        collection(db, 'users'),
        where('role', '==', 'worker')
      );
      const snapWorkers = await getDocs(qWorkers);
      const workerMap = new Map<number, User>();
      snapWorkers.forEach((d) => {
        const u = d.data() as User;
        if (u.is_active !== false) {
          workerMap.set(u.id, u);
        }
      });

      // 5. Xodimlar bo'yicha hisob-kitob
      interface WorkerDaySummary {
        user: User;
        shiftsCount: number;
        firstIn: string;
        lastOut: string;
        totalWorkedMinutes: number;
        totalBreakMinutes: number;
      }

      const completedWorkerIds = new Set<number>();
      const workerDayMap = new Map<number, WorkerDaySummary>();
      let dayTotalMinutes = 0;

      snapCompleted.forEach((d) => {
        const att = d.data() as Attendance;
        completedWorkerIds.add(att.user_id);
        dayTotalMinutes += att.worked_minutes || 0;

        const u = workerMap.get(att.user_id) || {
          id: att.user_id,
          full_name: `Xodim #${att.user_id}`,
          phone: '',
          role: 'worker',
          position: 'Xodim',
          work_start_time: '08:00',
          work_end_time: '20:00',
          is_active: true,
          created_at: '',
        };

        const existing = workerDayMap.get(att.user_id);
        if (existing) {
          existing.shiftsCount++;
          existing.totalWorkedMinutes += att.worked_minutes || 0;
          existing.totalBreakMinutes += att.total_break_minutes || 0;
          if (att.check_in_time < existing.firstIn) existing.firstIn = att.check_in_time;
          if (att.check_out_time && att.check_out_time > existing.lastOut) {
            existing.lastOut = att.check_out_time;
          }
        } else {
          workerDayMap.set(att.user_id, {
            user: u,
            shiftsCount: 1,
            firstIn: att.check_in_time,
            lastOut: att.check_out_time || '',
            totalWorkedMinutes: att.worked_minutes || 0,
            totalBreakMinutes: att.total_break_minutes || 0,
          });
        }
      });

      const dayTotalHours = Math.round((dayTotalMinutes / 60) * 10) / 10;
      const notAttendedWorkers: User[] = [];
      workerMap.forEach((w, id) => {
        if (!completedWorkerIds.has(id)) {
          notAttendedWorkers.push(w);
        }
      });

      const now = getTashkentNow();
      const timeStr = getTashkentTimeString(now, false);

      // 6. Chiroyli, rasmiy hisobot matnini tuzish
      let text = `🏁 <b>${escapeHtml(this.shopName)} — KUNLIK YAKUNIY DAVOMAT HISOBOTI</b>\n`;
      text += `✅ <b>BARCHA ISHCHILAR ISHINI TO'LIQ YAKUNLADI!</b>\n\n`;
      text += `📅 Sana: <b>${todayStr}</b> | ⏰ Yopilgan vaqt: <b>${timeStr}</b>\n`;
      text += `👥 Bugun ishlaganlar: <b>${workerDayMap.size} nafar</b>\n`;
      text += `⏱ Bugungi jami mehnat: <b>${dayTotalHours} soat</b> (${formatMinutes(dayTotalMinutes)})\n\n`;

      text += `📋 <b>XODIMLARNING BUGUNGI ISH NATIJALARI:</b>\n`;
      let idx = 1;
      workerDayMap.forEach((item) => {
        const inStr = item.firstIn.slice(0, 5);
        const outStr = item.lastOut.slice(0, 5) || 'Ketgan';
        const workedStr = formatMinutes(item.totalWorkedMinutes);
        const breakStr = item.totalBreakMinutes > 0 ? ` (☕️ ${formatMinutes(item.totalBreakMinutes)} tanaffus)` : '';
        const posStr = item.user.position ? ` — ${item.user.position}` : '';

        text += `${idx++}. 👤 <b>${escapeHtml(item.user.full_name)}</b>${posStr}\n`;
        text += `   🟢 Keldi: <b>${inStr}</b> | 🔴 Ketdi: <b>${outStr}</b>\n`;
        text += `   ⏱ Sof ishladi: <b>${workedStr}</b>${breakStr} ✅\n\n`;
      });

      if (notAttendedWorkers.length > 0) {
        text += `🔴 <b>BUGUN KELMAGANLAR (${notAttendedWorkers.length} kishi):</b>\n`;
        notAttendedWorkers.forEach((w) => {
          text += `• ${escapeHtml(w.full_name)} (${escapeHtml(w.position || 'Xodim')})\n`;
        });
        text += `\n`;
      }

      text += `🔒 <i>Do'kondagi barcha smenalar to'liq yopildi. Hozirda faol ishchi yo'q. Bugungi ish kuni muvaffaqiyatli yakunlandi!</i>`;

      // 7. Adminga va guruhlarga jo'natish
      this.lastDailyClosingReportDate = closingKey;
      console.log(`[CloudBot] Barcha ishchilar ishni tugatdi! Kunlik yakuniy hisobot yuborilmoqda: ${closingKey}`);
      await this.notifyAdmins(text);
      return true;
    } catch (err: any) {
      console.error('[CloudBot] checkAndTriggerDailyClosingReportIfAllFinished xatosi:', err);
      return false;
    }
  }

  // --- /kunyakun yoki /bugunyakun buyrug'i ---
  private async handleDailyClosingReportCommand(chatId: number) {
    const todayStr = getTashkentDateString();
    const qActive = query(
      collection(db, 'attendance'),
      where('date', '==', todayStr),
      where('status', 'in', ['working', 'on_break'])
    );
    const snapActive = await getDocs(qActive);

    if (!snapActive.empty) {
      const qWorkers = query(collection(db, 'users'), where('role', '==', 'worker'));
      const snapWorkers = await getDocs(qWorkers);
      const userMap = new Map<number, User>();
      snapWorkers.forEach((d) => userMap.set(d.data().id, d.data() as User));

      let activeNames: string[] = [];
      snapActive.forEach((d) => {
        const a = d.data() as Attendance;
        const u = userMap.get(a.user_id);
        activeNames.push(`• <b>${escapeHtml(u?.full_name || `Xodim #${a.user_id}`)}</b> (${a.check_in_time.slice(0, 5)} da kelgan)`);
      });

      await this.sendMessage(
        chatId,
        `⚠️ <b>Kunlik yakuniy hisobot hali chiqarilmadi!</b>\n\n` +
          `Chunki do'konda hali smenasi davom etayotgan xodimlar bor (${snapActive.size} kishi):\n` +
          activeNames.join('\n') +
          `\n\n<i>Qoida: Kunlik yakuniy hisobot faqat BARCHA ishchilar ishni tugatib ketgandagina avtomatik guruhga yuboriladi.</i>`
      );
      return;
    }

    const sent = await this.checkAndTriggerDailyClosingReportIfAllFinished(todayStr, true);
    if (!sent) {
      await this.sendMessage(chatId, `Bugun hali tugallangan davomat yozuvlari qayd etilmagan.`);
    }
  }

  // --- /send6h yoki 📢 6 Soatlik Monitoring ---
  private async handleSend6hCommand(chatId: number) {
    const text = await this.generateSixHourSummaryText();
    const inline = {
      inline_keyboard: [
        [{ text: '📢 Guruhga Ham Yuborish', callback_data: 'send_6h_now' }],
      ],
    };
    await this.sendMessage(chatId, text, inline);
  }

  // --- 🔔 Eslatmalar ---
  private async handleAdminRemindersCommand(chatId: number) {
    const todayStr = getTashkentDateString();
    const now = getTashkentNow();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const qActive = query(
      collection(db, 'attendance'),
      where('status', 'in', ['working', 'on_break'])
    );
    const snapActive = await getDocs(qActive);

    const qWorkers = query(collection(db, 'users'), where('role', '==', 'worker'));
    const snapWorkers = await getDocs(qWorkers);
    const userMap = new Map<number, User>();
    snapWorkers.forEach((d) => userMap.set(d.data().id, d.data() as User));

    const overdue: { name: string; inTime: string; hours: number }[] = [];
    snapActive.forEach((d) => {
      const a = d.data() as Attendance;
      const u = userMap.get(a.user_id);
      const [inH, inM] = a.check_in_time.split(':').map(Number);
      const inTotal = (inH || 0) * 60 + (inM || 0);
      const isPastDate = a.date < todayStr;
      const isLong = isPastDate || currentMins - inTotal > 660; // 11 soatdan ko'p
      if (isLong) {
        const diffH = isPastDate ? 14 : Math.round((currentMins - inTotal) / 60);
        overdue.push({
          name: u?.full_name || `Xodim #${a.user_id}`,
          inTime: a.check_in_time.slice(0, 5),
          hours: diffH,
        });
      }
    });

    let text = `🔔 <b>${escapeHtml(this.shopName)} — AQLLI ESLATMALAR</b>\n\n`;
    if (overdue.length > 0) {
      text += `⚠️ <b>Ketishni unutganlar (${overdue.length} kishi):</b>\n`;
      overdue.forEach((o) => {
        text += `• <b>${escapeHtml(o.name)}</b> — ${o.inTime} da kelgan (${o.hours} soatdan beri ishda)\n`;
      });
      text += `\n`;
    } else {
      text += `✅ <i>Ketishni unutgan xodimlar yo'q.</i>\n\n`;
    }

    text += `📢 6 soatlik umumiy monitoringni guruhga yuborish uchun <b>/send6h</b> buyrug'ini yuboring.`;
    const inline = {
      inline_keyboard: [
        [{ text: '📢 6 Soatlik Xulosani Yuborish', callback_data: 'send_6h_now' }],
      ],
    };
    await this.sendMessage(chatId, text, inline);
  }

  // --- 🏆 KPI Reyting Buyrug'i (/kpi, /reyting) ---
  private async handleKpiRatingCommand(chatId: number) {
    const todayStr = getTashkentDateString();
    const currentMonthPrefix = todayStr.slice(0, 7);

    const qWorkers = query(
      collection(db, 'users'),
      where('role', '==', 'worker')
    );
    const snapWorkers = await getDocs(qWorkers);
    const workerMap = new Map<number, User>();
    snapWorkers.forEach((d) => {
      const u = d.data() as User;
      if (u.is_active !== false) {
        workerMap.set(u.id, u);
      }
    });

    const qAtts = query(
      collection(db, 'attendance'),
      where('date', '>=', `${currentMonthPrefix}-01`),
      where('date', '<=', `${currentMonthPrefix}-31`)
    );
    const snapAtts = await getDocs(qAtts);

    const workerHoursMap = new Map<number, { minutes: number; days: Set<string> }>();
    snapAtts.forEach((d) => {
      const a = d.data() as Attendance;
      const cur = workerHoursMap.get(a.user_id) || { minutes: 0, days: new Set<string>() };
      cur.minutes += a.worked_minutes || 0;
      cur.days.add(a.date);
      workerHoursMap.set(a.user_id, cur);
    });

    const list: { name: string; position: string; hours: number; days: number; minutes: number }[] = [];
    workerMap.forEach((u, id) => {
      const stat = workerHoursMap.get(id) || { minutes: 0, days: new Set<string>() };
      const hours = Math.round((stat.minutes / 60) * 10) / 10;
      list.push({
        name: u.full_name,
        position: u.position || 'Xodim',
        hours,
        days: stat.days.size,
        minutes: stat.minutes,
      });
    });

    list.sort((a, b) => b.minutes - a.minutes);

    let text = `🏆 <b>${escapeHtml(this.shopName)} — ISHCHILARNING KPI VA ISH SOATI REYTINGI</b>\n`;
    text += `📅 Davr: <b>${currentMonthPrefix}</b>\n\n`;

    if (list.length === 0) {
      text += `<i>Ushbu oyda hali davomat yozuvlari mavjud emas.</i>`;
    } else {
      list.slice(0, 10).forEach((item, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `🔹 #${idx + 1}`;
        text += `${medal} <b>${escapeHtml(item.name)}</b> (${escapeHtml(item.position)})\n`;
        text += `   ⏱ <b>${item.hours} soat</b> (${item.days} kun ishlagan)\n\n`;
      });
    }

    const inline = {
      inline_keyboard: [
        [{ text: '📊 Batafsil KPI Portalini Ochish', url: this.webappUrl }],
      ],
    };

    await this.sendMessage(chatId, text, inline);
  }

  // --- /app yoki /portal ---
  private async handleAppCommand(chatId: number) {
    if (this.webappUrl && this.webappUrl.startsWith('http')) {
      const inlineMarkup = {
        inline_keyboard: [
          [{ text: '📱 Telegramda Ochish (Mini App)', web_app: { url: this.webappUrl } }],
          [{ text: '🌐 Brauzerda Ochish ↗️', url: this.webappUrl }],
        ],
      };
      await this.sendMessage(
        chatId,
        `🏪 <b>${escapeHtml(this.shopName)} Veb-Portali</b>\n\n` +
          `✅ <b>Eslatma:</b> Oddiy ish vaqti hisobi (ishga kelish, ketish, tanaffus, oylik soatlar) uchun saytga kirish <b>shart emas</b>! Barchasini to'g'ridan-to'g'ri Telegram botdagi tugmalar orqali qilishingiz mumkin.\n\n` +
          `To'liq hisobotlar va boshqaruv panelini ko'rmoqchi bo'lsangiz, quyidagi tugmalardan birini bosing:`,
        inlineMarkup
      );
    } else {
      await this.sendMessage(chatId, `Veb-portal manzili hali sozlanmagan.`);
    }
  }

  // --- /help ---
  private async handleHelp(chatId: number, isAdm: boolean) {
    let text =
      `ℹ️ <b>${escapeHtml(this.shopName)} Boti Buyruqlari:</b>\n\n` +
      `📍 <b>/keldim</b> — Ish boshlanganini belgilaydi (GPS tasdiqlanadi)\n` +
      `🏃‍♂️ <b>/ketdim</b> — Ishni yakunlaydi va vaqtni hisoblaydi\n` +
      `☕️ <b>/tanaffus</b> — Tanaffusga chiqish\n` +
      `▶️ <b>/qaytdim</b> — Tanaffusdan qaytish\n` +
      `⏱ <b>/soat</b> — Oylik ishlagan soatlaringiz\n` +
      `📅 <b>/bugun</b> — Bugungi smenalaringiz\n` +
      `🏆 <b>/kpi</b> — Ishchilarning KPI va soat reytingi\n` +
      `🌐 <b>/portal</b> — Veb-portalni ochish\n`;

    if (isAdm) {
      text +=
        `\n👑 <b>Admin buyruqlari:</b>\n` +
        `🔴 <b>/live</b> — Hozir ishda kim borligini ko'rish\n` +
        `📊 <b>/hisobot</b> — Oylik umumiy hisobot\n` +
        `👥 <b>/ishchilar</b> — Xodimlar ro'yxati\n` +
        `📢 <b>/send6h</b> — 6 soatlik monitoring xulosasi\n` +
        `🔔 <b>/eslatma</b> — Aqlli eslatmalar\n` +
        `🏁 <b>/kunyakun</b> — Kunlik to'liq yakuniy hisobot\n`;
    }

    await this.sendMessage(chatId, text);
  }

  // --- Firestore Yordamchi Funksiyalari ---
  private async findUserByTelegramId(tgId: string): Promise<User | null> {
    const q = query(collection(db, 'users'), where('telegram_id', '==', String(tgId)));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as User;
  }

  private async findActiveShift(userId: number): Promise<Attendance | null> {
    const q = query(
      collection(db, 'attendance'),
      where('user_id', '==', userId),
      where('status', 'in', ['working', 'on_break'])
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as Attendance;
  }

  private async countCompletedShiftsToday(userId: number, todayStr: string): Promise<number> {
    const q = query(
      collection(db, 'attendance'),
      where('user_id', '==', userId),
      where('date', '==', todayStr),
      where('status', '==', 'completed')
    );
    const snap = await getDocs(q);
    return snap.size;
  }

  private async getTodayTotalMinutes(userId: number, todayStr: string): Promise<number> {
    const q = query(
      collection(db, 'attendance'),
      where('user_id', '==', userId),
      where('status', '==', 'completed')
    );
    const snap = await getDocs(q);
    let sum = 0;
    snap.forEach((d) => {
      const att = d.data() as Attendance;
      if (att.date === todayStr || att.check_out_date === todayStr) {
        sum += getAccurateAttendanceMinutes(att);
      }
    });
    return sum;
  }
}

export const cloudTelegramBot = new CloudTelegramBot();
