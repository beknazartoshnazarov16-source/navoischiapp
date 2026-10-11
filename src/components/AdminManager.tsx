import React, { useState } from 'react';
import { MarketSettings, User, AdminMember } from '../types';
import { getStructuredAdminList, getAllAdminIds } from '../utils/adminAuth';
import {
  ShieldCheck,
  UserPlus,
  Trash2,
  Copy,
  Check,
  Crown,
  HelpCircle,
  Sparkles,
  Smartphone,
  Info,
  CheckCircle2,
  DollarSign,
  Lock,
} from 'lucide-react';
import { triggerHaptic } from '../utils/telegram';

interface AdminManagerProps {
  settings: MarketSettings;
  users: User[];
  onUpdateSettings: (newSettings: MarketSettings) => void;
  onUpdateUser: (updatedUser: User) => void;
}

export function AdminManager({
  settings,
  users,
  onUpdateSettings,
  onUpdateUser,
}: AdminManagerProps) {
  const [activeTab, setActiveTab] = useState<'from_workers' | 'by_id'>('from_workers');
  
  // Variant 1: Ishchidan tanlash
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [workerTelegramIdInput, setWorkerTelegramIdInput] = useState<string>('');
  const [workerRoleTitle, setWorkerRoleTitle] = useState<string>("Do'kon Ma'muri");

  // Variant 2: Yangi Telegram ID kiritish
  const [newAdminName, setNewAdminName] = useState<string>('');
  const [newAdminTgId, setNewAdminTgId] = useState<string>('');
  const [newAdminPhone, setNewAdminPhone] = useState<string>('');
  const [newAdminTitle, setNewAdminTitle] = useState<string>("Do'kon Ma'muri");

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const adminList = getStructuredAdminList(settings, users);
  const adminIds = getAllAdminIds(settings, users);

  // Admin bo'lmagan oddiy ishchilar ro'yxati
  const availableWorkers = users.filter((u) => {
    const isAlreadyAdmin = adminIds.includes(String(u.telegram_id || '')) || u.role === 'admin';
    return !isAlreadyAdmin;
  });

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    triggerHaptic('light');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    setTimeout(() => setFeedback(null), 4000);
  };

  // 1-usul: Ishchini adminga aylantirish
  const handlePromoteWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkerId) {
      showFeedback('error', 'Iltimos, ishchini tanlang!');
      return;
    }

    const worker = users.find((u) => u.id === Number(selectedWorkerId));
    if (!worker) return;

    const finalTgId = String(worker.telegram_id || workerTelegramIdInput).trim();
    if (!finalTgId) {
      showFeedback('error', 'Ushbu xodimning Telegram ID raqami kiritilmagan! Iltimos, Telegram ID sini kiriting.');
      return;
    }

    // 1. Ishchini role='admin' qilib yangilaymiz
    const updatedWorker: User = {
      ...worker,
      role: 'admin',
      telegram_id: finalTgId,
      position: workerRoleTitle || worker.position || "Do'kon Ma'muri",
    };
    onUpdateUser(updatedWorker);

    // 2. Settings'dagi admin ro'yxatiga qo'shamiz
    const newAdminObj: AdminMember = {
      telegram_id: finalTgId,
      full_name: worker.full_name,
      phone: worker.phone,
      role_title: workerRoleTitle || "Do'kon Ma'muri",
      added_at: new Date().toISOString(),
      is_primary: false,
    };

    const currentAdmins = settings.admins || [];
    const currentAdminIds = getAllAdminIds(settings, users);

    const updatedAdmins = [...currentAdmins.filter((a) => a.telegram_id !== finalTgId), newAdminObj];
    const updatedAdminIds = Array.from(new Set([...currentAdminIds, finalTgId]));
    const updatedAdminTgIdStr = updatedAdminIds.join(', ');

    const newSettings: MarketSettings = {
      ...settings,
      admins: updatedAdmins,
      admin_ids: updatedAdminIds,
      admin_telegram_id: updatedAdminTgIdStr,
    };

    onUpdateSettings(newSettings);
    setSelectedWorkerId('');
    setWorkerTelegramIdInput('');
    showFeedback('success', `🎉 ${worker.full_name} muvaffaqiyatli Admin etib tayinlandi! Endi u o'z Telegrami orqali Admin panelga to'liq kira oladi.`);
  };

  // Oylik va moliya bo'yicha yagona mas'ul adminni belgilash
  const handleSetPayrollAdmin = (tgId: string, name: string) => {
    const newSettings: MarketSettings = {
      ...settings,
      payroll_admin_id: tgId.trim(),
    };
    onUpdateSettings(newSettings);
    showFeedback('success', `💰 ${name} muvaffaqiyatli Oylik bo'yicha Yagona Mas'ul Admin etib belgilandi! Endi faqat u maoshlarni ko'ra oladi.`);
  };

  // 2-usul: Yangi Telegram ID orqali qo'shish
  const handleAddAdminById = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTgId = newAdminTgId.trim();
    const cleanName = newAdminName.trim();

    if (!cleanTgId || !cleanName) {
      showFeedback('error', 'Admin ismi va Telegram ID raqamini kiritish shart!');
      return;
    }

    if (adminIds.includes(cleanTgId)) {
      showFeedback('error', 'Bu Telegram ID allaqachon adminlar ro\'yxatida mavjud!');
      return;
    }

    const newAdminObj: AdminMember = {
      telegram_id: cleanTgId,
      full_name: cleanName,
      phone: newAdminPhone.trim() || undefined,
      role_title: newAdminTitle.trim() || "Do'kon Ma'muri",
      added_at: new Date().toISOString(),
      is_primary: false,
    };

    const currentAdmins = settings.admins || [];
    const currentAdminIds = getAllAdminIds(settings, users);

    const updatedAdmins = [...currentAdmins, newAdminObj];
    const updatedAdminIds = Array.from(new Set([...currentAdminIds, cleanTgId]));
    const updatedAdminTgIdStr = updatedAdminIds.join(', ');

    const newSettings: MarketSettings = {
      ...settings,
      admins: updatedAdmins,
      admin_ids: updatedAdminIds,
      admin_telegram_id: updatedAdminTgIdStr,
    };

    onUpdateSettings(newSettings);
    setNewAdminName('');
    setNewAdminTgId('');
    setNewAdminPhone('');
    showFeedback('success', `🎉 "${cleanName}" admin sifatida qo'shildi! Uning Telegram ID si (${cleanTgId}) tizimga saqlandi.`);
  };

  // Adminni o'chirish
  const handleRemoveAdmin = (targetId: string, adminName: string) => {
    const isPrimary = adminList.find((a) => a.telegram_id === targetId)?.is_primary;
    if (isPrimary || adminList.length <= 1) {
      showFeedback('error', 'Asosiy adminni o\'chirib bo\'lmaydi! Tizimda kamida bitta admin bo\'lishi shart.');
      return;
    }

    setConfirmRemoveId(null);

    // Settings'dan o'chirish
    const updatedAdmins = (settings.admins || []).filter((a) => a.telegram_id !== targetId);
    const updatedAdminIds = getAllAdminIds(settings, users).filter((id) => id !== targetId);
    const updatedAdminTgIdStr = updatedAdminIds.join(', ');

    const newSettings: MarketSettings = {
      ...settings,
      admins: updatedAdmins,
      admin_ids: updatedAdminIds,
      admin_telegram_id: updatedAdminTgIdStr,
    };
    onUpdateSettings(newSettings);

    // Agar bu userlar ro'yxatida bo'lsa, role='worker' qilamiz
    const userToDemote = users.find((u) => String(u.telegram_id).trim() === targetId);
    if (userToDemote) {
      onUpdateUser({
        ...userToDemote,
        role: 'worker',
      });
    }

    showFeedback('success', `"${adminName}" adminlikdan chiqarildi. Endi u faqat oddiy ishchi panelini ko'ra oladi.`);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Sarlavha va Xavfsizlik tushuntirishi */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-bold mb-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>100% Xavfsiz Telegram ID Boshqaruvi</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2.5">
              <span>Adminlar Boshqaruvi</span>
              <Crown className="w-6 h-6 text-amber-400 fill-amber-400" />
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm mt-2 max-w-2xl leading-relaxed">
              Bu yerda ro'yxatdan o'tgan shaxslargina do'konning to'liq <b>Admin paneliga</b>, ishchilar ro'yxatiga va barcha hisobotlariga kira oladi. 
              Oddiy ishchilar va yangi xodimlar uchun Admin panel <b>umuman ko'rinmaydi</b> va kod bilan ham kirib bo'lmaydi.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-4 text-center shrink-0 w-full sm:w-auto">
            <div className="text-xs text-emerald-300 font-semibold uppercase tracking-wider">Jami Adminlar</div>
            <div className="text-3xl font-black text-white mt-1">{adminList.length} ta</div>
            <div className="text-[11px] text-slate-300 mt-1">Avtomatik ajratilgan</div>
          </div>
        </div>
      </div>

      {/* Bildirishnoma (Feedback) */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl text-sm font-semibold flex items-center gap-3 border transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <Info className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Yangi Admin Qo'shish Bloki */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-emerald-600" />
              <span>Yangi Admin Qo'shish</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Boshqa odamni admin qilish uchun qulay usulni tanlang:
            </p>
          </div>

          {/* Usulni tanlash tugmalari */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('from_workers')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'from_workers'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1. Mavjud Ishchini Admin Qilish
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('by_id')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'by_id'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2. Yangi Telegram ID orqali
            </button>
          </div>
        </div>

        {/* 1-USUL: Mavjud ishchilar orasidan admin qilish */}
        {activeTab === 'from_workers' && (
          <form onSubmit={handlePromoteWorker} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Xodimni tanlang:
                </label>
                <select
                  aria-label="Xodimni tanlang"
                  value={selectedWorkerId}
                  onChange={(e) => {
                    setSelectedWorkerId(e.target.value);
                    const selected = users.find((u) => u.id === Number(e.target.value));
                    if (selected) {
                      setWorkerTelegramIdInput(String(selected.telegram_id || ''));
                      setWorkerRoleTitle(selected.position || "Do'kon Ma'muri");
                    }
                  }}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                  required
                >
                  <option value="">-- Ishchini tanlang ({availableWorkers.length} ta mavjud) --</option>
                  {availableWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name} ({w.position || 'Ishchi'} • {w.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Lavozim nomi:
                </label>
                <input
                  type="text"
                  placeholder="Masalan: Do'kon Ma'muri yoki Menejer"
                  value={workerRoleTitle}
                  onChange={(e) => setWorkerRoleTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Telegram ID raqami:</span>
                  <span className="text-[10px] text-emerald-600 font-semibold">Botda /id</span>
                </label>
                <input
                  type="text"
                  placeholder="Masalan: 123456789"
                  value={workerTelegramIdInput}
                  onChange={(e) => setWorkerTelegramIdInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Tanlangan xodim shu zahoti do'konning barcha boshqaruv huquqiga ega bo'ladi.</span>
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Crown className="w-4 h-4" />
                <span>Admin Huquqini Berish</span>
              </button>
            </div>
          </form>
        )}

        {/* 2-USUL: Yangi Telegram ID orqali qo'shish */}
        {activeTab === 'by_id' && (
          <form onSubmit={handleAddAdminById} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Admin Ism-Familiyasi:
                </label>
                <input
                  type="text"
                  placeholder="Masalan: Otabek Ergashev"
                  value={newAdminName}
                  onChange={(e) => setNewAdminName(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Telegram ID raqami:</span>
                  <span className="text-[10px] text-emerald-600 font-semibold">Botda /id</span>
                </label>
                <input
                  type="text"
                  placeholder="Masalan: 987654321"
                  value={newAdminTgId}
                  onChange={(e) => setNewAdminTgId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Lavozimi:
                </label>
                <input
                  type="text"
                  placeholder="Masalan: Do'kon Ma'muri"
                  value={newAdminTitle}
                  onChange={(e) => setNewAdminTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Telefon raqami (Ixtiyoriy):
                </label>
                <input
                  type="text"
                  placeholder="+998 90 123 45 67"
                  value={newAdminPhone}
                  onChange={(e) => setNewAdminPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                />
              </div>
            </div>

            {/* Qulay Yo'riqnoma bloki */}
            <div className="p-3.5 bg-amber-50/80 rounded-2xl border border-amber-200/70 flex items-start gap-3 text-xs text-amber-900">
              <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Yangi admin o'z Telegram ID raqamini qayerdan oladi?</span>
                <p className="text-amber-800 text-[11px] mt-0.5">
                  Yangi admin botingizga kirib <b><code>/id</code></b> deb yozsa, bot darhol uning shaxsiy raqamini chiqarib beradi. O'sha raqamni nusxalab shu yerga kiriting!
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Adminni Saqlash</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Amaldagi Adminlar Ro'yxati */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
        {/* Yagona Oylik Admini Bloki */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-50 via-rose-50 to-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <DollarSign className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase text-amber-900 tracking-wider">
                  Oylik va Moliya bo'yicha Yagona Mas'ul Admin:
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold border border-rose-200">
                  <Lock className="w-3 h-3 text-rose-600" />
                  <span>Maxfiy</span>
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {(() => {
                  const assigned = adminList.find((a) => a.telegram_id === (settings.payroll_admin_id || '').trim());
                  if (assigned) {
                    return `👑 ${assigned.full_name} (${assigned.role_title || "Admin"} · ID: ${assigned.telegram_id})`;
                  }
                  return "⚠️ Hozircha yagona admin belgilanmagan";
                })()}
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 self-end sm:self-center">
            Faqat bitta admin ko'ra oladi
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-500 fill-amber-500" />
              <span>Amaldagi Adminlar ({adminList.length})</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ushbu Telegram ID egalari tizimga kirganda avtomatik Admin paneli ochiladi.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {adminList.map((adm, idx) => {
            const isCopied = copiedId === adm.telegram_id;
            const isPayrollAdmin = (settings.payroll_admin_id || '').trim() === (adm.telegram_id || '').trim();
            return (
              <div
                key={adm.telegram_id || idx}
                className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white transition flex items-center justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-base shadow-xs shrink-0 ${
                      adm.is_primary
                        ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white'
                        : 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white'
                    }`}
                  >
                    {adm.is_primary ? <Crown className="w-6 h-6 fill-white" /> : adm.full_name.charAt(0)}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-slate-900 text-sm truncate">
                        {adm.full_name}
                      </span>
                      {adm.is_primary && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200 shrink-0">
                          Asosiy
                        </span>
                      )}
                      {isPayrollAdmin && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 shrink-0 flex items-center gap-1">
                          <Lock className="w-3 h-3 text-rose-600" />
                          <span>Oylik Mas'uli</span>
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5 truncate">
                      <span>{adm.role_title || "Do'kon Ma'muri"}</span>
                      {adm.phone && <span>• {adm.phone}</span>}
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400 font-medium">TG ID:</span>
                        <code className="text-xs font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                          {adm.telegram_id}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopy(adm.telegram_id)}
                          className="p-1 hover:bg-slate-200 rounded-lg text-slate-500 transition cursor-pointer"
                          title="ID nusxalash"
                        >
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {adm.telegram_id && !isPayrollAdmin && (
                        <button
                          type="button"
                          onClick={() => handleSetPayrollAdmin(adm.telegram_id, adm.full_name)}
                          className="px-2 py-0.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[10px] transition cursor-pointer flex items-center gap-1"
                          title="Ushbu adminni Oylik bo'yicha yagona mas'ul qilish"
                        >
                          <Lock className="w-3 h-3 text-amber-700" />
                          <span>Oylik mas'uli qilish</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* O'chirish tugmasi */}
                <div className="shrink-0">
                  {adm.is_primary ? (
                    <span className="text-[11px] text-slate-400 font-semibold px-2 py-1 bg-slate-100 rounded-xl">
                      Himoyalangan
                    </span>
                  ) : confirmRemoveId === adm.telegram_id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRemoveAdmin(adm.telegram_id, adm.full_name)}
                        className="px-2.5 py-1 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition cursor-pointer"
                      >
                        Ha, olish
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(null)}
                        className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                      >
                        Bekor
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(adm.telegram_id)}
                      className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition cursor-pointer border border-transparent hover:border-rose-200"
                      title="Adminlikdan olish"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
