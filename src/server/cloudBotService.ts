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
  runTransaction,
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
  calculateLatePenaltyAmount,
  formatUzSum,
} from '../utils/calculations.ts';

// O'zbekiston (Toshkent UTC+5, yozgi vaqt o'zgarishi yo'q) uchun 100% aniq vaqt qismlari
export interface TashkentTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateStr: string;
  timeStr: string;
  monthPrefix: string;
}

export function getTashkentParts(d: Date = new Date()): TashkentTimeParts {
  // UTC vaqtiga aniq +5 soat qo'shib, UTC metodlari bilan o'qiymiz (server vaqt zonasidan 100% mustaqil)
  const uzMs = d.getTime() + 5 * 3600 * 1000;
  const uzDate = new Date(uzMs);
  const year = uzDate.getUTCFullYear();
  const month = uzDate.getUTCMonth() + 1;
  const day = uzDate.getUTCDate();
  const hour = uzDate.getUTCHours();
  const minute = uzDate.getUTCMinutes();
  const second = uzDate.getUTCSeconds();
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateStr: `${year}-${mm}-${dd}`,
    timeStr: `${hh}:${mi}`,
    monthPrefix: `${year}-${mm}`,
  };
}

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

const DEFAULT_PUBLIC_APP_URL = 'https://ais-pre-jzx3h6wrsjjnjrsu6xnas6-3620319891.asia-east1.run.app';

export function normalizePublicWebappUrl(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return DEFAULT_PUBLIC_APP_URL;
  let normalized = trimmed.replace(/\/+$/, '');
  if (!normalized.includes('localhost') && !normalized.includes('127.0.0.1')) {
    if (normalized.startsWith('http://')) {
      normalized = 'https://' + normalized.slice('http://'.length);
    } else if (!normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    // Ishchilar va tashqi foydalanuvchilar uchun har doim ais-pre- (ommaviy) URL ishlatiladi
    normalized = normalized.replace('://ais-dev-', '://ais-pre-');
  }
  return normalized;
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
  private webappUrl = normalizePublicWebappUrl(
    process.env.APP_URL || process.env.WEBAPP_URL || DEFAULT_PUBLIC_APP_URL
  );
  private botUsername: string | null = null;
  private pollAbortController: AbortController | null = null;
  private consecutiveErrors = 0;
  private instanceId = `srv_${process.pid}_${Math.random().toString(36).substring(2, 8)}`;
  private bootTime = Date.now();
  // Yangilangan barqaror versiya (500) har qanday eski qolib ketgan serverlardan ustun keladi va pollingni darhol oladi
  private leaderPriority = 500;
  private isLeader = false;
  private lastLeaderCheck = 0;
  private observedLeaderId: string | null = null;
  private heartbeatInterval: any = null;
  private leaderUnsubscribe: (() => void) | null = null;
  private isWebhookMode = false;
  private webhookUrl: string | null = null;
  private lastUpdateReceivedAt: string | null = null;
  private updatesProcessedCount = 0;
  private cronInterval: any = null;
  private last6hSlot = '';
  private lastDailyClosingReportDate = '';
  // Xabarlar va Telegram yangilanishlarini takroran yuborishni oldini oluvchi keshlar (Deduplication)
  private processedUpdateIds = new Set<number>();
  private processedMessageIds = new Set<string>();
  private recentSentMessageCache = new Map<string, number>();
  private recentMsgCache = new Map<string, number>();
  private userActionLocks = new Map<string, number>();
  // GPS sozlamalari va lokatsiya kutish holati (Kelish va Ketish uchun)
  private gpsRequired = true;
  private gpsCheckoutRequired = false;
  private marketLatitude = 38.829651;
  private marketLongitude = 65.810833;
  private gpsRadiusMeters = 100;
  // Kechikish va jarima sozlamalari (Firestore dan jonli sinxronlanadi)
  private latePenaltyEnabled = true;
  private lateGracePeriodMinutes = 10;
  private latePenaltyPerMinuteSum = 1000;
  // Ertalabki uyg'otuvchi va ishga chaqiruvchi eslatma sozlamalari
  private morningWakeupEnabled = true;
  private morningWakeupMinutesBefore = 30;
  private morningWakeupCustomText = '';
  private pendingLocationUsers = new Map<string, { chatId: number; isAdm: boolean; isGroup: boolean; timestamp: number }>();
  private pendingCheckoutLocationUsers = new Map<string, { chatId: number; isAdm: boolean; isGroup: boolean; timestamp: number }>();
  private pendingDateRangeUsers = new Set<string>();

  constructor() {
    this.botToken = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
    this.listenToSettings();
  }

  private getPenaltySettings(): Partial<MarketSettings> {
    return {
      late_penalty_enabled: this.latePenaltyEnabled,
      late_grace_period_minutes: this.lateGracePeriodMinutes,
      late_penalty_per_minute_sum: this.latePenaltyPerMinuteSum,
    };
  }

  public getStatus() {
    const tParts = getTashkentParts();
    return {
      running: this.isRunning,
      isLeader: this.isLeader,
      leaderPriority: this.leaderPriority,
      bootTime: this.bootTime,
      observedLeaderId: this.observedLeaderId || (this.isLeader ? this.instanceId : null),
      isWebhookMode: this.isWebhookMode,
      webhookUrl: this.webhookUrl,
      webappUrl: this.webappUrl,
      lastUpdateReceivedAt: this.lastUpdateReceivedAt,
      updatesProcessedCount: this.updatesProcessedCount,
      instanceId: this.instanceId,
      botUsername: this.botUsername,
      hasToken: Boolean(this.botToken),
      adminCount: this.adminIds.length,
      notifyTargetCount: this.notifyTargetIds.length,
      notifyTargets: this.notifyTargetIds,
      shopName: this.shopName,
      latePenaltyEnabled: this.latePenaltyEnabled,
      lateGracePeriodMinutes: this.lateGracePeriodMinutes,
      latePenaltyPerMinuteSum: this.latePenaltyPerMinuteSum,
      morningWakeupEnabled: this.morningWakeupEnabled,
      morningWakeupMinutesBefore: this.morningWakeupMinutesBefore,
      consecutiveErrors: this.consecutiveErrors,
      tashkentTime: `${tParts.dateStr} ${tParts.timeStr}`,
      timestamp: getTashkentNow().toISOString(),
    };
  }

  public updateBaseUrl(req: any) {
    if (req) {
      const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').trim();
      if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        this.webappUrl = normalizePublicWebappUrl(`${proto}://${host}`);
      }
    }
  }

  // --- TELEGRAM WEBHOOK ---
  public async handleWebhookUpdate(update: any, req?: any) {
    if (req) {
      this.updateBaseUrl(req);
    }
    if (!update) return;
    // Agar Long Polling faol bo'lsa va Webhook o'chirilgan bo'lsa, dublikat bo'lmasligi uchun filtrlanadi
    if (!this.isWebhookMode && this.isRunning) {
      if (update.update_id && this.processedUpdateIds.has(update.update_id)) {
        return;
      }
    }
    if (update.update_id) {
      if (this.processedUpdateIds.has(update.update_id)) {
        return;
      }
      this.processedUpdateIds.add(update.update_id);
      if (this.processedUpdateIds.size > 3000) {
        const first = this.processedUpdateIds.values().next().value;
        if (first !== undefined) this.processedUpdateIds.delete(first);
      }
    }
    const tp = getTashkentParts();
    this.lastUpdateReceivedAt = `${tp.dateStr} ${tp.timeStr}:${String(tp.second).padStart(2, '0')}`;
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

  // Bot ulanishini to'liq yangilash, noto'g'ri vebxuklarni tozalash va 24/7 Cloud Pollingni faollashtirish
  public async reconnectAndVerify(overrideToken?: string) {
    if (overrideToken && overrideToken.trim()) {
      this.botToken = overrideToken.trim();
    }
    if (!this.botToken) {
      return { ok: false, error: "Bot token kiritilmagan" };
    }
    try {
      this.isWebhookMode = false;
      this.webhookUrl = null;
      await this.clearWebhook();
      this.botUsername = null;
      await this.fetchBotInfo();
      if (!this.botUsername) {
        return {
          ok: false,
          error: "Bot token noto'g'ri yoki Telegram API javob bermadi. @BotFather dan olingan tokenni tekshiring.",
        };
      }
      this.lastLeaderCheck = 0;
      await this.acquireLeadership(true);
      this.restartPolling();
      if (!this.isRunning) {
        this.runPollingLoop();
      }
      return {
        ok: true,
        mode: 'cloud_long_polling_24_7',
        botUsername: this.botUsername,
        status: this.getStatus(),
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || "Botni ulashda xatolik" };
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

  private applySettingsData(data: Partial<MarketSettings>): { tokenChanged: boolean } {
    const newToken = (data.bot_token || process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
    const newAdmin = (data.admin_telegram_id || '').trim();
    const newGroup = (data.group_telegram_id || '').trim();
    const payrollAdmin = (data.payroll_admin_id || '').trim();
    this.shopName = data.shop_name || 'Navo Market';

    const adminsList = newAdmin
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('-'));

    const adminIdsArray = Array.isArray(data.admin_ids) ? data.admin_ids.map(String) : [];
    const adminsArray = Array.isArray(data.admins) ? data.admins.map((a: any) => String(a.telegram_id || '')) : [];
    const combinedAdminList = [
      ...adminsList,
      ...adminIdsArray,
      ...adminsArray,
      ...(payrollAdmin && !payrollAdmin.startsWith('-') ? [payrollAdmin] : []),
    ]
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('-') && s !== '123456789');

    const allTargets = [
      ...combinedAdminList,
      ...newGroup.split(/[,;\s]+/),
    ]
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && s !== '123456789');

    const tokenChanged = Boolean(this.botToken && newToken && newToken !== this.botToken) || (!this.botToken && Boolean(newToken));
    this.botToken = newToken;
    this.adminIds = Array.from(new Set(combinedAdminList));
    this.notifyTargetIds = Array.from(new Set(allTargets));

    // GPS sozlamalari
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

    // Kechikish jarimasi sozlamalarini jonli yangilash
    this.latePenaltyEnabled = data.late_penalty_enabled !== false;
    this.lateGracePeriodMinutes =
      typeof data.late_grace_period_minutes === 'number' && !isNaN(data.late_grace_period_minutes)
        ? Math.max(0, data.late_grace_period_minutes)
        : 10;
    this.latePenaltyPerMinuteSum =
      typeof data.late_penalty_per_minute_sum === 'number' && !isNaN(data.late_penalty_per_minute_sum)
        ? Math.max(0, data.late_penalty_per_minute_sum)
        : 1000;

    // Ertalabki uyg'otuvchi va ishga chaqiruvchi eslatma sozlamalari
    this.morningWakeupEnabled = data.reminder_morning_wakeup_enabled !== false;
    this.morningWakeupMinutesBefore =
      typeof data.reminder_morning_wakeup_minutes_before === 'number' && !isNaN(data.reminder_morning_wakeup_minutes_before)
        ? Math.max(5, Math.min(180, data.reminder_morning_wakeup_minutes_before))
        : 30;
    this.morningWakeupCustomText = String(data.reminder_morning_wakeup_custom_text || '').trim();

    return { tokenChanged };
  }

  // Firestore sozlamalarini jonli tinglash va boshlang'ich yuklash
  private listenToSettings() {
    const settingsDoc = doc(db, 'settings', 'general_settings');

    // Boshlang'ich qiymatni darhol o'qish
    getDoc(settingsDoc)
      .then(async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Partial<MarketSettings>;
          this.applySettingsData(data);
          console.log(
            `[CloudBot] Boshlang'ich sozlamalar yuklandi: Token=${Boolean(this.botToken)}, Adminlar=${this.adminIds.join(',')}, Jarima=${this.latePenaltyEnabled} (${this.lateGracePeriodMinutes}m / ${this.latePenaltyPerMinuteSum} so'm)`
          );
          if (this.botToken) {
            await this.clearWebhook();
          }
        } else if (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) {
          this.botToken = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
          console.log(`[CloudBot] Environment'dan bot token yuklandi.`);
          if (this.botToken) {
            await this.clearWebhook();
          }
        }
      })
      .catch((err) => {
        console.warn("[CloudBot] Boshlang'ich sozlamalarni o'qishda ogohlantirish:", err);
      });

    onSnapshot(
      settingsDoc,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Partial<MarketSettings>;
          const { tokenChanged } = this.applySettingsData(data);

          console.log(
            `[CloudBot] Sozlamalar yangilandi: Adminlar=${this.adminIds.join(',')}, GPS=${this.gpsRequired}, Jarima=${this.latePenaltyEnabled} (${this.lateGracePeriodMinutes}daq, ${this.latePenaltyPerMinuteSum} so'm)`
          );

          if (tokenChanged) {
            console.log(`[CloudBot] Telegram bot tokeni yangilandi. Qayta ishga tushirilmoqda...`);
            this.botUsername = null;
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
    this.watchLeadership();
    this.startHeartbeatLoop();

    // Webhook rejimini tozalab, 100% ishlaydigan va ishonchli Long Polling rejimiga o'tkazamiz
    try {
      if (this.botToken) {
        await this.clearWebhook();
      }
    } catch (e) {
      console.warn('[CloudBot] Webhookni tozalashda ogohlantirish:', e);
    }

    if (!this.isRunning) {
      this.runPollingLoop();
    }
  }

  public stop() {
    this.shouldRun = false;
    this.isRunning = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }
    if (this.leaderUnsubscribe) {
      this.leaderUnsubscribe();
      this.leaderUnsubscribe = null;
    }
    this.releaseLeadership().catch(() => {});
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  // Boshqa instansiya bizdan ustun (yangi yoki yuqori prioritetli) ekanligini qat'iy tartib bilan aniqlash
  private isRemoteSuperior(remotePriority: number, remoteBootTime: number, remoteLeaderId: string): boolean {
    if (remotePriority > this.leaderPriority) return true;
    if (remotePriority < this.leaderPriority) return false;
    if (remoteBootTime > this.bootTime + 3000) return true;
    if (this.bootTime > remoteBootTime + 3000) return false;
    return remoteLeaderId > this.instanceId;
  }

  // Real-vaqtda bot_leader hujjatini kuzatish:
  // Eski versiyadagi server (masalan v4) leaderlikni ushlab turgan bo'lsa, darhol qaytarib olamiz!
  private watchLeadership() {
    if (this.leaderUnsubscribe) return;
    const leaderDocRef = doc(db, 'settings', 'bot_leader');
    this.leaderUnsubscribe = onSnapshot(
      leaderDocRef,
      (snap) => {
        if (!this.shouldRun || !snap.exists()) return;
        const data = snap.data() || {};
        const currentLeader = String(data.leader_id || '');
        const remotePriority = Number(data.priority_version || 0);
        const remoteBootTime = Number(data.boot_time || 0);
        const lastHb = Math.max(Number(data.heartbeat || 0), Number(data.last_heartbeat || 0));
        const remoteOffset = Number(data.last_offset || 0);
        const now = Date.now();
        this.observedLeaderId = currentLeader || null;

        if (remoteOffset > this.currentOffset) {
          this.currentOffset = remoteOffset;
        }

        if (currentLeader && currentLeader !== this.instanceId) {
          const remoteAlive = now - lastHb < 15000;
          const remoteSuperior = this.isRemoteSuperior(remotePriority, remoteBootTime, currentLeader);

          if (remoteAlive && remoteSuperior) {
            if (this.isLeader) {
              console.log(
                `[CloudBot] Yangi/asosiy server leaderlikni oldi (${currentLeader}, v${remotePriority}). Ushbu nusxa (${this.instanceId}) kutish rejimiga o'tdi.`
              );
              this.isLeader = false;
              if (this.pollAbortController) {
                this.pollAbortController.abort();
                this.pollAbortController = null;
              }
            }
          } else if ((!remoteAlive || !remoteSuperior) && this.botToken) {
            // Eski versiyadagi server (masalan v0..v4) yoki o'chgan server o'rniga darhol yangi versiya leaderlikni oladi!
            this.lastLeaderCheck = 0;
            this.acquireLeadership(true).catch(() => {});
          }
        }
      },
      (err) => {
        console.warn('[CloudBot] Leader kuzatuvida ogohlantirish:', err?.message || err);
      }
    );
  }

  // Har 6 soniyada ham `heartbeat`, ham `last_heartbeat` ni yangilab turish:
  // Eski serverlar ham, yangi serverlar ham ushbu faol leaderni ko'radi va 409 Conflict mutlaqo yuz bermaydi!
  private startHeartbeatLoop() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(async () => {
      if (!this.shouldRun || !this.isLeader || !this.botToken) return;
      const now = Date.now();
      try {
        await setDoc(
          doc(db, 'settings', 'bot_leader'),
          {
            leader_id: this.instanceId,
            heartbeat: now,
            last_heartbeat: now,
            priority_version: this.leaderPriority,
            boot_time: this.bootTime,
            last_offset: this.currentOffset,
            updated_at: new Date(now).toISOString(),
            instance_url: this.webappUrl,
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('[CloudBot Heartbeat] Ogohlantirish:', e);
      }
    }, 6000);
  }

  // 100% 409 Conflict va 2 martadan javob qaytarishni oldini olish (Atomik Transaction bilan Leader Election)
  private async acquireLeadership(forceCheck = false): Promise<boolean> {
    const now = Date.now();
    if (!forceCheck && now - this.lastLeaderCheck < 6000 && this.isLeader) {
      return true;
    }
    this.lastLeaderCheck = now;

    try {
      const leaderDocRef = doc(db, 'settings', 'bot_leader');
      const won = await runTransaction(db, async (tx) => {
        const snap = await tx.get(leaderDocRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          const currentLeader = String(data.leader_id || '');
          const remotePriority = Number(data.priority_version || 0);
          const remoteBootTime = Number(data.boot_time || 0);
          const remoteOffset = Number(data.last_offset || 0);
          if (remoteOffset > this.currentOffset) {
            this.currentOffset = remoteOffset;
          }
          // Ikkala maydonni ham tekshiramiz (`heartbeat` va `last_heartbeat`)
          const lastHeartbeat = Math.max(Number(data.heartbeat || 0), Number(data.last_heartbeat || 0));

          if (
            currentLeader &&
            currentLeader !== this.instanceId &&
            now - lastHeartbeat < 15000 &&
            this.isRemoteSuperior(remotePriority, remoteBootTime, currentLeader)
          ) {
            return false;
          }
        }

        tx.set(
          leaderDocRef,
          {
            leader_id: this.instanceId,
            heartbeat: now,
            last_heartbeat: now,
            priority_version: this.leaderPriority,
            boot_time: this.bootTime,
            last_offset: this.currentOffset,
            updated_at: new Date(now).toISOString(),
            instance_url: this.webappUrl,
          },
          { merge: true }
        );
        return true;
      });

      if (!won && this.isLeader) {
        console.log(`[CloudBot] Boshqa faol server leader. Ushbu nusxa (${this.instanceId}) kutish rejimiga o'tdi.`);
      }
      this.isLeader = won;
      if (won) {
        this.observedLeaderId = this.instanceId;
      }
      return won;
    } catch (err) {
      console.warn('[CloudBot Leader] Leader tekshirishda ogohlantirish:', err);
      return this.isLeader;
    }
  }

  private async releaseLeadership() {
    try {
      if (this.isLeader) {
        const leaderDocRef = doc(db, 'settings', 'bot_leader');
        await setDoc(
          leaderDocRef,
          { leader_id: null, heartbeat: 0, last_heartbeat: 0, priority_version: 0 },
          { merge: true }
        );
        this.isLeader = false;
      }
    } catch {}
  }

  // Har bir xabar yoki callback_query faqat va faqat 1 marta qayta ishlanishini ta'minlovchi tezkor xotira blokirovkasi
  private claimDistributedMessageLock(lockKey: string): boolean {
    if (this.processedMessageIds.has(lockKey)) {
      return false;
    }
    this.processedMessageIds.add(lockKey);
    if (this.processedMessageIds.size > 5000) {
      const first = this.processedMessageIds.values().next().value;
      if (first) this.processedMessageIds.delete(first);
    }
    return true;
  }

  private restartPolling() {
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
    this.consecutiveErrors = 0;
  }

  // Asosiy 24/7 Long Polling tsikli (0.05s tezkor javob va 0% dublikat)
  private async runPollingLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[CloudBot] 24/7 Doimiy Polling tsikli ishga tushdi (${this.instanceId}, priority=v${this.leaderPriority}).`);

    // 6 soatlik fon monitoringini avtomatik ishga tushiramiz
    this.startSixHourScheduler();

    while (this.shouldRun) {
      if (this.isWebhookMode) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      if (!this.botToken) {
        await new Promise((r) => setTimeout(r, 2500));
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
        // 12 soniyali Long Polling: xabar yozilgan zahoti Telegram 0.05 soniyada darhol push qiladi!
        const timeoutSeconds = 12;
        const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.currentOffset}&timeout=${timeoutSeconds}&allowed_updates=${encodeURIComponent('["message","edited_message","callback_query","channel_post"]')}`;

        const res = await fetch(url, {
          signal: this.pollAbortController.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 409) {
            this.consecutiveErrors++;
            console.warn(`[CloudBot] 409 Conflict aniqlandi (${this.consecutiveErrors}). Webhook/Leader tekshirilmoqda...`);
            // Agar Telegramda tasodifiy webhook qolib ketgan bo'lsa tozalaymiz
            if (errText.toLowerCase().includes('webhook')) {
              await this.clearWebhook();
            }
            this.lastLeaderCheck = 0;
            const stillLeader = await this.acquireLeadership(true);
            if (!stillLeader) {
              await new Promise((r) => setTimeout(r, 4000));
              continue;
            }
            await new Promise((r) => setTimeout(r, 1500));
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
              continue;
            }
            this.processedUpdateIds.add(update.update_id);
            if (this.processedUpdateIds.size > 3000) {
              const first = this.processedUpdateIds.values().next().value;
              if (first !== undefined) this.processedUpdateIds.delete(first);
            }
            const tp = getTashkentParts();
            this.lastUpdateReceivedAt = `${tp.dateStr} ${tp.timeStr}:${String(tp.second).padStart(2, '0')}`;
            this.updatesProcessedCount++;
            try {
              await this.processUpdate(update);
            } catch (procErr: any) {
              console.error(`[CloudBot] Update #${update.update_id} qayta ishlashda xato:`, procErr?.message || procErr);
            }
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
            { command: 'jarima', description: '⚠️ Kechikish va jarimalar hisobi' },
            { command: 'bugun', description: '📅 Bugungi kunlik hisobot' },
            { command: 'kpi', description: '🏆 KPI va soatlar reytingi' },
            { command: 'live', description: '🔴 Hozir ishda kim bor (Admin)' },
            { command: 'hisobot', description: '📊 Oylik umumiy hisobot (Admin)' },
            { command: 'ishchilar', description: '👥 Ishchilar ro\'yxati (Admin)' },
            { command: 'monitoring', description: '📢 6 soatlik monitoring (Admin)' },
            { command: 'eslatma', description: '🔔 Aqlli eslatmalar (Admin)' },
            { command: 'portal', description: '🌐 Veb-portal (Mini App)' },
            { command: 'oraliq', description: '📅 Sanalar oralig\'i hisoboti' },
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

  private async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
    if (!this.botToken || !callbackQueryId) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: showAlert,
        }),
      });
    } catch {}
  }

  private sanitizeReplyMarkupForChat(chatId: string | number, replyMarkup?: any): any {
    if (!replyMarkup) return undefined;
    const isGroupChat = String(chatId).trim().startsWith('-');
    if (!isGroupChat) return replyMarkup;

    // Guruh chatlarida ReplyKeyboard (ayniqsa Admin tugmalari yoki request_location) yuborish xato va noqulaylik keltiradi
    if (replyMarkup.keyboard) {
      return undefined;
    }

    // Telegram API guruh chatlarida inline_keyboard ichida `web_app` tugmasini taqiqlaydi (BUTTON_TYPE_INVALID)!
    // Uni avtomatik ravishda oddiy `url` tugmasiga aylantiramiz:
    if (Array.isArray(replyMarkup.inline_keyboard)) {
      return {
        ...replyMarkup,
        inline_keyboard: replyMarkup.inline_keyboard.map((row: any[]) =>
          row.map((btn: any) => {
            if (btn && btn.web_app?.url) {
              const { web_app, ...rest } = btn;
              return { ...rest, url: normalizePublicWebappUrl(web_app.url) };
            }
            return btn;
          })
        ),
      };
    }

    return replyMarkup;
  }

  // Buyruqlarni tozalash va emojilar/belgilar/apostroflarga chidamli normallashtirish
  private normalizeCommandText(rawText: string): { cmd: string; fullClean: string; startPayload: string } {
    if (!rawText) return { cmd: '', fullClean: '', startPayload: '' };
    const clean = rawText
      .replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060]/g, '')
      .replace(/[‘’`ʼʻ]/g, "'")
      .trim();

    const parts = clean.split(/\s+/);
    let firstToken = parts[0] || '';
    if (firstToken.startsWith('/') && firstToken.includes('@')) {
      firstToken = firstToken.split('@')[0];
    }

    const startPayload = clean.toLowerCase().startsWith('/start ')
      ? clean.slice(7).trim().toLowerCase()
      : '';

    return {
      cmd: firstToken.toLowerCase(),
      fullClean: clean.toLowerCase(),
      startPayload,
    };
  }

  private splitLongMessage(text: string, maxLen = 3900): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
      if (splitIdx < maxLen * 0.4) {
        splitIdx = remaining.lastIndexOf('\n', maxLen);
      }
      if (splitIdx < maxLen * 0.4) {
        splitIdx = maxLen;
      }
      chunks.push(remaining.slice(0, splitIdx).trim());
      remaining = remaining.slice(splitIdx).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  // Telegramga xabar yuborish (superguruhga o'tish, 4096 belgi limiti va tugma xatolarini avtomatik hal qiladi)
  public async sendMessage(
    chatId: string | number,
    text: string,
    replyMarkup?: any
  ): Promise<{ ok: boolean; newChatId?: string; error?: string }> {
    if (!this.botToken) return { ok: false, error: 'Token mavjud emas' };

    // Aynan bir lahzada (1.2 soniya ichida) 2 marta bir xil xabar ketib qolishini to'xtatish
    const dedupeKey = `${chatId}_${text.slice(0, 120).trim()}`;
    const lastSent = this.recentSentMessageCache.get(dedupeKey);
    if (lastSent && Date.now() - lastSent < 1200) {
      return { ok: true };
    }

    const chunks = this.splitLongMessage(text);
    const safeMarkup = this.sanitizeReplyMarkupForChat(chatId, replyMarkup);

    try {
      let lastResult: { ok: boolean; newChatId?: string; error?: string } = { ok: true };

      for (let i = 0; i < chunks.length; i++) {
        const isLastChunk = i === chunks.length - 1;
        const body: any = {
          chat_id: chatId,
          text: chunks[i],
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        };
        if (isLastChunk && safeMarkup) {
          body.reply_markup = safeMarkup;
        }

        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        // 1. Guruh superguruhga o'tgan bo'lsa (migrate_to_chat_id)
        if (!data.ok && data.parameters?.migrate_to_chat_id) {
          const newChatId = String(data.parameters.migrate_to_chat_id);
          console.log(`[CloudBot] Guruh superguruhga o'tdi: ${chatId} -> ${newChatId}`);

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
          } catch (dbErr) {
            console.error('[CloudBot] Guruh ID bazada yangilanishda xatolik:', dbErr);
          }

          body.chat_id = newChatId;
          body.reply_markup = isLastChunk ? this.sanitizeReplyMarkupForChat(newChatId, replyMarkup) : undefined;
          const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const retryData = await retryRes.json();
          chatId = newChatId;
          lastResult = { ok: Boolean(retryData.ok), newChatId, error: retryData.description };
          continue;
        }

        // 2. Agar klaviatura/URL yoki HTML tufayli xatolik bo'lsa, xavfsiz fallback bilan qayta yuboramiz!
        if (!data.ok) {
          console.warn(`[CloudBot] sendMessage ogohlantirish (${chatId}): ${data.description}`);
          const desc = String(data.description || '').toLowerCase();
          const isParseError =
            desc.includes('parse entities') ||
            desc.includes('entity') ||
            desc.includes('tag') ||
            desc.includes('html');

          const fallbackBody: any = {
            chat_id: chatId,
            text: isParseError ? chunks[i].replace(/<[^>]+>/g, '') : chunks[i],
            disable_web_page_preview: true,
          };
          if (!isParseError) {
            fallbackBody.parse_mode = 'HTML';
          }
          if (isLastChunk && safeMarkup) {
            fallbackBody.reply_markup = safeMarkup;
          }
          const retryPlain = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fallbackBody),
          });
          const retryPlainData = await retryPlain.json();
          lastResult = { ok: Boolean(retryPlainData.ok), error: retryPlainData.description };
        } else {
          lastResult = { ok: true };
        }
      }

      if (lastResult.ok) {
        this.recentSentMessageCache.set(dedupeKey, Date.now());
        if (this.recentSentMessageCache.size > 2000) {
          const first = this.recentSentMessageCache.keys().next().value;
          if (first) this.recentSentMessageCache.delete(first);
        }
      }
      return lastResult;
    } catch (e: any) {
      console.error(`[CloudBot] sendMessage xatosi (${chatId}):`, e);
      return { ok: false, error: e?.message || 'Tarmoq xatosi' };
    }
  }

  // Admin va guruhlarga bildirishnoma yuborish:
  // MAXFIYLIK HIMOYASI: Guruh chatlariga (`-100...`) faqat `publicText` (moliyaviy jarima summalarisiz),
  // shaxsiy Admin chatlariga esa `privateAdminText || publicText` yuboriladi!
  private async notifyAdmins(
    publicText: string,
    excludeChatId?: string | number,
    privateAdminText?: string
  ) {
    const rawTargets = this.notifyTargetIds.length > 0 ? this.notifyTargetIds : this.adminIds;
    const excludeStr = excludeChatId !== undefined && excludeChatId !== null ? String(excludeChatId).trim() : null;
    const uniqueTargets = Array.from(new Set(rawTargets.map((t) => String(t).trim()))).filter(
      (t) => Boolean(t) && t !== '123456789' && (!excludeStr || t !== excludeStr)
    );
    for (const target of uniqueTargets) {
      try {
        const isGroupTarget = target.startsWith('-');
        const msgToSend = isGroupTarget ? publicText : (privateAdminText || publicText);
        await this.sendMessage(target, msgToSend);
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
      [{ text: '⏱ Mening soatlarim' }, { text: '⚠️ Jarimalarim' }],
      [{ text: "📅 Sana oralig'i" }, { text: '🌐 Veb-portal' }],
    ];

    if (isAdminUser) {
      keyboard.push([{ text: '🔴 Hozir ishda kim bor?' }, { text: '⚠️ Kechikish va Jarimalar' }]);
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
      const cbLockKey = `cb_${cb.id}`;
      const claimed = await this.claimDistributedMessageLock(cbLockKey);
      if (!claimed) return;

      const data = String(cb.data || '');
      const fromId = String(cb.from?.id || '');
      const isAdmUser = this.isAdmin(fromId);
      const targetChatId = cb.message?.chat?.id;

      await this.answerCallbackQuery(cb.id, 'Bajarilmoqda...');

      if (!targetChatId) return;

      if (data === 'quick_checkin') {
        await this.handleCheckIn(targetChatId, fromId, isAdmUser);
        return;
      }

      if (data.startsWith('wakeup_resp:')) {
        const parts = data.split(':');
        const actionType = parts[1]; // 'on_way' | 'late'
        const user = await this.findUserByTelegramId(fromId);
        const workerName = user?.full_name || 'Xodim';

        if (actionType === 'on_way') {
          await this.answerCallbackQuery(cb.id, "🚶‍♂️ Qabul qilindi! Oq yo'l, yetib kelgach '📍 Ishga keldim'ni bosing.", true);
          await this.sendMessage(
            targetChatId,
            `🚶‍♂️ <b>Yo'ldaman deb belgilandi!</b>\n\n` +
            `Rahmat, <b>${escapeHtml(workerName)}</b>! Do'konga yetib kelgach <b>«📍 Ishga keldim»</b> tugmasini bosishni unutmang.`
          );
          // Adminga xabar berish
          await this.notifyAdmins(
            `🚶‍♂️ <b>${escapeHtml(workerName)}</b> ishga yo'lda ekanligini bildirdi.`,
            targetChatId,
            `🚶‍♂️ <b>${escapeHtml(workerName)}</b> ishga yo'lda ekanligini bildirdi (Ertalabki eslatmaga javoban).`
          );
        } else if (actionType === 'late') {
          await this.answerCallbackQuery(cb.id, "⏰ Qayd etildi! Iloji boricha tezroq yetib keling.", true);
          const graceTxt = this.latePenaltyEnabled
            ? `\n\n⚠️ <i>Eslatib o'tamiz: ${this.lateGracePeriodMinutes} daqiqalik ruxsatdan keyin har bir kechikkan daqiqa uchun ${formatUzSum(this.latePenaltyPerMinuteSum)} jarima yoziladi.</i>`
            : '';
          await this.sendMessage(
            targetChatId,
            `⏰ <b>Kechikish haqidagi bildirishnomangiz qabul qilindi!</b>\n` +
            `Iltimos, imkon qadar tezroq yetib kelishga harakat qiling.${graceTxt}`
          );
          // Adminga xabar berish
          await this.notifyAdmins(
            `⏰ <b>${escapeHtml(workerName)}</b> bugun ishga kechikib kelishini bildirdi.`,
            targetChatId,
            `⚠️ <b>Kechikish haqida ogohlantirish:</b> <b>${escapeHtml(workerName)}</b> bugun ishga kechikib kelishini bildirdi!`
          );
        }
        return;
      }

      if (data === 'send_6h_now') {
        if (!isAdmUser) {
          await this.sendMessage(targetChatId, "ℹ️ Ushbu tugma faqat Admin uchun.");
          return;
        }
        const sent = await this.sendSixHourSummary();
        await this.sendMessage(targetChatId, `✅ 6 soatlik monitoring muvaffaqiyatli jo'natildi! (${sent} ta chatga)`);
        return;
      }

      if (data.startsWith('range_preset:')) {
        this.pendingDateRangeUsers.delete(fromId);
        const preset = data.replace('range_preset:', '');
        const tp = getTashkentParts();
        const todayDate = new Date(Date.UTC(tp.year, tp.month - 1, tp.day));
        const fmtIso = (d: Date) =>
          `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

        let rangeArg = '';
        if (preset === 'this_month') {
          rangeArg = `${tp.monthPrefix}-01 ${tp.dateStr}`;
        } else if (preset === 'last_7') {
          const start = new Date(todayDate.getTime() - 6 * 86400000);
          rangeArg = `${fmtIso(start)} ${tp.dateStr}`;
        } else if (preset === 'last_15') {
          const start = new Date(todayDate.getTime() - 14 * 86400000);
          rangeArg = `${fmtIso(start)} ${tp.dateStr}`;
        } else if (preset === 'last_30') {
          const start = new Date(todayDate.getTime() - 29 * 86400000);
          rangeArg = `${fmtIso(start)} ${tp.dateStr}`;
        } else if (preset === 'prev_month') {
          const prevEnd = new Date(Date.UTC(tp.year, tp.month - 1, 0));
          const prevStart = new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), 1));
          rangeArg = `${fmtIso(prevStart)} ${fmtIso(prevEnd)}`;
        }

        if (rangeArg) {
          await this.handleDateRangeReport(targetChatId, fromId, isAdmUser, `/oraliq ${rangeArg}`);
        }
        return;
      }

      return;
    }

    const message = update.message;
    if (!message || !message.from) return;

    const chatId = message.chat.id;
    // Taqsimlangan atomik xabar blokirovkasi: hech qachon bitta xabarga 2 ta server javob qaytarmaydi!
    if (message.message_id !== undefined) {
      const msgLockKey = `msg_${chatId}_${message.message_id}`;
      const claimed = await this.claimDistributedMessageLock(msgLockKey);
      if (!claimed) {
        return;
      }
    }

    const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';
    if (isGroup) {
      const groupStr = String(chatId);
      if (!this.notifyTargetIds.includes(groupStr)) {
        this.notifyTargetIds.push(groupStr);
        try {
          await setDoc(
            doc(db, 'settings', 'general_settings'),
            { group_telegram_id: groupStr },
            { merge: true }
          );
        } catch {}
      }
    }
    const tgUserId = String(message.from.id);
    const firstName = message.from.first_name || 'Foydalanuvchi';
    const isAdm = this.isAdmin(tgUserId);
    const rawText = (message.text || '').trim();

    // Tasodifiy ikki marta bosilib ketishdan himoya (1.2 soniya)
    const dedupeMsgKey = `${chatId}_${tgUserId}_${rawText}`;
    const nowMs = Date.now();
    const lastTime = this.recentMsgCache.get(dedupeMsgKey) || 0;
    if (rawText && nowMs - lastTime < 1200) {
      return;
    }
    if (rawText) {
      this.recentMsgCache.set(dedupeMsgKey, nowMs);
      if (this.recentMsgCache.size > 1000) {
        const firstKey = this.recentMsgCache.keys().next().value;
        if (firstKey) this.recentMsgCache.delete(firstKey);
      }
    }

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
      this.pendingDateRangeUsers.delete(tgUserId);
      await this.handleContact(message);
      return;
    }

    // 1.1 Geolokatsiya yuborilganda (GPS tasdiqlash)
    if (message.location) {
      this.pendingDateRangeUsers.delete(tgUserId);
      await this.handleLocationReceived(message, isAdm, isGroup);
      return;
    }

    // Buyruqni chuqur tozalash va normallashtirish (emojilar, belgilar, bo'sh joylar va apostroflarga chidamli)
    const { cmd, fullClean, startPayload } = this.normalizeCommandText(rawText);

    // 1.2 Bekor qilish tugmasi
    if (cmd === '/bekor' || fullClean.includes('bekor qilish') || fullClean === 'bekor') {
      this.pendingLocationUsers.delete(tgUserId);
      this.pendingCheckoutLocationUsers.delete(tgUserId);
      this.pendingDateRangeUsers.delete(tgUserId);
      await this.sendMessage(chatId, "✅ Amal bekor qilindi.", this.getMainKeyboard(isAdm));
      return;
    }

    // 1.3 Sana oralig'i kiritilayotgan bo'lsa (lekin menyu tugmasi bosilgan bo'lsa, odatiy buyruqqa o'tkazamiz!)
    if (this.pendingDateRangeUsers.has(tgUserId)) {
      const looksLikeDateInput = /\d{1,4}[./-]\d{1,2}/.test(rawText) || /bugun|bu oy|otgan oy|o'tgan oy/i.test(rawText);
      const isMenuOrSlashCommand =
        rawText.startsWith('/') ||
        /^(📍|🏃|☕|▶|⏱|⚠️|⚠|🌐|🔴|🔔|🏆|📢|📊|👥|🏁|📅)/.test(rawText) ||
        fullClean.includes('keldim') ||
        fullClean.includes('ketdim');

      this.pendingDateRangeUsers.delete(tgUserId);
      if (looksLikeDateInput || !isMenuOrSlashCommand) {
        await this.handleDateRangeReport(chatId, tgUserId, isAdm, rawText);
        return;
      }
    }

    // 2. Chat/Guruh ID sini bilish buyrug'i (/id, /chatid, /guruh)
    if (cmd === '/id' || cmd === '/chatid' || cmd === '/guruh' || fullClean === 'id' || fullClean === 'chat id' || fullClean === 'guruh id') {
      const chatType = isGroup ? 'guruh' : 'shaxsiy chat';
      await this.sendMessage(
        chatId,
        `🆔 <b>Ushbu ${chatType} ID raqami:</b> <code>${chatId}</code>\n\n` +
          `<i>Nusxa olish uchun raqam ustiga bosing va tizim sozlamalariga kiriting!</i>`
      );
      return;
    }

    // 2.5 Bot statusi va nusxalar soni
    if (cmd === '/status' || cmd === '/bot' || cmd === '/nechta' || fullClean === 'bot' || fullClean === 'status') {
      const webhookInfo = await this.getWebhookInfo().catch(() => null);
      const extUrl = webhookInfo?.result?.url;
      const tp = getTashkentParts();
      await this.sendMessage(
        chatId,
        `🤖 <b>${escapeHtml(this.shopName)} — Bot Tizimi Holati:</b>\n\n` +
          `• <b>Bot:</b> @${this.botUsername || 'navodavomat_bot'}\n` +
          `• <b>Faol yagona server:</b> <code>${this.instanceId}</code> (v${this.leaderPriority})\n` +
          `• <b>Ishlash rejimi:</b> 24/7 Google Cloud Long Polling (Tezkor va barqaror)\n` +
          `• <b>Tashqi Webhook:</b> ${extUrl ? `⚠️ Faol (${extUrl})` : `✅ Tozalangan (xalaqit yo'q)`}\n` +
          `• <b>Kechikish jarimasi:</b> ${this.latePenaltyEnabled ? `✅ Faol (${this.lateGracePeriodMinutes} daq ruxsat, 1 daq = ${this.latePenaltyPerMinuteSum.toLocaleString()} so'm)` : `⏸ O'chiq`}\n` +
          `• <b>Dublikat himoyasi:</b> ✅ Atomik Xotira Qulfi + Leader Himoyasi (100%)\n` +
          `• <b>Toshkent vaqti:</b> ${tp.dateStr} ${tp.timeStr}\n` +
          `• <b>Qayta ishlangan buyruqlar:</b> ${this.updatesProcessedCount} ta\n` +
          `• <b>Oxirgi faollik:</b> ${this.lastUpdateReceivedAt || 'Hozirgina'}`
      );
      return;
    }

    // 3. /start buyrug'i (va deep-link qo'llab-quvvatlashi)
    if (cmd === '/start') {
      if (startPayload === 'portal' && !isGroup) {
        await this.handleAppCommand(chatId, tgUserId, isAdm);
        return;
      }
      if (startPayload === 'jarima' && !isGroup) {
        await this.handleLatePenaltiesCommand(chatId, tgUserId, isAdm);
        return;
      }
      if (startPayload === 'keldim' && !isGroup) {
        await this.handleCheckIn(chatId, tgUserId, isAdm);
        return;
      }
      if (isGroup) {
        await this.sendMessage(
          chatId,
          `🏪 <b>${escapeHtml(this.shopName)}</b> davomat boti guruhda faol!\n\n` +
            `Guruhda ishlatiladigan buyruqlar:\n` +
            `📍 <b>/keldim</b> — Ishga kelganingizni qayd etish\n` +
            `🏃‍♂️ <b>/ketdim</b> — Ishdan ketganingizni qayd etish\n` +
            `☕️ <b>/tanaffus</b> — Tanaffusga chiqish\n` +
            `▶️ <b>/qaytdim</b> — Tanaffusdan qaytish\n` +
            `⏱ <b>/soat</b> — Oylik ishlagan soatlaringiz\n` +
            `⚠️ <b>/jarima</b> — Shaxsiy kechikish va jarimalar (shaxsiy botda)\n` +
            `📅 <b>/oraliq</b> — Sanalar oralig'i hisoboti\n` +
            `📅 <b>/bugun</b> — Bugungi davomat ro'yxati\n` +
            `🆔 <b>/id</b> — Ushbu guruh ID raqamini ko'rish\n\n` +
            `<i>Yangi xodimlar tizimda to'liq ro'yxatdan o'tish uchun botga shaxsiy xabar yozing: @${this.botUsername || 'navodavomat_bot'}</i>`
        );
      } else {
        await this.handleStart(chatId, tgUserId, firstName, isAdm);
      }
      return;
    }

    // 4. Davomat buyruqlari (har qanday variantda xatoliksiz aniqlanadi)
    const isCheckIn =
      cmd === '/keldim' ||
      cmd === '/in' ||
      cmd === 'keldim' ||
      fullClean === 'keldim' ||
      fullClean.includes('ishga keldim') ||
      fullClean.includes('ishga kelish') ||
      (fullClean.startsWith('📍') && fullClean.includes('keldim'));

    const isCheckOut =
      cmd === '/ketdim' ||
      cmd === '/out' ||
      cmd === 'ketdim' ||
      fullClean === 'ketdim' ||
      fullClean.includes('ishdan ketdim') ||
      fullClean.includes('ishdan ketish') ||
      (fullClean.startsWith('🏃') && fullClean.includes('ketdim'));

    const isBreakStart =
      cmd === '/tanaffus' ||
      cmd === '/break' ||
      cmd === 'tanaffus' ||
      fullClean.includes('tanaffusga chiqish') ||
      (fullClean.includes('tanaffus') && !fullClean.includes('qayt'));

    const isBreakEnd =
      cmd === '/qaytdim' ||
      cmd === '/resume' ||
      cmd === 'qaytdim' ||
      fullClean.includes('tanaffusdan qaytish') ||
      fullClean.includes('ishga qaytdim') ||
      fullClean === 'qaytdim';

    const isMyHours =
      cmd === '/soat' ||
      cmd === '/soatlarim' ||
      cmd === '/vaqtim' ||
      cmd === 'soat' ||
      fullClean === 'soat' ||
      fullClean === 'soatlarim' ||
      fullClean.includes('mening soatlarim');

    const isPenalties =
      cmd === '/jarima' ||
      cmd === '/jarimalar' ||
      cmd === '/jarimalarim' ||
      cmd === 'jarima' ||
      fullClean === 'jarima' ||
      fullClean === 'jarimalar' ||
      fullClean.includes('jarimalar') ||
      fullClean.includes('kechikish va jarima');

    const isLive =
      cmd === '/live' ||
      cmd === 'live' ||
      fullClean.includes('hozir ishda kim bor') ||
      fullClean.includes('kim ishda');

    const isKpi =
      cmd === '/kpi' ||
      cmd === '/reyting' ||
      cmd === 'kpi' ||
      fullClean.includes('kpi') ||
      fullClean.includes('reyting');

    const isReport =
      cmd === '/hisobot' ||
      cmd === 'hisobot' ||
      fullClean.includes('oylik umumiy hisobot') ||
      fullClean === 'hisobot';

    const isWorkers =
      cmd === '/ishchilar' ||
      cmd === 'ishchilar' ||
      fullClean.includes('ishchilar ro');

    const isToday =
      cmd === '/bugun' ||
      cmd === 'bugun' ||
      fullClean === 'bugun' ||
      fullClean.includes('bugungi davomat') ||
      fullClean.includes('bugungi hisobot');

    const isDateRange =
      cmd.startsWith('/oraliq') ||
      cmd.startsWith('/davr') ||
      cmd.startsWith('/range') ||
      fullClean.includes("sana oralig");

    const isApp =
      cmd === '/app' ||
      cmd === '/webapp' ||
      cmd === '/portal' ||
      cmd === 'portal' ||
      fullClean.includes('veb-portal') ||
      fullClean.includes('veb portal') ||
      fullClean === 'portal';

    const isMonitoring =
      cmd === '/monitoring' ||
      cmd === '/send6h' ||
      cmd === '/xulosa6h' ||
      fullClean.includes('6 soatlik monitoring') ||
      fullClean === 'monitoring';

    const isReminders =
      cmd === '/eslatma' ||
      cmd === '/eslatmalar' ||
      fullClean.includes('eslatma');

    const isDailyClosing =
      cmd === '/kunyakun' ||
      cmd === '/bugunyakun' ||
      cmd === '/yopilish' ||
      fullClean.includes('kunlik hisobot') ||
      fullClean.includes('kun yakun');

    const isHelp =
      cmd === '/help' ||
      cmd === '/yordam' ||
      fullClean === 'help' ||
      fullClean === 'yordam';

    if (isCheckIn) {
      await this.handleCheckIn(chatId, tgUserId, isAdm);
    } else if (isBreakStart) {
      await this.handleBreakStart(chatId, tgUserId);
    } else if (isBreakEnd) {
      await this.handleBreakEnd(chatId, tgUserId);
    } else if (isCheckOut) {
      await this.handleCheckOut(chatId, tgUserId);
    } else if (isMyHours) {
      await this.handleMyHours(chatId, tgUserId);
    } else if (isPenalties) {
      await this.handleLatePenaltiesCommand(chatId, tgUserId, isAdm);
    } else if (isLive) {
      if (isAdm) {
        await this.handleAdminLive(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Ushbu ma'lumot faqat do'kon ma'muri (Admin) uchun ochiq. O'zingizning ishlagan vaqtingizni ko'rish uchun <b>'⏱ Mening soatlarim'</b> tugmasini bosing.`
        );
      }
    } else if (isKpi) {
      await this.handleKpiRatingCommand(chatId);
    } else if (isReport) {
      if (isAdm) {
        await this.handleAdminReport(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Oylik umumiy hisobot faqat do'kon ma'muri (Admin) uchun ochiq. Shaxsiy soatlaringizni <b>'⏱ Mening soatlarim'</b> orqali bilib olasiz.`
        );
      }
    } else if (isWorkers) {
      if (isAdm) {
        await this.handleAdminWorkers(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Ishchilar ro'yxati faqat do'kon ma'muri uchun ochiq.`
        );
      }
    } else if (isToday) {
      await this.handleTodaySummary(chatId, tgUserId, isAdm);
    } else if (isDateRange) {
      await this.handleDateRangeReport(chatId, tgUserId, isAdm, rawText);
    } else if (isApp) {
      await this.handleAppCommand(chatId, tgUserId, isAdm);
    } else if (isMonitoring) {
      if (isAdm) {
        await this.handleSend6hCommand(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ 6 soatlik monitoring xulosasini faqat Admin yuborishi mumkin.`
        );
      }
    } else if (isReminders) {
      if (isAdm) {
        await this.handleAdminRemindersCommand(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Eslatmalar menyusi faqat do'kon ma'muri uchun ochiq.`
        );
      }
    } else if (isDailyClosing) {
      if (isAdm) {
        await this.handleDailyClosingReportCommand(chatId);
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Kunlik yakuniy hisobot faqat do'kon ma'muri uchun ochiq.`
        );
      }
    } else if (isHelp) {
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

  // --- Kontaktni qabul qilish (Telefon raqamni oxirgi 9 ta raqami bo'yicha aniq moslashtiradi) ---
  private async handleContact(message: any) {
    const tgUserId = String(message.from.id);
    const contact = message.contact;
    const rawPhone = contact.phone_number || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const last9Digits = cleanPhone.slice(-9);
    const standardPhone = cleanPhone.startsWith('998')
      ? cleanPhone
      : cleanPhone.length === 9
      ? '998' + cleanPhone
      : cleanPhone;

    const fName = (message.from.first_name || '').trim();
    const lName = (message.from.last_name || '').trim();
    const fullName = `${fName} ${lName}`.trim() || 'Xodim';

    // Firestore dagi mavjud xodimlarni tekshirish (dublikat profil ochilib ketmasligi uchun!)
    const usersSnap = await getDocs(collection(db, 'users'));
    let matchedDoc: User | null = null;
    usersSnap.forEach((d) => {
      const u = d.data() as User;
      const uId = Number(u.id || d.id);
      const uTg = String(u.telegram_id || '').trim();
      const uPhoneDigits = String(u.phone || '').replace(/\D/g, '');
      if (uTg === tgUserId) {
        matchedDoc = { ...u, id: uId };
      } else if (!matchedDoc && last9Digits.length === 9 && uPhoneDigits.slice(-9) === last9Digits) {
        matchedDoc = { ...u, id: uId };
      }
    });

    let finalUserId: number;
    let finalUser: User;

    if (matchedDoc) {
      const existing = matchedDoc as User;
      finalUserId = existing.id;
      finalUser = {
        ...existing,
        telegram_id: tgUserId,
        phone: existing.phone || `+${standardPhone}`,
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
      `👤 <b>Xodim Telegram orqali ulandi:</b>\n` +
        `Ism: <b>${escapeHtml(finalUser.full_name)}</b>\n` +
        `Tel: ${finalUser.phone}`,
      message.chat.id
    );
  }

  // --- 📍 Ishga keldim ---
  private async handleCheckIn(
    chatId: number,
    tgUserId: string,
    isAdm: boolean,
    coords?: { lat: number; lon: number; dist: number }
  ) {
    // MUHIM: Lokatsiya yuborilganda (`coords` mavjud bo'lganda) oldingi so'rov qulfi uni to'sib qo'ymasligi uchun alohida kalit ishlatiladi!
    const lockKey = coords ? `checkin_gps_${tgUserId}` : `checkin_req_${tgUserId}`;
    const lastAction = this.userActionLocks.get(lockKey);
    if (lastAction && Date.now() - lastAction < 800) {
      return;
    }
    this.userActionLocks.set(lockKey, Date.now());

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

      // Agar avvalgi smena eski kungi bo'lsa, xavfsiz yopamiz
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
        const oldPenalty = calculateLatePenaltyAmount(
          activeShift.check_in_time,
          user.work_start_time || '08:00',
          1,
          this.getPenaltySettings()
        );

        await setDoc(
          doc(db, 'attendance', String(activeShift.id)),
          {
            status: 'completed',
            check_out_date: activeShift.date,
            check_out_time: `${endTime}:00`,
            worked_minutes: resolvedMinutes,
            late_minutes: oldPenalty.lateMinutes,
            chargeable_late_minutes: oldPenalty.chargeableLateMinutes,
            late_penalty: oldPenalty.penaltyAmount,
            note: "Avvalgi kungi unutilgan smena ish rejasi bo'yicha avtomatik yopildi",
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
      if (isGroup && !isAdm) {
        // Guruhda oddiy xodimlar do'konda ekanligini GPS orqali tasdiqlashi shart (bitta joyda ishlashi uchun)
        await this.sendMessage(
          chatId,
          `📍 <b>${escapeHtml(user.full_name)}</b>, do'kon qoidasiga ko'ra ishga kelish geolokatsiya (GPS) orqali faqat do'konda tasdiqlanadi!\n\n` +
            `Iltimos, botga shaxsiy xabar yozing: @${this.botUsername || 'navodavomat_bot'} va pastdagi <b>«📍 Ishga keldim»</b> tugmasi orqali do'kondagi lokatsiyangizni yuboring.`
        );
        return;
      }
      if (!isGroup) {
        this.pendingLocationUsers.set(tgUserId, {
          chatId,
          isAdm,
          isGroup,
          timestamp: Date.now(),
        });

        await this.sendMessage(
          chatId,
          `📍 <b>Do'konda ekanligingizni tasdiqlash uchun geolokatsiyangizni yuboring!</b>\n\n` +
            `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
            `📏 Ruxsat etilgan masofa: <b>${this.gpsRadiusMeters} metr</b> (bino ichida GPS xatoligi hisobi bilan 250m gacha qabul qilinadi)\n\n` +
            `👇 Pastdagi <b>«📍 Do'kondan lokatsiya yuborish»</b> tugmasini bosing:`,
          {
            keyboard: [
              [{ text: "📍 Do'kondan lokatsiya yuborish", request_location: true }],
              [{ text: '❌ Bekor qilish' }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        );
        return;
      }
    }

    // Bugungi yakunlangan smenalar sonini bilish
    const completedToday = await this.countCompletedShiftsToday(user.id, todayStr);
    const shiftNum = completedToday + 1;
    const isFirstShift = completedToday === 0;

    // Boshliq va adminlar hech qachon kechikish jarimasiga tortilmaydi!
    const isBossOrAdmin =
      isAdm ||
      user.role === 'admin' ||
      /boshliq|admin|rahbar|direktor|owner/i.test(user.position || '');

    // Kechikish va jarimani jonli Firestore sozlamalari bo'yicha hisoblash
    const penaltyRes = isBossOrAdmin
      ? { lateMinutes: 0, chargeableLateMinutes: 0, penaltyAmount: 0 }
      : calculateLatePenaltyAmount(
          timeStr,
          user.work_start_time || '08:00',
          shiftNum,
          this.getPenaltySettings()
        );

    // Yangi smena yaratish va jarimani Attendance ob'ektiga yozish
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
      ...(coords ? { check_in_lat: coords.lat, check_in_lon: coords.lon } : {}),
      total_break_minutes: 0,
      worked_minutes: 0,
      late_minutes: penaltyRes.lateMinutes,
      chargeable_late_minutes: penaltyRes.chargeableLateMinutes,
      late_penalty: penaltyRes.penaltyAmount,
      status: 'working',
      created_at: now.toISOString(),
      note: locNote,
    };

    await setDoc(doc(db, 'attendance', String(newAttId)), newAttendance);

    const shiftText = completedToday > 0 ? ` (${shiftNum}-smena)` : '';
    let lateNote = '';
    let privatePenaltyNote = '';
    if (isFirstShift) {
      if (penaltyRes.lateMinutes > 0) {
        lateNote = `\n⚠️ Rejadan kechikish: <b>${penaltyRes.lateMinutes} daqiqa</b> (Reja: ${user.work_start_time || '08:00'})`;
        if (this.latePenaltyEnabled) {
          if (penaltyRes.penaltyAmount > 0) {
            privatePenaltyNote = `\n⚠️ Kechikish jarimasi: <b>${formatUzSum(penaltyRes.penaltyAmount)}</b> (${this.lateGracePeriodMinutes} daq ruxsatdan keyin ${penaltyRes.chargeableLateMinutes} daq × ${this.latePenaltyPerMinuteSum.toLocaleString()} so'm)`;
          } else {
            privatePenaltyNote = `\nℹ️ Kechikish ${this.lateGracePeriodMinutes} daqiqalik ruxsat ichida — jarima yozilmadi (0 so'm)`;
          }
        }
      } else {
        lateNote = `\n✅ O'z vaqtida keldi (Reja: ${user.work_start_time || '08:00'})`;
      }
    } else {
      lateNote = `\n🔄 <b>${shiftNum}-smena</b> (Qaytadan kirish — kechikish hisoblanmaydi)`;
    }

    const locTextForUser = coords
      ? `\n📍 Lokatsiya: <b>Do'konda (GPS tasdiqlandi: ${coords.dist}m)</b>`
      : '';

    // MAXFIYLIK: Guruhda javob qaytganda jarima summasi boshqa xodimlarga oshkor qilinmaydi!
    const workerReplyPenalty = !isGroup ? privatePenaltyNote : '';

    await this.sendMessage(
      chatId,
      `✅ <b>Ishga kelganingiz qayd etildi!${shiftText}</b>\n\n` +
        `👤 Xodim: <b>${escapeHtml(user.full_name)}</b>\n` +
        `🕒 Kelgan vaqt: <b>${timeStr.slice(0, 5)}</b> (${todayStr})` +
        locTextForUser +
        `${lateNote}` +
        `${workerReplyPenalty}\n\n` +
        `Kuningiz barakali va sermahsul o'tsin!`,
      this.getMainKeyboard(isAdm)
    );

    // Agar xodim guruh ichida /keldim bosgan bo'lsa va unga jarima yozilgan bo'lsa, faqat o'zining shaxsiy chatiga maxfiy xabar yuboramiz
    if (isGroup && penaltyRes.penaltyAmount > 0 && tgUserId) {
      this.sendMessage(
        tgUserId,
        `🔒 <b>Shaxsiy bildirishnoma (${escapeHtml(this.shopName)}):</b>\n` +
          `Bugun (${todayStr}) smenaga <b>${penaltyRes.lateMinutes} daqiqa</b> kechikib kelganingiz sababli (${this.lateGracePeriodMinutes} daq ruxsatdan tashqari ${penaltyRes.chargeableLateMinutes} daq) hisobingizga <b>${formatUzSum(penaltyRes.penaltyAmount)}</b> jarima qayd etildi.\n\n` +
          `<i>Batafsil ko'rish uchun: /jarima</i>`
      ).catch(() => {});
    }

    const adminLocLine = coords
      ? `📍 Masofa: <b>Do'konda (${coords.dist} metr)</b>\n`
      : '';

    const publicGroupNotify =
      `🟢 <b>Ishga keldi:</b> ${escapeHtml(user.full_name)}\n` +
      `🕒 Vaqt: <b>${timeStr.slice(0, 5)}</b> (${todayStr})\n` +
      adminLocLine +
      `Smena: <b>${shiftNum}</b>${isFirstShift ? (penaltyRes.lateMinutes > 0 ? ` (⚠️ ${penaltyRes.lateMinutes} daq kechikdi)` : ` (✅ O'z vaqtida)`) : " (Qaytadan kirish — kechikish yo'q)"}`;

    const privateAdminNotify =
      publicGroupNotify +
      (privatePenaltyNote ? `${privatePenaltyNote}` : '');

    await this.notifyAdmins(publicGroupNotify, chatId, privateAdminNotify);
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

    const allowedRadius = Math.max(this.gpsRadiusMeters + 150, 250);
    if (this.gpsRequired && roundedDist > allowedRadius) {
      await this.sendMessage(
        chatId,
        `❌ <b>Siz do'kondan juda uzoqdasiz (${roundedDist} metr)!</b>\n\n` +
          `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
          `📏 Ruxsat etilgan radius: <b>${this.gpsRadiusMeters} metr</b> (GPS xatoligi hisobi bilan ${allowedRadius}m).\n\n` +
          `Ishga kelish faqat do'konda (bitta joyda) qabul qilinadi. Haqiqatda do'konga yetib borgach qaytadan lokatsiya yuboring.` +
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
        `🕒 Vaqt: <b>${timeStr}</b>`,
      chatId
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
        `🕒 Vaqt: <b>${timeStr}</b> (Tanaffus: ${formatMinutes(breakMinutes)})`,
      chatId
    );
  }

  // --- 🏃‍♂️ Ishdan ketdim ---
  private async handleCheckOut(
    chatId: number,
    tgUserId: string,
    coords?: { lat: number; lon: number; dist: number }
  ) {
    const lockKey = coords ? `checkout_gps_${tgUserId}` : `checkout_req_${tgUserId}`;
    const lastAction = this.userActionLocks.get(lockKey);
    if (lastAction && Date.now() - lastAction < 2500) {
      return;
    }
    this.userActionLocks.set(lockKey, Date.now());

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
    const isAdm = this.isAdmin(tgUserId);

    // AGAR KETISHDA GPS MAJBURIY BO'LSA VA LOKATSIYA HALI TASDIQLANMAGAN BO'LSA:
    if (this.gpsCheckoutRequired && !coords && !isGroup) {
      this.pendingCheckoutLocationUsers.set(tgUserId, {
        chatId,
        isAdm,
        isGroup,
        timestamp: Date.now(),
      });

      await this.sendMessage(
        chatId,
        `📍 <b>Ishdan ketayotganingizni tasdiqlash uchun geolokatsiyangizni yuboring!</b>\n\n` +
          `🏢 Do'kon: <b>${escapeHtml(this.shopName)}</b>\n` +
          `📏 Ruxsat etilgan masofa: <b>${this.gpsRadiusMeters} metr</b>\n\n` +
          `👇 Pastdagi <b>«📍 Do'kondan lokatsiya yuborish (Ketish)»</b> tugmasini bosing:`,
        {
          keyboard: [
            [{ text: "📍 Do'kondan lokatsiya yuborish (Ketish)", request_location: true }],
            [{ text: '❌ Bekor qilish' }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        }
      );
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

    // Ushbu smena kunning nechanchi smenasi ekanligini aniqlab, kechikish jarimasini Attendance ob'ektiga saqlash
    const sameDaySnap = await getDocs(
      query(
        collection(db, 'attendance'),
        where('user_id', '==', user.id),
        where('date', '==', activeShift.date)
      )
    );
    const sameDayList: Attendance[] = [];
    sameDaySnap.forEach((d) => {
      const raw = d.data() as Attendance;
      sameDayList.push({ ...raw, id: Number(raw.id || d.id) });
    });
    sameDayList.sort(
      (a, b) => (a.check_in_time || '').localeCompare(b.check_in_time || '') || a.id - b.id
    );
    const shiftIdx = Math.max(1, sameDayList.findIndex((item) => item.id === activeShift.id) + 1);

    const isBossOrAdmin =
      isAdm ||
      user.role === 'admin' ||
      /boshliq|admin|rahbar|direktor|owner/i.test(user.position || '');

    const penaltyInfo = isBossOrAdmin
      ? { lateMinutes: 0, chargeableLateMinutes: 0, penaltyAmount: 0 }
      : calculateLatePenaltyAmount(
          activeShift.check_in_time,
          user.work_start_time || '08:00',
          shiftIdx,
          this.getPenaltySettings()
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
        late_minutes: penaltyInfo.lateMinutes,
        chargeable_late_minutes: penaltyInfo.chargeableLateMinutes,
        late_penalty: penaltyInfo.penaltyAmount,
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

    const privateCheckoutPenaltyLine =
      this.latePenaltyEnabled && penaltyInfo.penaltyAmount > 0
        ? `\n⚠️ Smena kechikish jarimasi: <b>${formatUzSum(penaltyInfo.penaltyAmount)}</b> (${penaltyInfo.lateMinutes} daq kechikish, ${penaltyInfo.chargeableLateMinutes} daq jarima)`
        : '';

    await this.sendMessage(
      chatId,
      `🏁 <b>Ishdan ketganingiz qayd etildi!</b>\n\n` +
        `👤 Xodim: <b>${escapeHtml(user.full_name)}</b>\n` +
        `🟢 Kelgan: <b>${activeShift.check_in_time.slice(0, 5)}</b> | 🔴 Ketgan: <b>${timeStr.slice(0, 5)}</b>\n` +
        `⏱ Ushbu smenada: <b>${formattedWorked}</b>${breakText}` +
        locTextForUser +
        (!isGroup ? privateCheckoutPenaltyLine : '') +
        `\n\n` +
        `📊 <b>Bugun jami ishlangan:</b> <b>${formattedTodayTotal}</b>\n\n` +
        `💡 <i>Agar bugun yana qaytib kelsangiz, istalgan vaqt '📍 Ishga keldim'ni bosishingiz mumkin!</i>`,
      this.getMainKeyboard(isAdm)
    );

    const adminLocLine = coords
      ? `📍 Ketish masofasi: <b>Do'konda (${coords.dist} metr)</b>\n`
      : '';

    const publicGroupNotify =
      `🔴 <b>Ishdan ketdi:</b> ${escapeHtml(user.full_name)}\n` +
      `⏱ Smena: <b>${formattedWorked}</b>${breakText}\n` +
      adminLocLine +
      `📊 Bugungi jami: <b>${formattedTodayTotal}</b>`;

    const privateAdminNotify = publicGroupNotify + privateCheckoutPenaltyLine;

    await this.notifyAdmins(publicGroupNotify, chatId, privateAdminNotify);

    // BARCHA ISHCHILAR ISHINI TUGATGANLIGINI TEKSHIRISH:
    await this.checkAndTriggerDailyClosingReportIfAllFinished(todayStr);
  }

  // --- ⚠️ Kechikish va Jarimalar (Shaxsiy xodim uchun faqat o'ziniki, Admin uchun barchaniki!) ---
  private async handleLatePenaltiesCommand(chatId: number, tgUserId: string, isAdm: boolean) {
    const isGroup = chatId < 0;
    // MAXFIYLIK HIMOYASI: Guruh chatda hech kimning jarimasi hammaga oshkor qilinmaydi!
    if (isGroup) {
      const botLink = this.botUsername
        ? `https://t.me/${this.botUsername}?start=jarima`
        : '';
      await this.sendMessage(
        chatId,
        `🔒 <b>Maxfiylik himoyasi:</b>\n` +
          `Kechikish jarimalari shaxsiy ma'lumot hisoblanadi va guruhda boshqa xodimlarga oshkor qilinmaydi.\n\n` +
          `👉 Shaxsiy jarimalaringizni ko'rish uchun botning o'ziga yozing: ${this.botUsername ? `@${this.botUsername}` : 'Shaxsiy bot'}`,
        botLink
          ? {
              inline_keyboard: [[{ text: '🔒 Shaxsiy Jarimalarimni Ko\'rish', url: botLink }]],
            }
          : undefined
      );
      return;
    }

    const tp = getTashkentParts();
    const currentMonthPrefix = tp.monthPrefix;
    const penaltySettings = this.getPenaltySettings();

    if (isAdm) {
      const usersSnap = await getDocs(collection(db, 'users'));
      const workers: User[] = [];
      usersSnap.forEach((d) => {
        const u = d.data() as User;
        if (u.role === 'worker' && u.is_active !== false) {
          workers.push({ ...u, id: Number(u.id || d.id) });
        }
      });

      const attSnap = await getDocs(collection(db, 'attendance'));
      const shiftsByUserDate = new Map<string, Attendance[]>();
      attSnap.forEach((d) => {
        const a = d.data() as Attendance;
        if (a.date && a.date.startsWith(currentMonthPrefix)) {
          const key = `${a.user_id}_${a.date}`;
          const list = shiftsByUserDate.get(key) || [];
          list.push(a);
          shiftsByUserDate.set(key, list);
        }
      });

      let storeTotalPenalty = 0;
      let text =
        `⚠️ <b>${escapeHtml(this.shopName)} — KECHIKISH VA JARIMALAR NAZORATI (ADMIN)</b>\n` +
        `🗓 Oy: <b>${String(tp.month).padStart(2, '0')}.${tp.year}</b>\n` +
        `⚙️ Qoida: <b>${this.lateGracePeriodMinutes} daqiqa ruxsat</b> · Har bir oshgan daqiqa = <b>${formatUzSum(this.latePenaltyPerMinuteSum)}</b>\n` +
        ` holati: <b>${this.latePenaltyEnabled ? 'Faol ✅' : "O'chiq ⏸"}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n`;

      if (workers.length === 0) {
        text += `<i>Hozircha faol ishchilar topilmadi.</i>`;
      } else {
        workers.forEach((w, idx) => {
          let lateDays = 0;
          let lateMinsTotal = 0;
          let chargeableTotal = 0;
          let penaltyTotal = 0;

          shiftsByUserDate.forEach((shifts, key) => {
            if (!key.startsWith(`${w.id}_`)) return;
            shifts.sort((a, b) => (a.check_in_time || '').localeCompare(b.check_in_time || ''));
            const first = shifts[0];
            if (first?.check_in_time) {
              const res = calculateLatePenaltyAmount(
                first.check_in_time,
                w.work_start_time || '08:00',
                1,
                penaltySettings
              );
              if (res.lateMinutes > 0) {
                lateDays += 1;
                lateMinsTotal += res.lateMinutes;
                chargeableTotal += res.chargeableLateMinutes;
                penaltyTotal += res.penaltyAmount;
              }
            }
          });

          storeTotalPenalty += penaltyTotal;
          text += `${idx + 1}. 👤 <b>${escapeHtml(w.full_name)}</b> (Reja: ${w.work_start_time || '08:00'})\n`;
          if (lateDays === 0) {
            text += `   ✅ Kechikish yo'q — <b>0 so'm</b>\n\n`;
          } else {
            text += `   • Kechikkan kunlar: <b>${lateDays} kun</b> (jami ${lateMinsTotal} daq, jarimali: ${chargeableTotal} daq)\n`;
            text += `   • Hisoblangan jarima: <b>${formatUzSum(penaltyTotal)}</b>\n\n`;
          }
        });

        text += `━━━━━━━━━━━━━━━━━━━\n`;
        text += `💰 <b>Oy bo'yicha jami kechikish jarimalari:</b> <b>${formatUzSum(storeTotalPenalty)}</b>\n`;
        text += `<i>⚙️ Ruxsat daqiqasi va summani Veb-Portal → Sozlamalar bo'limidan o'zgartirishingiz mumkin.</i>`;
      }

      await this.sendMessage(chatId, text);
      return;
    }

    // Oddiy xodim (faqat o'zining shaxsiy jarimasini ko'radi!)
    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(chatId, `Iltimos, avval /start buyrug'ini bosing va ro'yxatdan o'ting.`);
      return;
    }

    const attSnap = await getDocs(
      query(collection(db, 'attendance'), where('user_id', '==', user.id))
    );
    const byDate = new Map<string, Attendance[]>();
    attSnap.forEach((d) => {
      const a = d.data() as Attendance;
      if (a.date && a.date.startsWith(currentMonthPrefix)) {
        const list = byDate.get(a.date) || [];
        list.push(a);
        byDate.set(a.date, list);
      }
    });

    const lateItems: {
      date: string;
      inTime: string;
      lateMins: number;
      chargeableMins: number;
      penalty: number;
    }[] = [];
    let totalChargeable = 0;
    let totalPenalty = 0;

    Array.from(byDate.keys())
      .sort((a, b) => b.localeCompare(a))
      .forEach((dateStr) => {
        const shifts = byDate.get(dateStr) || [];
        shifts.sort((a, b) => (a.check_in_time || '').localeCompare(b.check_in_time || ''));
        const first = shifts[0];
        if (first?.check_in_time) {
          const res = calculateLatePenaltyAmount(
            first.check_in_time,
            user.work_start_time || '08:00',
            1,
            penaltySettings
          );
          if (res.lateMinutes > 0) {
            totalChargeable += res.chargeableLateMinutes;
            totalPenalty += res.penaltyAmount;
            lateItems.push({
              date: dateStr,
              inTime: first.check_in_time.slice(0, 5),
              lateMins: res.lateMinutes,
              chargeableMins: res.chargeableLateMinutes,
              penalty: res.penaltyAmount,
            });
          }
        }
      });

    let text =
      `⚠️ <b>SHAXSIY KECHIKISH VA JARIMALAR HISOBI</b>\n` +
      `👤 Xodim: <b>${escapeHtml(user.full_name)}</b>\n` +
      `🗓 Oy: <b>${String(tp.month).padStart(2, '0')}.${tp.year}</b> | Ish boshlanishi: <b>${user.work_start_time || '08:00'}</b>\n` +
      `📌 Tartib: <b>${this.lateGracePeriodMinutes} daqiqagacha ruxsat</b>, undan oshgan har 1 daqiqa uchun <b>${formatUzSum(this.latePenaltyPerMinuteSum)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n`;

    if (!this.latePenaltyEnabled) {
      text += `ℹ️ <i>Hozirda do'kon ma'muriyati tomonidan kechikish jarimasi o'chirib qo'yilgan.</i>`;
    } else if (lateItems.length === 0) {
      text += `✅ <b>Ushbu oyda sizda kechikish va jarimalar yo'q (0 so'm). Barakalla!</b>`;
    } else {
      text += `💰 <b>Jami hisoblangan jarima:</b> <b>${formatUzSum(totalPenalty)}</b> (${totalChargeable} daqiqa jarima)\n\n`;
      text += `📅 <b>Kechikib kelingan kunlar (${lateItems.length} kun):</b>\n`;
      lateItems.slice(0, 15).forEach((item) => {
        const detail =
          item.chargeableMins > 0
            ? `<b>${formatUzSum(item.penalty)}</b> (${item.chargeableMins} daq jarima)`
            : `0 so'm (${this.lateGracePeriodMinutes} daq ruxsat ichida)`;
        text += `• ${item.date.slice(5)}: <b>${item.inTime}</b> (+${item.lateMins} daq) ➡️ ${detail}\n`;
      });
    }

    text += `\n\n🔒 <i>Ushbu ma'lumot maxfiy: faqat sizga va do'kon ma'muriga ko'rinadi.</i>`;
    await this.sendMessage(chatId, text);
  }

  // --- ⏱ Mening soatlarim ---
  private async handleMyHours(chatId: number, tgUserId: string) {
    const user = await this.findUserByTelegramId(tgUserId);
    if (!user) {
      await this.sendMessage(chatId, `Iltimos, avval /start bosing.`);
      return;
    }

    const tp = getTashkentParts();
    const currentMonthPrefix = tp.monthPrefix;
    const isGroup = chatId < 0;

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

    // Faqat shaxsiy chatda xodimning o'ziga oylik kechikish jarimasini ham ko'rsatamiz
    let personalPenaltyLine = '';
    if (!isGroup && this.latePenaltyEnabled) {
      const byDate = new Map<string, Attendance[]>();
      monthlyShifts.forEach((s) => {
        const list = byDate.get(s.date) || [];
        list.push(s);
        byDate.set(s.date, list);
      });
      if (active && active.date.startsWith(currentMonthPrefix)) {
        const list = byDate.get(active.date) || [];
        list.push(active);
        byDate.set(active.date, list);
      }
      let monthPenalty = 0;
      let monthChargeableMins = 0;
      byDate.forEach((shifts) => {
        shifts.sort((a, b) => (a.check_in_time || '').localeCompare(b.check_in_time || ''));
        if (shifts[0]?.check_in_time) {
          const pen = calculateLatePenaltyAmount(
            shifts[0].check_in_time,
            user.work_start_time || '08:00',
            1,
            this.getPenaltySettings()
          );
          monthPenalty += pen.penaltyAmount;
          monthChargeableMins += pen.chargeableLateMinutes;
        }
      });
      personalPenaltyLine =
        monthPenalty > 0
          ? `⚠️ Kechikish jarimasi (shaxsiy): <b>${formatUzSum(monthPenalty)}</b> (${monthChargeableMins} daq · batafsil: /jarima)\n`
          : `✅ Kechikish jarimasi: <b>0 so'm</b>\n`;
    }

    let text =
      `📊 <b>${escapeHtml(user.full_name)} ning oylik hisoboti (${String(tp.month).padStart(2, '0')}.${tp.year}):</b>\n\n` +
      `📅 Kelgan kunlar: <b>${uniqueDays} kun</b> (${monthlyShifts.length} ta smena)\n` +
      `⏱ <b>JAMI ISHLANGAN VAQT:</b> <b>${formatMinutes(totalMinutes)}</b> (${(totalMinutes / 60).toFixed(1)} soat)\n` +
      personalPenaltyLine +
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
    const tp = getTashkentParts();
    const currentMonthPrefix = tp.monthPrefix;
    const isPrivateAdminChat = chatId > 0;

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
    let totalStorePenalty = 0;
    let text =
      `📋 <b>${escapeHtml(this.shopName)} XODIMLARINING OYLIK HISOBOTI</b>\n` +
      `🗓 Oy: <b>${String(tp.month).padStart(2, '0')}.${tp.year}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const w of workers) {
      const shifts = shiftsByUser.get(w.id) || [];
      const days = new Set(shifts.map((s) => s.date)).size;
      const totalM = shifts.reduce((acc, s) => acc + getAccurateAttendanceMinutes(s), 0);
      totalStoreMinutes += totalM;

      let workerPenalty = 0;
      let workerLateDays = 0;
      if (isPrivateAdminChat && this.latePenaltyEnabled) {
        const byDate = new Map<string, Attendance[]>();
        shifts.forEach((s) => {
          const list = byDate.get(s.date) || [];
          list.push(s);
          byDate.set(s.date, list);
        });
        byDate.forEach((dayShifts) => {
          dayShifts.sort((a, b) => (a.check_in_time || '').localeCompare(b.check_in_time || ''));
          if (dayShifts[0]?.check_in_time) {
            const pen = calculateLatePenaltyAmount(
              dayShifts[0].check_in_time,
              w.work_start_time || '08:00',
              1,
              this.getPenaltySettings()
            );
            if (pen.lateMinutes > 0) workerLateDays += 1;
            workerPenalty += pen.penaltyAmount;
          }
        });
        totalStorePenalty += workerPenalty;
      }

      text += `👤 <b>${escapeHtml(w.full_name)}</b>\n`;
      text += `   • Ishlagan kunlari: <b>${days} kun</b> (${shifts.length} ta smena)\n`;
      text += `   • Jami ishlagan vaqti: <b>${formatMinutes(totalM)}</b> (${(totalM / 60).toFixed(1)} soat)\n`;
      if (isPrivateAdminChat && this.latePenaltyEnabled) {
        text += `   • Kechikish jarimasi: <b>${formatUzSum(workerPenalty)}</b> (${workerLateDays} kun kechikish)\n`;
      }
      text += `\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━\n`;
    text += `🏪 <b>Do'kon bo'yicha jami:</b> <b>${formatMinutes(totalStoreMinutes)}</b> (${(totalStoreMinutes / 60).toFixed(1)} soat)`;
    if (isPrivateAdminChat && this.latePenaltyEnabled) {
      text += `\n⚠️ <b>Jami kechikish jarimalari:</b> <b>${formatUzSum(totalStorePenalty)}</b>`;
    }

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

  private parseDateToIso(dateStr: string, defaultYear?: number): string {
    const tp = getTashkentParts();
    const targetYear = defaultYear || tp.year;
    const cleaned = dateStr.trim().replace(/\./g, '-').replace(/\//g, '-');
    const parts = cleaned.split('-').filter(Boolean);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
      const yr = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${yr}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    } else if (parts.length === 2) {
      // Qisqa format: 15.08 -> YYYY-08-15
      return `${targetYear}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return tp.dateStr;
  }

  private async handleDateRangeReport(chatId: number, tgUserId: string, isAdm: boolean, rawText: string) {
    const textBody = rawText
      .replace(/\/oraliq(@\S+)?|\/davr(@\S+)?|\/range(@\S+)?|📅|sana\s*oralig['`‘’]?i?/gi, '')
      .trim();
    // 15.08, 18.09, 15.08.2026, 2026-08-15, 15/08 kabi barcha sanalarni topish
    const dates = textBody.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/g);
    const tp = getTashkentParts();
    let startDate = '';
    let endDate = '';

    if (dates && dates.length >= 2) {
      const firstHasYear = dates[0].replace(/[./]/g, '-').split('-').length === 3;
      const secondHasYear = dates[1].replace(/[./]/g, '-').split('-').length === 3;
      startDate = this.parseDateToIso(dates[0], tp.year);
      endDate = this.parseDateToIso(dates[1], tp.year);
      // Agar "20.12 dan 10.01 gacha" kabi yil osha yozilgan bo'lsa (ikkalasida ham yil ko'rsatilmagan bo'lsa)
      if (!firstHasYear && !secondHasYear && startDate > endDate) {
        const sMonth = Number(startDate.slice(5, 7));
        const eMonth = Number(endDate.slice(5, 7));
        if (sMonth > eMonth) {
          startDate = this.parseDateToIso(dates[0], tp.year - 1);
        }
      }
    } else if (dates && dates.length === 1) {
      startDate = this.parseDateToIso(dates[0], tp.year);
      endDate = tp.dateStr;
    } else if (/bugun|shu oy|bu oy/i.test(textBody)) {
      startDate = `${tp.monthPrefix}-01`;
      endDate = tp.dateStr;
    } else {
      // Sanalar ko'rsatilmagan bo'lsa: tezkor 1-bosish tugmalari + qo'lda yozish imkoniyatini chiqaramiz!
      this.pendingDateRangeUsers.add(tgUserId);
      const quickRangeInline = {
        inline_keyboard: [
          [{ text: `📅 Shu oy (${tp.monthPrefix}-01 — bugun)`, callback_data: 'range_preset:this_month' }],
          [
            { text: '📅 Oxirgi 7 kun', callback_data: 'range_preset:last_7' },
            { text: '📅 Oxirgi 15 kun', callback_data: 'range_preset:last_15' },
          ],
          [
            { text: "📅 O'tgan oy to'liq", callback_data: 'range_preset:prev_month' },
            { text: '📅 Oxirgi 30 kun', callback_data: 'range_preset:last_30' },
          ],
        ],
      };
      await this.sendMessage(
        chatId,
        `📅 <b>Sanalar oralig'i bo'yicha hisobot:</b>\n\n` +
          `Quyidagi tayyor davrlardan birini tanlang yoki istalgan sana oralig'ini yozib yuboring:\n` +
          `• <code>15.08 dan 18.09 gacha</code>\n` +
          `• <code>01.10 dan bugungacha</code>\n` +
          `• <code>15.08 18.09</code>\n` +
          `• <code>01.09.2026 30.09.2026</code>`,
        quickRangeInline
      );
      return;
    }

    if (startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }

    const fmtDisplay = (iso: string) => {
      const [y, m, d] = iso.split('-');
      return `${d}.${m}.${y}`;
    };

    const usersSnap = await getDocs(collection(db, 'users'));
    const userMap = new Map<number, User>();
    usersSnap.forEach((d) => {
      const u = d.data() as User;
      userMap.set(u.id, u);
    });

    const attSnap = await getDocs(
      query(collection(db, 'attendance'), where('status', '==', 'completed'))
    );

    if (isAdm) {
      const workers: User[] = [];
      userMap.forEach((u) => {
        if (u.role === 'worker') workers.push(u);
      });

      const statsByUser = new Map<number, { mins: number; days: Set<string>; shifts: number }>();
      let totalStoreMins = 0;

      attSnap.forEach((d) => {
        const a = d.data() as Attendance;
        if (a.date >= startDate && a.date <= endDate) {
          const st = statsByUser.get(a.user_id) || { mins: 0, days: new Set(), shifts: 0 };
          const mins = getAccurateAttendanceMinutes(a);
          st.mins += mins;
          st.days.add(a.date);
          st.shifts += 1;
          statsByUser.set(a.user_id, st);
          totalStoreMins += mins;
        }
      });

      workers.sort((a, b) => {
        const ma = statsByUser.get(a.id)?.mins || 0;
        const mb = statsByUser.get(b.id)?.mins || 0;
        return mb - ma;
      });

      let text =
        `📊 <b>${escapeHtml(this.shopName)} — SANALAR ORALIG'I HISOBOTI</b>\n` +
        `📅 Davr: <b>${fmtDisplay(startDate)} dan ${fmtDisplay(endDate)} gacha</b>\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n`;

      workers.forEach((w, idx) => {
        const st = statsByUser.get(w.id) || { mins: 0, days: new Set(), shifts: 0 };
        text +=
          `${idx + 1}. 👤 <b>${escapeHtml(w.full_name)}</b> (${escapeHtml(w.position || 'Xodim')})\n` +
          `   • Ishlagan kunlari: <b>${st.days.size} kun</b> (${st.shifts} ta smena)\n` +
          `   • Jami ishlagan vaqti: <b>${formatMinutes(st.mins)}</b> (${(st.mins / 60).toFixed(1)} soat)\n\n`;
      });

      text +=
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🏪 <b>Jami do'kon bo'yicha:</b> <b>${formatMinutes(totalStoreMins)}</b> (${(totalStoreMins / 60).toFixed(1)} soat)`;

      await this.sendMessage(chatId, text);
    } else {
      const user = await this.findUserByTelegramId(tgUserId);
      if (!user) {
        await this.sendMessage(chatId, `Iltimos, avval ro'yxatdan o'ting (/start).`);
        return;
      }

      const userShifts: Attendance[] = [];
      attSnap.forEach((d) => {
        const a = d.data() as Attendance;
        if (a.user_id === user.id && a.date >= startDate && a.date <= endDate) {
          userShifts.push(a);
        }
      });

      userShifts.sort((a, b) => b.id - a.id);
      const totalMins = userShifts.reduce((acc, s) => acc + getAccurateAttendanceMinutes(s), 0);
      const uniqueDays = new Set(userShifts.map((s) => s.date)).size;

      let text =
        `📊 <b>${escapeHtml(user.full_name)} ning hisoboti:</b>\n` +
        `📅 Davr: <b>${fmtDisplay(startDate)} dan ${fmtDisplay(endDate)} gacha</b>\n\n` +
        `📅 Kelgan kunlar: <b>${uniqueDays} kun</b> (${userShifts.length} ta smena)\n` +
        `⏱ <b>JAMI ISHLANGAN VAQT:</b> <b>${formatMinutes(totalMins)}</b> (${(totalMins / 60).toFixed(1)} soat)\n\n`;

      if (userShifts.length > 0) {
        text += `Smenalar:\n`;
        for (const s of userShifts.slice(0, 15)) {
          const outT = s.check_out_time ? s.check_out_time.slice(0, 5) : '---';
          text += `• ${fmtDisplay(s.date)}: ${s.check_in_time.slice(0, 5)} ➡️ ${outT} (${formatMinutes(getAccurateAttendanceMinutes(s))})\n`;
        }
      } else {
        text += `<i>Ushbu sanalar oralig'ida yakunlangan smenalar topilmadi.</i>`;
      }

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

  private async claimRuntimeSlot(fieldName: string, slotValue: string): Promise<boolean> {
    try {
      const stateRef = doc(db, 'settings', 'bot_runtime_state');
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(stateRef);
        if (snap.exists() && snap.data()?.[fieldName] === slotValue) {
          return false;
        }
        tx.set(
          stateRef,
          {
            [fieldName]: slotValue,
            updated_at: new Date().toISOString(),
            leader_id: this.instanceId,
          },
          { merge: true }
        );
        return true;
      });
    } catch {
      return true;
    }
  }

  private startSixHourScheduler() {
    if (this.cronInterval) return;
    console.log('[CloudBot] 6 soatlik bulutli avto-monitoring jadvali faollashtirildi (Toshkent vaqti: 06:00, 12:00, 18:00, 00:00)...');
    this.cronInterval = setInterval(async () => {
      try {
        // Faqat yagona faol Leader avto-xabarlarni jo'natadi!
        if (!this.isLeader || !this.botToken) return;

        const tp = getTashkentParts();
        const hour = tp.hour;
        const minute = tp.minute;

        // 1. 6 soatlik rejali monitoring (Toshkent vaqti bilan!)
        if ([0, 6, 12, 18].includes(hour) && minute === 0) {
          const slot = `${tp.dateStr}_${hour}`;
          if (this.last6hSlot !== slot) {
            this.last6hSlot = slot;
            const claimed = await this.claimRuntimeSlot('last_6h_slot', slot);
            if (claimed) {
              console.log(`[CloudBot Cron] ${slot} da 6 soatlik monitoring avtomat yuborilmoqda...`);
              await this.sendSixHourSummary();
            }
          }
        }

        // 2. ☀️ Ertalabki uyg'otuvchi va ishga chaqiruvchi eslatma (Har bir xodimga smenasidan oldin)
        if (this.morningWakeupEnabled && hour >= 6 && hour <= 14) {
          await this.checkAndSendMorningWakeupReminders(tp);
        }

        // 2.5. 🚨 Kechikish ruxsati (grace period) tugaganda qat'iy shaxsiy ogohlantirish (Alarm)
        if (this.latePenaltyEnabled && hour >= 6 && hour <= 23) {
          await this.checkAndSendLateGraceExceededAlarms(tp);
        }

        // 3. Kechki payt (Toshkent vaqti bilan 18:00 dan 23:59 gacha) har 2 daqiqada:
        if (hour >= 18 && minute % 2 === 0) {
          await this.checkAndTriggerDailyClosingReportIfAllFinished(tp.dateStr);
        }
      } catch (err) {
        console.error('[CloudBot Cron Error]', err);
      }
    }, 30000);
  }

  // --- ☀️ ERTALABKI UYG'OTUVCHI VA ISHGA CHAQIRUVCHI ESLATMA ---
  // Xodimning ish boshlanish vaqtidan (masalan: 08:00) 30 daqiqa oldin (07:30 da) shaxsiy Telegramiga xabar yuborish
  public async checkAndSendMorningWakeupReminders(tp = getTashkentParts()): Promise<number> {
    if (!this.morningWakeupEnabled || !this.botToken) return 0;
    try {
      const currentTotalMins = tp.hour * 60 + tp.minute;
      const minutesBefore = this.morningWakeupMinutesBefore || 30;

      // Bugun kelganlarni olish
      const attSnap = await getDocs(
        query(collection(db, 'attendance'), where('date', '==', tp.dateStr))
      );
      const checkedInUserIds = new Set<number>();
      attSnap.forEach((d) => {
        checkedInUserIds.add((d.data() as Attendance).user_id);
      });

      // Barcha faol xodimlarni olish
      const userSnap = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'worker'))
      );
      let sentCount = 0;

      for (const d of userSnap.docs) {
        const u = d.data() as User;
        if (u.is_active === false) continue;
        if (!u.telegram_id) continue;
        // Agar xodim bugun allaqachon kelgan bo'lsa, eslatma yuborilmaydi
        if (checkedInUserIds.has(u.id)) continue;

        const startTime = (u.work_start_time || '08:00').trim();
        const [sH, sM] = startTime.split(':').map(Number);
        if (isNaN(sH)) continue;
        const startTotalMins = sH * 60 + (sM || 0);

        // Eslatma yuborish vaqti = ish boshlanishidan `minutesBefore` daqiqa oldin
        const targetReminderMin = startTotalMins - minutesBefore;
        if (targetReminderMin < 0) continue;

        // Aniq oraliq: hozirgi vaqt targetReminderMin dan targetReminderMin + 3 daqiqa ichida bo'lsa
        const diff = currentTotalMins - targetReminderMin;
        if (diff >= 0 && diff <= 3) {
          const slotKey = `wakeup_${tp.dateStr}_${u.id}`;
          const claimed = await this.claimRuntimeSlot(slotKey, 'sent');
          if (!claimed) continue;

          const customLine = this.morningWakeupCustomText
            ? `\n💬 <i>${escapeHtml(this.morningWakeupCustomText)}</i>\n`
            : '';

          const graceLine = this.latePenaltyEnabled
            ? `\n⚠️ <i>Eslatma: ${this.lateGracePeriodMinutes} daqiqadan oshgan har bir daqiqa kechikish uchun ${formatUzSum(this.latePenaltyPerMinuteSum)} jarima hisoblanadi.</i>`
            : '';

          const text =
            `🌅 <b>XAYRLI TONG, ${escapeHtml(u.full_name)}!</b>\n\n` +
            `⏰ <b>Smena boshlanishiga ${minutesBefore} daqiqa qoldi!</b>\n` +
            `🏢 <b>Ish vaqtingiz:</b> <b>${startTime}</b> — ${u.work_end_time || '20:00'}\n` +
            `📍 <b>Manzil:</b> ${escapeHtml(this.shopName)}\n` +
            customLine +
            `\nDo'konga yetib kelgach, botga kirib darhol <b>«📍 ISHGA KELDIM»</b> tugmasini bosishni unutmang!` +
            graceLine;

          const markup = {
            inline_keyboard: [
              [
                { text: "🚶‍♂️ Yo'ldaman", callback_data: `wakeup_resp:on_way:${u.id}` },
                { text: '⏰ Kechikaman', callback_data: `wakeup_resp:late:${u.id}` },
              ],
              [
                { text: '📍 Ishga keldim', callback_data: 'quick_checkin' },
                { text: '🌐 Veb-portal', url: this.webappUrl },
              ],
            ],
          };

          const res = await this.sendMessage(u.telegram_id, text, markup);
          if (res.ok) {
            sentCount++;
            console.log(`[CloudBot Wakeup] Xodimga ertalabki eslatma yuborildi: ${u.full_name} (${u.telegram_id})`);
          }
        }
      }

      return sentCount;
    } catch (err) {
      console.error('[CloudBot Wakeup Error]', err);
      return 0;
    }
  }

  // --- 🚨 2-BOSQICHLI QAT'IY OGOHLANTIRISH (GRACE PERIOD TUGAGANDA ALARM) ---
  // Smena boshlanish vaqti + grace period (masalan 10 daqiqa) tugaganda xodim hali kelmagan bo'lsa
  public async checkAndSendLateGraceExceededAlarms(tp = getTashkentParts()): Promise<number> {
    if (!this.latePenaltyEnabled || !this.botToken) return 0;
    try {
      const currentTotalMins = tp.hour * 60 + tp.minute;
      const graceMinutes = this.lateGracePeriodMinutes || 10;

      // Bugun kelganlarni olish
      const attSnap = await getDocs(
        query(collection(db, 'attendance'), where('date', '==', tp.dateStr))
      );
      const checkedInUserIds = new Set<number>();
      attSnap.forEach((d) => {
        checkedInUserIds.add((d.data() as Attendance).user_id);
      });

      // Barcha faol xodimlarni olish
      const userSnap = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'worker'))
      );
      let sentCount = 0;

      for (const d of userSnap.docs) {
        const u = d.data() as User;
        if (u.is_active === false) continue;
        if (!u.telegram_id) continue;
        // Agar xodim bugun allaqachon kelgan bo'lsa, ogohlantirish kerak emas
        if (checkedInUserIds.has(u.id)) continue;

        const startTime = (u.work_start_time || '08:00').trim();
        const [sH, sM] = startTime.split(':').map(Number);
        if (isNaN(sH)) continue;
        const startTotalMins = sH * 60 + (sM || 0);

        // Ruxsat tugash vaqti = ish boshlanishi + grace period
        const graceEndMin = startTotalMins + graceMinutes;

        // Aniq oraliq: hozirgi vaqt graceEndMin dan graceEndMin + 4 daqiqa ichida bo'lsa
        const diff = currentTotalMins - graceEndMin;
        if (diff >= 0 && diff <= 4) {
          const slotKey = `grace_alarm_${tp.dateStr}_${u.id}`;
          const claimed = await this.claimRuntimeSlot(slotKey, 'sent');
          if (!claimed) continue;

          const text =
            `🚨 <b>DIQQAT, ${graceMinutes} DAQIQALIK RUXSAT TUGADI!</b>\n\n` +
            `Hurmatli <b>${escapeHtml(u.full_name)}</b>, sizning ish vaqtingiz (<b>${startTime}</b>) boshlanganidan keyin berilgan <b>${graceMinutes} daqiqalik ruxsat</b> yakunlandi!\n\n` +
            `⚠️ <b>Ayni paytda har bir kechikkan daqiqa uchun ${formatUzSum(this.latePenaltyPerMinuteSum)} miqdorida jarima yozilmoqda!</b>\n\n` +
            `📍 Iltimos, do'konga yetib kelishingiz bilan botda zudlik bilan <b>«📍 ISHGA KELDIM»</b> tugmasini bosing!`;

          const markup = {
            inline_keyboard: [
              [
                { text: '📍 Ishga keldim', callback_data: 'quick_checkin' },
                { text: '🌐 Veb-portal', url: this.webappUrl },
              ],
            ],
          };

          const res = await this.sendMessage(u.telegram_id, text, markup);
          if (res.ok) {
            sentCount++;
            console.log(`[CloudBot Alarm] Xodimga ruxsat tugash alarmi yuborildi: ${u.full_name} (${u.telegram_id})`);
          }

          // Shaxsiy Adminga ham ogohlantirish yuborish (guruh chatiga jarima tafsilotlari oshkor qilinmaydi)
          await this.notifyAdmins(
            `⚠️ <b>Kechikish ogohlantiruvi:</b> ${escapeHtml(u.full_name)} smenasi (${startTime}) boshlandi va ${graceMinutes} daqiqalik ruxsat tugadi.`,
            undefined,
            `⚠️ <b>Kechikish alarmi:</b> <b>${escapeHtml(u.full_name)}</b> smenasi (${startTime}) boshlandi va <b>${graceMinutes} daqiqalik ruxsat tugadi</b>. Jarima hisoblanmoqda (${formatUzSum(this.latePenaltyPerMinuteSum)}/daq).`
          );
        }
      }

      return sentCount;
    } catch (err) {
      console.error('[CloudBot Grace Alarm Error]', err);
      return 0;
    }
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

      if (snapCompleted.empty) {
        return false;
      }

      // 3. Ushbu sana va shu smenalar soni uchun hisobot avval yuborilganmi? (Firestore da ham tekshiriladi!)
      const closingKey = `${todayStr}_shifts_${snapCompleted.size}`;
      if (!force) {
        if (this.lastDailyClosingReportDate === closingKey) {
          return false;
        }
        const claimed = await this.claimRuntimeSlot('last_daily_closing_key', closingKey);
        if (!claimed) {
          this.lastDailyClosingReportDate = closingKey;
          return false;
        }
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
    const tp = getTashkentParts();
    const todayStr = tp.dateStr;
    const currentMins = tp.hour * 60 + tp.minute;

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
        const diffH = isPastDate ? 14 : Math.max(1, Math.round((currentMins - inTotal) / 60));
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
    const tp = getTashkentParts();
    const currentMonthPrefix = tp.monthPrefix;

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
      cur.minutes += a.status === 'completed' ? getAccurateAttendanceMinutes(a) : (a.worked_minutes || 0);
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

    const cleanPortalUrl = normalizePublicWebappUrl(this.webappUrl);
    const inline = {
      inline_keyboard: [
        [{ text: '📊 Veb-Portalni Ochish ↗️', url: cleanPortalUrl }],
      ],
    };

    await this.sendMessage(chatId, text, inline);
  }

  // --- /app yoki /portal ---
  private async handleAppCommand(chatId: number, tgUserId?: string, isAdm = false) {
    const cleanBase = normalizePublicWebappUrl(this.webappUrl);
    if (cleanBase && cleanBase.startsWith('http')) {
      const isGroupChat = chatId < 0;
      const isPrivateAdmin = !isGroupChat && isAdm;

      // Mini App ichida Telegram o'zi foydalanuvchini (tgUser.id) xavfsiz tasdiqlaydi;
      // Brauzerda esa Admin uchun PIN-kod so'raladi, oddiy xodim uchun faqat o'z ishchi oynasi (yoki Kirish ekrani) ochiladi!
      const miniAppUrl = isPrivateAdmin
        ? cleanBase
        : `${cleanBase}${!isGroupChat && tgUserId ? `/?worker_tg_id=${encodeURIComponent(tgUserId)}` : ''}`;

      const browserUrl = isPrivateAdmin
        ? `${cleanBase}/?auto_admin=true`
        : miniAppUrl;

      const title = isPrivateAdmin
        ? `🏪 <b>${escapeHtml(this.shopName)} Boshqaruv Veb-Portali (Admin)</b>`
        : `🏪 <b>${escapeHtml(this.shopName)} Veb-Portali</b>`;

      const desc = isPrivateAdmin
        ? `Barcha xodimlar davomati, oylik hisobotlar va sozlamalarni boshqarish uchun quyidagi tugmani bosing:`
        : `Shaxsiy ishlagan soatlaringiz va kunlik davomatingizni ko'rish uchun portalni oching:`;

      const inlineMarkup = isGroupChat
        ? {
            inline_keyboard: [
              [{ text: '🌐 Veb-Portalni Ochish ↗️', url: cleanBase }],
              ...(this.botUsername
                ? [[{ text: '📱 Shaxsiy kabinet (Bot orqali)', url: `https://t.me/${this.botUsername}?start=portal` }]]
                : []),
            ],
          }
        : {
            inline_keyboard: [
              [{ text: isPrivateAdmin ? '📱 Admin Panelni Ochish (Mini App)' : '📱 Shaxsiy Portalni Ochish (Mini App)', web_app: { url: miniAppUrl } }],
              [{ text: '🌐 Brauzerda Ochish ↗️', url: browserUrl }],
            ],
          };
      await this.sendMessage(chatId, `${title}\n\n${desc}`, inlineMarkup);
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
      `⚠️ <b>/jarima</b> — Shaxsiy kechikish va jarimalar hisobi\n` +
      `📅 <b>/oraliq</b> — Istalgan sana oralig'i hisoboti (masalan: <code>/oraliq 15.08 dan 18.09 gacha</code>)\n` +
      `📅 <b>/bugun</b> — Bugungi smenalaringiz\n` +
      `🏆 <b>/kpi</b> — Ishchilarning KPI va soat reytingi\n` +
      `🌐 <b>/portal</b> — Veb-portalni ochish\n` +
      `🤖 <b>/status</b> — Bot va server holatini tekshirish\n`;

    if (isAdm && chatId > 0) {
      text +=
        `\n👑 <b>Admin buyruqlari:</b>\n` +
        `🔴 <b>/live</b> — Hozir ishda kim borligini ko'rish\n` +
        `⚠️ <b>/jarima</b> — Barcha xodimlarning kechikish va jarimalari\n` +
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
    const cleanId = String(tgId || '').trim();
    if (!cleanId) return null;

    const pickBestProfile = (docs: any[]): User | null => {
      if (!docs.length) return null;
      const list = docs.map((d) => {
        const raw = d.data() as User;
        return { ...raw, id: Number(raw.id || d.id) };
      });
      // 1. Agar bir nechta profil topilsa, real faol ishchi (worker) profilini tanlaymiz
      const activeWorker = list.find((u) => u.role === 'worker' && u.is_active !== false);
      if (activeWorker) return activeWorker;
      // 2. Faol profil
      const activeUser = list.find((u) => u.is_active !== false);
      if (activeUser) return activeUser;
      return list[0];
    };

    const qStr = query(collection(db, 'users'), where('telegram_id', '==', cleanId));
    const snapStr = await getDocs(qStr);
    if (!snapStr.empty) {
      return pickBestProfile(snapStr.docs);
    }

    if (/^\d+$/.test(cleanId)) {
      const qNum = query(collection(db, 'users'), where('telegram_id', '==', Number(cleanId)));
      const snapNum = await getDocs(qNum);
      if (!snapNum.empty) {
        return pickBestProfile(snapNum.docs);
      }
    }

    return null;
  }

  private async findActiveShift(userId: number): Promise<Attendance | null> {
    const q = query(
      collection(db, 'attendance'),
      where('user_id', '==', userId),
      where('status', 'in', ['working', 'on_break'])
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    // Agar tasodifiy dublikat ochiq smenalar qolib ketgan bo'lsa, eng birinchisini saqlab qolganlarini xavfsiz yopamiz
    const docs = snap.docs.map((d) => ({
      docId: d.id,
      att: { ...(d.data() as Attendance), id: Number((d.data() as any).id || d.id) },
    }));
    docs.sort((a, b) => a.att.id - b.att.id);

    if (docs.length > 1) {
      for (let i = 1; i < docs.length; i++) {
        try {
          await setDoc(
            doc(db, 'attendance', docs[i].docId),
            {
              status: 'completed',
              check_out_date: docs[i].att.date,
              check_out_time: docs[i].att.check_in_time,
              worked_minutes: 0,
              note: 'Dublikat ochiq smena avtomatik tozalandi',
            },
            { merge: true }
          );
        } catch {}
      }
    }

    return docs[0].att;
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
