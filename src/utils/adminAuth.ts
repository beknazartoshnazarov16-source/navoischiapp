import { MarketSettings, User, AdminMember } from '../types';

export const DEFAULT_SUPER_ADMIN_TG_ID = '45701569';

/**
 * Barcha admin Telegram ID larini to'playdi
 */
export function getAllAdminIds(settings: MarketSettings, users: User[] = []): string[] {
  const ids = new Set<string>();

  // Asosiy Bosh Admin doimo ro'yxatda bo'ladi
  ids.add(DEFAULT_SUPER_ADMIN_TG_ID);

  // 1. settings.admin_telegram_id (vergul, probel, nuqta-vergul bilan ajratilgan)
  if (settings.admin_telegram_id) {
    const parts = settings.admin_telegram_id
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && s !== '123456789');
    parts.forEach((p) => ids.add(p));
  }

  // 2. settings.admin_ids massivi
  if (Array.isArray(settings.admin_ids)) {
    settings.admin_ids.forEach((id) => {
      const s = String(id).trim();
      if (s && s !== '123456789') ids.add(s);
    });
  }

  // 3. settings.admins ob'ektlari
  if (Array.isArray(settings.admins)) {
    settings.admins.forEach((adm) => {
      const s = String(adm.telegram_id || '').trim();
      if (s && s !== '123456789') ids.add(s);
    });
  }

  // 4. Foydalanuvchilar orasidagi adminlar
  if (Array.isArray(users)) {
    users
      .filter((u) => u.role === 'admin' && u.telegram_id)
      .forEach((u) => {
        const s = String(u.telegram_id).trim();
        if (s && s !== '123456789') ids.add(s);
      });
  }

  return Array.from(ids);
}

/**
 * Berilgan Telegram ID admin ekanligini tekshiradi (Qat'iy xavfsiz)
 */
export function isUserAdminByTelegramId(
  tgId: string | number | undefined | null,
  settings: MarketSettings,
  users: User[] = []
): boolean {
  if (!tgId) return false;
  const target = String(tgId).trim();
  if (!target || target === '123456789') return false;

  // 45701569 raqamli asosiy Bosh Admin darhol tasdiqlanadi
  if (target === DEFAULT_SUPER_ADMIN_TG_ID) return true;

  const allAdmins = getAllAdminIds(settings, users);
  return allAdmins.includes(target);
}

/**
 * Oylik va Maxfiy Buxgalteriya bo'limiga kirish huquqini tekshiradi.
 * Adminlar va do'kon boshqaruvchilari uchun Oylik bo'limi ochiladi,
 * ichkarida esa 4 xonali maxfiy Master PIN (standart: 9009) orqali to'liq himoyalanadi!
 */
export function isUserAuthorizedForPayroll(
  user: User | null | undefined,
  verifiedTgId: string | null | undefined,
  settings?: MarketSettings
): boolean {
  // 1. Agar foydalanuvchi admin rolida bo'lsa yoki admin PIN bilan tasdiqlangan bo'lsa
  if (user?.role === 'admin') return true;
  if (verifiedTgId === 'PIN_VERIFIED_ADMIN') return true;

  const userTgId = String(user?.telegram_id || '').trim();
  const verifiedId = String(verifiedTgId || '').trim();
  const explicitDesignatedAdmin = (settings?.payroll_admin_id || '').trim();

  // 2. Agar Telegram ID belgilangan admin ID si bilan mos kelsa
  if (explicitDesignatedAdmin && (userTgId === explicitDesignatedAdmin || verifiedId === explicitDesignatedAdmin)) {
    return true;
  }

  // 3. Super admin ID (45701569)
  if (userTgId === DEFAULT_SUPER_ADMIN_TG_ID || verifiedId === DEFAULT_SUPER_ADMIN_TG_ID) {
    return true;
  }

  // 4. Boshqa adminlar ro'yxatida bo'lsa
  if (verifiedId) {
    const allAdminIds = getAllAdminIds(settings || ({} as any), []);
    if (allAdminIds.includes(verifiedId)) return true;
  }

  return false;
}

/**
 * Adminlar ro'yxatini to'liq formatda shakllantiradi
 */
export function getStructuredAdminList(settings: MarketSettings, users: User[] = []): AdminMember[] {
  const adminIds = getAllAdminIds(settings, users);
  const primaryId = (settings.admin_telegram_id || '').split(/[,;\s]+/)[0]?.trim() || '';

  const list: AdminMember[] = [];
  const processedIds = new Set<string>();

  // 1. Avval settings.admins ro'yxatidagilar
  if (Array.isArray(settings.admins)) {
    settings.admins.forEach((adm) => {
      const cleanId = String(adm.telegram_id).trim();
      if (cleanId && !processedIds.has(cleanId)) {
        list.push({
          ...adm,
          telegram_id: cleanId,
          is_primary: cleanId === primaryId,
        });
        processedIds.add(cleanId);
      }
    });
  }

  // 2. Users orasidagi adminlar
  users
    .filter((u) => u.role === 'admin' && u.telegram_id)
    .forEach((u) => {
      const cleanId = String(u.telegram_id).trim();
      if (cleanId && !processedIds.has(cleanId)) {
        list.push({
          telegram_id: cleanId,
          full_name: u.full_name,
          phone: u.phone,
          role_title: u.position || 'Admin',
          is_primary: cleanId === primaryId,
          added_at: u.created_at || new Date().toISOString(),
        });
        processedIds.add(cleanId);
      }
    });

  // 3. Qolgan admin ID lari
  adminIds.forEach((id) => {
    if (!processedIds.has(id)) {
      list.push({
        telegram_id: id,
        full_name: id === primaryId ? "Bosh Admin (Asosiy)" : `Admin (${id})`,
        role_title: id === primaryId ? "Bosh Ma'mur" : "Admin",
        is_primary: id === primaryId,
        added_at: new Date().toISOString(),
      });
      processedIds.add(id);
    }
  });

  return list;
}
