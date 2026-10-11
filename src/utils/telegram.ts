// Telegram WebApp yordamchi funksiyalari
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        isVersionAtLeast?: (version: string) => boolean;
        version?: string;
        initData: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
        };
        themeParams?: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        MainButton?: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          setText: (text: string) => void;
          setParams: (params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          showProgress: (leaveActive?: boolean) => void;
          hideProgress: () => void;
        };
        BackButton?: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
      };
    };
  }
}

// Telegram WebApp mavjudligini tekshirish
export const isTelegramWebApp = (): boolean => {
  return typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp?.initData);
};

// Telegram foydalanuvchisini olish
export const getTelegramUser = () => {
  return window.Telegram?.WebApp?.initDataUnsafe?.user || null;
};

// Haptic (vibratsiya) effekti berish
export const triggerHaptic = (
  type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light'
) => {
  try {
    const haptic = window.Telegram?.WebApp?.HapticFeedback;
    if (!haptic) return;

    if (type === 'success' || type === 'warning' || type === 'error') {
      haptic.notificationOccurred(type);
    } else {
      haptic.impactOccurred(type);
    }
  } catch {
    // Brauzerda xatolik bermasligi uchun
  }
};

// Ilovani to'liq ekranga yoyish va moslashtirish
export const initTelegramApp = () => {
  try {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      // Telegram WebApp 6.0 da warning bermasligi uchun 6.1+ tekshiruvi
      const tg = window.Telegram.WebApp;
      if (typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast('6.1')) {
        if (typeof tg.setHeaderColor === 'function') {
          tg.setHeaderColor('#00a651');
        }
        if (typeof tg.setBackgroundColor === 'function') {
          tg.setBackgroundColor('#f8fafc');
        }
      }
    }
  } catch (e) {
    console.error('Telegram WebApp yuklanishda xato:', e);
  }
};

function translateTelegramError(desc: string, targetId: string, migratedId?: string): string {
  const d = (desc || '').toLowerCase();
  if (d.includes('group chat was upgraded') || d.includes('supergroup')) {
    if (migratedId) {
      return `Guruh Superguruhga aylangan. Uning yangi ID raqami: ${migratedId}. Tizim avtomatik yangi ID ga o'tkazdi!`;
    }
    return `Siz kiritgan guruh (${targetId}) oddiy guruhdan "Superguruh"ga aylangan! Telegramda superguruhlarning ID raqami o'zgaradi va har doim '-100' bilan boshlanadi (masalan: -100...). Yangi ID ni bilish uchun guruhingiz ichida /id deb yozing va chiqqan raqamni kiriting.`;
  }
  if (d.includes('not a member') || d.includes('member of the')) {
    return `Bot ${targetId} guruhiga a'zo qilinmagan! Iltimos, Telegramda guruh sozlamalariga kirib, botingizni guruhga qo'shing va xabar yozish ruxsatini bering.`;
  }
  if (d.includes('chat not found')) {
    return `"${targetId}" chat/guruh topilmadi! Agar bu guruh bo'lsa, ID oldida '-' yoki '-100' bo'lishi kerak (masalan: -1001234567890) va bot avval guruhga a'zo qilingan bo'lishi shart.`;
  }
  if (d.includes('bot was blocked') || d.includes('user is deactivated')) {
    return `Admin botni bloklab qo'ygan yoki hisob o'chirilgan. Botga Telegramda /start bosing.`;
  }
  if (d.includes('unauthorized') || d.includes('invalid token')) {
    return `Bot Token noto'g'ri kiritilgan! @BotFather bergan tokenni qayta tekshiring.`;
  }
  if (d.includes('have no rights') || d.includes('not enough rights')) {
    return `Bot ushbu guruhda xabar yozish huquqiga ega emas. Unga guruhda adminlik yoki xabar yozish huquqini bering.`;
  }
  return desc || "Xabar yuborilmadi. Chat ID va Tokenni tekshiring.";
}

// Xabarlarni takroran 2-3 martadan yuborishning oldini oluvchi kesh (Deduplication)
const clientMessageDedupeCache = new Map<string, number>();

// Telegram Bot orqali admin yoki guruhga xabarnoma jo'natish (bir nechta admin/guruh ID larini qo'llab-quvvatlaydi, tezkor parallel yetkazish va dublikatdan himoya)
export async function sendTelegramNotification(
  botToken?: string,
  chatId?: string,
  text?: string
): Promise<{ success: boolean; error?: string; migratedTo?: string }> {
  if (!botToken || !chatId || !text) {
    return { success: false, error: "Bot token yoki Chat ID kiritilmagan" };
  }

  const cleanToken = botToken.trim();
  const rawChatIds = chatId.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  // Takroriy Chat ID larni tozalaymiz (masalan, admin ID si 2 marta kiritilgan bo'lsa)
  const uniqueChatIds = Array.from(new Set(rawChatIds));
  if (uniqueChatIds.length === 0) {
    return { success: false, error: "Yaroqli Chat ID topilmadi" };
  }

  // Eskirgan kesh yozuvlarini tozalash (30 soniyadan oshgan)
  const now = Date.now();
  for (const [k, ts] of clientMessageDedupeCache.entries()) {
    if (now - ts > 30000) {
      clientMessageDedupeCache.delete(k);
    }
  }

  let anySuccess = false;
  let lastError = '';
  let discoveredNewChatId: string | undefined = undefined;

  // Xabarlarni bir vaqtning o'zida parallel va tezkor jo'natish (Zudlik bilan)
  await Promise.allSettled(
    uniqueChatIds.map(async (targetId) => {
      // 15 soniya ichida aynan shu chatga aynan shu xabar allaqachon yuborilgan bo'lsa, qayta yubormaymiz!
      const dedupeKey = `${cleanToken.slice(-6)}_${targetId}_${text.trim()}`;
      const lastSentTime = clientMessageDedupeCache.get(dedupeKey);
      if (lastSentTime && now - lastSentTime < 15000) {
        // Dublikat to'xtatildi, muvaffaqiyatli deb hisoblaymiz
        anySuccess = true;
        return;
      }
      clientMessageDedupeCache.set(dedupeKey, now);

      try {
        // 1. Avval server API proxy orqali jo'natib ko'ramiz (CORS muammosiz)
        let sentOk = false;
        try {
          const proxyRes = await fetch('/api/telegram/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: cleanToken,
              chat_id: targetId,
              text,
            }),
          });
          if (proxyRes.ok) {
            const proxyData = await proxyRes.json();
            if (proxyData.ok) {
              anySuccess = true;
              sentOk = true;
              if (proxyData.migrated_to) {
                discoveredNewChatId = String(proxyData.migrated_to);
              }
            } else {
              const mig = proxyData.parameters?.migrate_to_chat_id;
              lastError = translateTelegramError(proxyData.description || proxyData.error, targetId, mig ? String(mig) : undefined);
            }
          }
        } catch {
          // Proxy ishlamasa bevosita Telegramga yuboramiz
        }

        if (sentOk) return;

        // 2. Bevosita Telegram API ga yuborish
        const response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: targetId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });

        const data = await response.json();
        if (data.ok) {
          anySuccess = true;
        } else if (data.parameters?.migrate_to_chat_id) {
          // Telegram superguruhga o'tish (migrate_to_chat_id)
          const newSupergroupId = String(data.parameters.migrate_to_chat_id);
          discoveredNewChatId = newSupergroupId;
          console.log(`Telegram guruh superguruhga o'tdi: ${targetId} -> ${newSupergroupId}`);

          // Yangi superguruhga qayta jo'natamiz
          const retryRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: newSupergroupId,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          });
          const retryData = await retryRes.json();
          if (retryData.ok) {
            anySuccess = true;
          } else {
            lastError = translateTelegramError(retryData.description || data.description, newSupergroupId, newSupergroupId);
          }
        } else {
          lastError = translateTelegramError(data.description || "Telegram API xatoligi", targetId);
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : 'Tarmoq xatoligi';
      }
    })
  );

  if (anySuccess) {
    return { success: true, migratedTo: discoveredNewChatId };
  }
  return { success: false, error: lastError || "Xabar yuborilmadi", migratedTo: discoveredNewChatId };
}

