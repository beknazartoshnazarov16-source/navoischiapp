import React, { useState } from 'react';
import { Attendance, MarketSettings, User, StoreAnnouncement } from '../types';
import {
  Bell,
  Clock,
  Send,
  CheckCircle2,
  AlertCircle,
  Megaphone,
  Sun,
  Trash2,
  Users,
  Sparkles,
  Smartphone,
  ShieldAlert,
  Radio,
  Timer,
  Check,
} from 'lucide-react';
import { formatMinutesToHours, formatUzDate, getLocalDateString } from '../utils/calculations';
import { sendTelegramNotification, triggerHaptic } from '../utils/telegram';

interface RemindersManagerProps {
  settings: MarketSettings;
  users: User[];
  attendances: Attendance[];
  onSaveSettings: (newSettings: MarketSettings) => void;
}

export function RemindersManager({
  settings,
  users,
  attendances,
  onSaveSettings,
}: RemindersManagerProps) {
  const [activeTab, setActiveTab] = useState<'six_hours' | 'open_shifts' | 'morning' | 'announcement'>('six_hours');
  const [isSending, setIsSending] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // E'lon yaratish formasi
  const [announcementTitle, setAnnouncementTitle] = useState(settings.active_announcement?.title || '');
  const [announcementMsg, setAnnouncementMsg] = useState(settings.active_announcement?.message || '');
  const [announcementUrgency, setAnnouncementUrgency] = useState<'normal' | 'high'>(
    settings.active_announcement?.urgency || 'normal'
  );

  const todayStr = getLocalDateString(new Date());
  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentTotalMins = currentHours * 60 + currentMinutes;

  const workers = users.filter((u) => u.role === 'worker' && u.is_active !== false);

  // 1. Hozir ishlayotganlar
  const activeAttendances = attendances.filter(
    (a) => a.status === 'working' || a.status === 'on_break'
  );

  // 2. Ochiq qolgan / unutilgan smenalar
  const shiftOverdueWorkers = activeAttendances.map((att) => {
    const worker = users.find((u) => u.id === att.user_id);
    const [inH, inM] = att.check_in_time.split(':').map(Number);
    const inTotalMins = (inH || 0) * 60 + (inM || 0);

    let [endH, endM] = (worker?.work_end_time || '20:00').split(':').map(Number);
    let endTotalMins = (endH || 20) * 60 + (endM || 0);

    const isPastDate = att.date < todayStr;
    const isPastWorkEndTime = att.date === todayStr && currentTotalMins > endTotalMins;
    const isLongDuration = isPastDate || currentTotalMins - inTotalMins > 660; // 11 soatdan ko'p

    return {
      attendance: att,
      worker,
      isOverdue: isPastDate || isPastWorkEndTime || isLongDuration,
      inTime: att.check_in_time,
      date: att.date,
      endTime: worker?.work_end_time || '20:00',
    };
  });

  const overdueList = shiftOverdueWorkers.filter((item) => item.isOverdue);

  // 3. Bugun hali ishga kelmaganlar
  const todayCheckedInWorkerIds = new Set(
    attendances.filter((a) => a.date === todayStr).map((a) => a.user_id)
  );
  const notCheckedInWorkers = workers.filter((w) => !todayCheckedInWorkerIds.has(w.id));

  const showStatus = (type: 'success' | 'error', message: string) => {
    setStatusNotice({ type, message });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    setTimeout(() => setStatusNotice(null), 4000);
  };

  // =========================================================================
  // 📢 HAR 6 SOATLIK DAVOMAT MONITORINGI VA QAT'IY ESLATMANI JO'NATISH
  // =========================================================================
  const handleSendSixHoursSummary = async () => {
    if (!settings.bot_token) {
      showStatus('error', "Sozlamalarda Telegram Bot Token kiritilmagan!");
      return;
    }

    const targetGroup = settings.group_telegram_id;
    const targetAdmin = settings.admin_telegram_id;
    const targets = [targetGroup, targetAdmin].filter(Boolean) as string[];

    if (targets.length === 0) {
      showStatus('error', "Iltimos, sozlamalarda Do'kon guruhi ID yoki Admin Telegram ID sini kiriting!");
      return;
    }

    setIsSending(true);

    const timeStr = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    const dateStr = formatUzDate(todayStr);

    let activeListText = '';
    if (activeAttendances.length > 0) {
      activeListText = activeAttendances
        .map((att, idx) => {
          const w = users.find((u) => u.id === att.user_id);
          const pos = w?.position ? ` — ${w.position}` : '';
          const breakState = att.status === 'on_break' ? ' (☕️ tanaffusda)' : '';
          return `${idx + 1}. <b>${w?.full_name || 'Xodim'}</b>${pos} (kelgan: ${att.check_in_time.slice(0, 5)}${breakState})`;
        })
        .join('\n');
    } else {
      activeListText = "<i>Hozircha smenada faol xodim yo'q</i>";
    }

    let notCheckedInText = '';
    if (notCheckedInWorkers.length > 0) {
      notCheckedInText = notCheckedInWorkers
        .map((w, idx) => {
          const pos = w.position ? ` — ${w.position}` : '';
          return `${idx + 1}. ${w.full_name}${pos}`;
        })
        .join('\n');
    } else {
      notCheckedInText = "✅ <i>Barcha faol xodimlar bugun davomatdan o'tgan!</i>";
    }

    const text =
      `📢 <b>${settings.shop_name || 'Navo Market'} — DAVOMAT VA ISH VAQTI MONITORINGI (6 SOATLIK XULOSA)</b>\n` +
      `⏰ Vaqt: <b>${timeStr}</b> | Sana: <b>${dateStr}</b>\n\n` +
      `🟢 <b>HOZIR ISHDA BO'LGANLAR (${activeAttendances.length} kishi):</b>\n` +
      `${activeListText}\n\n` +
      `🔴 <b>BUGUN HALI KELMAGANLAR / ISHDA BO'LMAGANLAR (${notCheckedInWorkers.length} kishi):</b>\n` +
      `${notCheckedInText}\n\n` +
      `⚠️ <b>DIQQAT! ISH TARTIB-QOIDASI VA QAT'IY ESLATMA:</b>\n` +
      `Hurmatli xodimlar!\n` +
      `Do'konga kelganingizda darhol <b>«📍 ISHGA KELDIM»</b> va ishdan ketayotganingizda albatta <b>«🏃‍♂️ ISHDAN KETDIM»</b> tugmasini bosing!\n\n` +
      `<i>Davomat avtomat tizimda daqiqama-daqiqa hisoblanadi. O'z vaqtida bosilmagan vaqt hisobga olinmasligi mumkin!</i>`;

    let successCount = 0;
    const uniqueTargets = Array.from(new Set(targets));
    for (const chat of uniqueTargets) {
      const res = await sendTelegramNotification(settings.bot_token, chat, text);
      if (res.success) successCount++;
    }

    setIsSending(false);

    if (successCount > 0) {
      onSaveSettings({
        ...settings,
        reminder_six_hours_last_sent: new Date().toISOString(),
      });
      showStatus(
        'success',
        `6 soatlik hisobot va eslatma guruh va botga muvaffaqiyatli jo'natildi! (${successCount} ta chatga)`
      );
    } else {
      showStatus('error', "Xabar yuborilmadi. Iltimos Bot Token va Chat ID larni tekshiring.");
    }
  };

  // Xodimga ketish eslatmasini yuborish
  const handleSendCheckoutReminder = async (worker: User, att: Attendance) => {
    if (!settings.bot_token) {
      showStatus('error', "Sozlamalarda Bot Token kiritilmagan!");
      return;
    }

    const targetChatId = worker.telegram_id
      ? String(worker.telegram_id)
      : settings.group_telegram_id || settings.admin_telegram_id;

    if (!targetChatId) {
      showStatus('error', "Ushbu xodimning Telegram ID raqami yoki do'kon guruhi kiritilmagan!");
      return;
    }

    setIsSending(true);
    const text =
      `⏰ <b>Navo Market — Ishdan Ketish Eslatmasi!</b>\n\n` +
      `Hurmatli <b>${worker.full_name}</b>!\n` +
      `Siz bugun soat <b>${att.check_in_time}</b> da ishga kelgansiz. Ish vaqti rejangiz yakunlandi.\n\n` +
      `📍 Iltimos, Telegram botga kirib <b>«🏃‍♂️ ISHDAN KETDIM»</b> tugmasini bosishni unutmang, aks holda ish soatingiz noaniq bo'lib qolishi mumkin.`;

    const res = await sendTelegramNotification(settings.bot_token, targetChatId, text);
    setIsSending(false);

    if (res.success) {
      showStatus('success', `«${worker.full_name}» ga eslatma muvaffaqiyatli jo'natildi!`);
    } else {
      showStatus('error', res.error || "Xabar yuborilmadi.");
    }
  };

  // Barcha unutilganlarga birvarakay eslatma yuborish
  const handleSendAllCheckoutReminders = async () => {
    if (overdueList.length === 0) return;
    if (!settings.bot_token) {
      showStatus('error', "Sozlamalarda Bot Token kiritilmagan!");
      return;
    }

    setIsSending(true);
    let sentCount = 0;

    for (const item of overdueList) {
      if (!item.worker) continue;
      const targetChatId = item.worker.telegram_id
        ? String(item.worker.telegram_id)
        : settings.group_telegram_id || settings.admin_telegram_id;

      if (!targetChatId) continue;

      const text =
        `⏰ <b>Navo Market — Ishdan Ketish Eslatmasi!</b>\n\n` +
        `Hurmatli <b>${item.worker.full_name}</b>!\n` +
        `Sizning smenangiz tugagan. Iltimos, botda <b>«🏃‍♂️ ISHDAN KETDIM»</b> tugmasini bosib qo'ying!`;

      const res = await sendTelegramNotification(settings.bot_token, targetChatId, text);
      if (res.success) sentCount++;
    }

    setIsSending(false);
    showStatus('success', `${sentCount} ta xodimga ketish eslatmasi jo'natildi!`);
  };

  // Bugun kelmaganlarga ertalabki eslatma yuborish
  const handleSendMorningReminder = async () => {
    if (notCheckedInWorkers.length === 0) {
      showStatus('success', "Bugun hamma ishchilar davomatni belgilab bo'lgan!");
      return;
    }
    if (!settings.bot_token) {
      showStatus('error', "Sozlamalarda Bot Token kiritilmagan!");
      return;
    }

    const targetChat = settings.group_telegram_id || settings.admin_telegram_id;
    if (!targetChat) {
      showStatus('error', "Xabarnoma yuborish uchun do'kon guruhi yoki admin Telegram ID si kerak!");
      return;
    }

    setIsSending(true);
    const workerNames = notCheckedInWorkers.map((w) => `• ${w.full_name} (${w.position})`).join('\n');
    const text =
      `☀️ <b>Navo Market — Ertalabki Davomat Eslatmasi!</b>\n\n` +
      `Do'konda ish vaqti boshlandi. Hali davomatni belgilamagan xodimlar:\n\n` +
      `${workerNames}\n\n` +
      `📍 <i>Iltimos, do'konga kelgach darhol botda «📍 Ishga keldim»ni bosing!</i>`;

    const res = await sendTelegramNotification(settings.bot_token, targetChat, text);
    setIsSending(false);

    if (res.success) {
      showStatus('success', "Ertalabki eslatma guruhga muvaffaqiyatli jo'natildi!");
    } else {
      showStatus('error', res.error || "Xabar yuborilmadi.");
    }
  };

  // Rahbariyat e'lonini saqlash
  const handleSaveAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementTitle.trim() || !announcementMsg.trim()) {
      showStatus('error', "Iltimos, e'lon sarlavhasi va matnini kiriting!");
      return;
    }

    const newAnnouncement: StoreAnnouncement = {
      id: Date.now().toString(),
      title: announcementTitle.trim(),
      message: announcementMsg.trim(),
      date: todayStr,
      urgency: announcementUrgency,
      created_by: "Do'kon Rahbariyati",
    };

    onSaveSettings({
      ...settings,
      active_announcement: newAnnouncement,
    });

    if (settings.bot_token && (settings.group_telegram_id || settings.admin_telegram_id)) {
      const targetChat = settings.group_telegram_id || settings.admin_telegram_id;
      const text =
        `📢 <b>Navo Market — Rahbariyat Eslatmasi!</b>\n\n` +
        `<b>${newAnnouncement.title}</b>\n\n` +
        `${newAnnouncement.message}\n\n` +
        `📅 Sana: ${formatUzDate(todayStr)}`;
      sendTelegramNotification(settings.bot_token, targetChat, text);
    }

    showStatus('success', "Eslatma saqlandi va barcha xodimlarning botida faollashtirildi!");
  };

  // E'lonni o'chirish
  const handleRemoveAnnouncement = () => {
    onSaveSettings({
      ...settings,
      active_announcement: null,
    });
    setAnnouncementTitle('');
    setAnnouncementMsg('');
    showStatus('success', "Eslatma bekor qilindi.");
  };

  // 6 soatlik rejimni o'zgartirish
  const toggleSixHoursReminder = () => {
    const nextVal = settings.reminder_six_hours_enabled === false ? true : false;
    onSaveSettings({
      ...settings,
      reminder_six_hours_enabled: nextVal,
    });
    showStatus('success', nextVal ? "Har 6 soatlik avto-monitoring yoqildi!" : "Har 6 soatlik avto-monitoring o'chirildi.");
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      {/* Sarlavha bloki */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 text-white flex items-center justify-center shrink-0 shadow-md">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900">
                Aqlli Eslatmalar va Monitoring
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black">
                Har 6 soatda avto
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Do'kondagi joriy davomat, ishda kim bor/yo'qligi va keldim-ketdim qat'iy eslatmasi
            </p>
          </div>
        </div>

        {/* Tezkor 6 Soatlik Xulosani Yuborish Tugmasi */}
        <button
          type="button"
          disabled={isSending}
          onClick={handleSendSixHoursSummary}
          className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 text-white rounded-2xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer shadow-md whitespace-nowrap active:scale-95"
        >
          <Send className="w-4 h-4" />
          <span>📢 6 Soatlik Xulosani Guruh va Botga Yuborish</span>
        </button>
      </div>

      {/* Holat bildirishnomasi */}
      {statusNotice && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2.5 animate-in fade-in ${
            statusNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusNotice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{statusNotice.message}</span>
        </div>
      )}

      {/* Ichki Tablar */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('six_hours')}
          className={`flex items-center gap-2 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'six_hours'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Radio className="w-4 h-4 text-amber-500" />
          <span>📢 Har 6 Soatlik Monitoring</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('open_shifts')}
          className={`flex items-center gap-2 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'open_shifts'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4 text-rose-500" />
          <span>Ketishni Unutganlar ({overdueList.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('morning')}
          className={`flex items-center gap-2 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'morning'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sun className="w-4 h-4 text-amber-600" />
          <span>Bugun Kelmaganlar ({notCheckedInWorkers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('announcement')}
          className={`flex items-center gap-2 py-2.5 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'announcement'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Megaphone className="w-4 h-4 text-emerald-600" />
          <span>Do'kon E'loni</span>
        </button>
      </div>

      {/* ======================================================== */}
      {/* 0. HAR 6 SOATLIK MONITORING BO'LIMI (YANGI & ASOSIY)       */}
      {/* ======================================================== */}
      {activeTab === 'six_hours' && (
        <div className="space-y-4">
          {/* Yuqori tezkor statistika bloklari */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-4 flex items-center gap-3.5 shadow-2xs">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 font-black">
                {activeAttendances.length}
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-950">Hozir Ishda Bo'lganlar</div>
                <div className="text-[11px] text-emerald-700">Faol smenadagi xodimlar</div>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-3xl p-4 flex items-center gap-3.5 shadow-2xs">
              <div className="w-10 h-10 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 font-black">
                {notCheckedInWorkers.length}
              </div>
              <div>
                <div className="text-xs font-bold text-rose-950">Hali Kelmaganlar</div>
                <div className="text-[11px] text-rose-700">Bugun kelmagan faol xodimlar</div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 flex items-center gap-3.5 shadow-2xs">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                <Timer className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-amber-950">6 Soatlik Jadval</div>
                <div className="text-[11px] text-amber-800 font-semibold">06:00 · 12:00 · 18:00 · 00:00</div>
              </div>
            </div>
          </div>

          {/* Asosiy Ishchi Oyna va Jonli Preview */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <span>Telegram Guruh va Bot Uchun 6 Soatlik Xabarnoma</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Telegram guruhga va botga kimlar ishda, kimlar yo'qligi hamda «Keldim-ketdim»ni bosish haqidagi qat'iy eslatma boradi.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={toggleSixHoursReminder}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 cursor-pointer ${
                    settings.reminder_six_hours_enabled !== false
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-slate-100 border-slate-300 text-slate-600'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      settings.reminder_six_hours_enabled !== false ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    Avto-yuborish: {settings.reminder_six_hours_enabled !== false ? 'Faol (Yoqilgan)' : "O'chirilgan"}
                  </span>
                </button>
              </div>
            </div>

            {/* Telegram Jonli Ko'rinishi (Live Preview) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                  <span>Guruh va Botga Boradigan Xabarning Jonli Ko'rinishi (Preview):</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Guruh: {settings.group_telegram_id || 'Kiritilmagan'} · Bot: Faol
                </span>
              </div>

              <div className="p-4 sm:p-5 bg-gradient-to-b from-[#eef2f5] to-[#e4eaf0] rounded-2xl border border-slate-300 font-sans shadow-inner max-w-2xl mx-auto">
                <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-200/80 space-y-3.5 text-xs text-slate-800 leading-relaxed">
                  <div className="flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-2">
                    <span className="text-base">📢</span>
                    <div>
                      <div className="font-black text-slate-900 text-xs sm:text-sm">
                        {settings.shop_name || 'Navo Market'} — DAVOMAT VA MONITORING
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ⏰ Vaqt: {now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })} | Sana: {formatUzDate(todayStr)}
                      </div>
                    </div>
                  </div>

                  {/* 🟢 Ishda bo'lganlar */}
                  <div>
                    <div className="font-extrabold text-emerald-800 flex items-center gap-1.5 mb-1">
                      <span>🟢 HOZIR ISHDA BO'LGANLAR ({activeAttendances.length} kishi):</span>
                    </div>
                    {activeAttendances.length > 0 ? (
                      <div className="space-y-0.5 pl-2 text-[11px]">
                        {activeAttendances.map((att, idx) => {
                          const w = users.find((u) => u.id === att.user_id);
                          return (
                            <div key={att.id} className="text-slate-700">
                              {idx + 1}. <b className="text-slate-900">{w?.full_name || 'Xodim'}</b>
                              {w?.position ? ` — ${w.position}` : ''}{' '}
                              <span className="text-slate-500">
                                (kelgan: {att.check_in_time.slice(0, 5)}
                                {att.status === 'on_break' ? ' ☕️ tanaffusda' : ''})
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic pl-2">
                        Hozircha smenada faol xodim yo'q
                      </div>
                    )}
                  </div>

                  {/* 🔴 Bugun kelmaganlar */}
                  <div>
                    <div className="font-extrabold text-rose-800 flex items-center gap-1.5 mb-1">
                      <span>🔴 BUGUN HALI KELMAGANLAR ({notCheckedInWorkers.length} kishi):</span>
                    </div>
                    {notCheckedInWorkers.length > 0 ? (
                      <div className="space-y-0.5 pl-2 text-[11px]">
                        {notCheckedInWorkers.map((w, idx) => (
                          <div key={w.id} className="text-slate-700">
                            {idx + 1}. {w.full_name}
                            {w.position ? <span className="text-slate-400"> — {w.position}</span> : ''}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-600 font-bold pl-2">
                        ✅ Barcha faol xodimlar bugun davomatdan o'tgan!
                      </div>
                    )}
                  </div>

                  {/* ⚠️ Qat'iy Eslatma */}
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-950 space-y-1">
                    <div className="font-black text-amber-900 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                      <span>DIQQAT! ISH TARTIB-QOIDASI VA QAT'IY ESLATMA:</span>
                    </div>
                    <p className="text-slate-700">
                      Hurmatli xodimlar! Do'konga kelganingizda darhol <b>«📍 ISHGA KELDIM»</b> va ishdan ketayotganingizda albatta <b>«🏃‍♂️ ISHDAN KETDIM»</b> tugmasini bosing!
                    </p>
                    <p className="text-[10px] text-amber-800 italic">
                      Davomat avtomat tizimda daqiqama-daqiqa hisoblanadi. O'z vaqtida bosilmagan vaqt hisobga olinmasligi mumkin!
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Yuborish tugmasi va tushuntirish */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                <span className="font-bold text-slate-700">Avto-rejim:</span> Python bot har kuni soat <b>06:00, 12:00, 18:00 va 00:00</b> da buni avtomat guruhga yuboradi. Shuningdek, xohlagan payt qo'lda ham yuborishingiz mumkin.
              </div>

              <button
                type="button"
                disabled={isSending}
                onClick={handleSendSixHoursSummary}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-95 whitespace-nowrap"
              >
                <Send className="w-4 h-4 text-amber-400" />
                <span>Ushbu Xabarni Hozir Guruhga Jo'natish</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. KETISHNI UNUTGANLAR BO'LIMI                             */}
      {/* ======================================================== */}
      {activeTab === 'open_shifts' && (
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                Smenasi Tugagan, Lekin Ketishni Bosmagan Xodimlar
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Ushbu xodimlarning ish vaqti tugagan yoki 11+ soatdan beri yopilmagan.
              </p>
            </div>

            {overdueList.length > 0 && (
              <button
                type="button"
                disabled={isSending}
                onClick={handleSendAllCheckoutReminders}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer active:scale-95"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Barchasiga Eslatma Yuborish ({overdueList.length})</span>
              </button>
            )}
          </div>

          {overdueList.length === 0 ? (
            <div className="text-center py-10 px-4 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <h4 className="text-sm font-bold text-emerald-900">
                Ajoyib! Ketishni unutgan hech kim yo'q
              </h4>
              <p className="text-xs text-emerald-700/80 mt-1 max-w-md mx-auto">
                Barcha faol ishchilar o'z smena vaqtida yoki belgilangan vaqtda ketishni qayd etib bormoqda.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {overdueList.map(({ attendance, worker, inTime, date, endTime }) => (
                <div
                  key={attendance.id}
                  className="p-3.5 sm:p-4 bg-amber-50/60 rounded-2xl border border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition hover:border-amber-300"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-500 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                      {worker?.full_name ? worker.full_name.charAt(0) : 'X'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 truncate">
                          {worker?.full_name || "Noma'lum xodim"}
                        </span>
                        <span className="text-[10px] bg-rose-100 text-rose-800 font-extrabold px-1.5 py-0.5 rounded-md shrink-0">
                          ⚠️ Smena tugagan
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Kelgan vaqti: <b>{inTime}</b> ({date}) · Reja tugash vaqti: <b>{endTime}</b>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSending}
                    onClick={() => worker && handleSendCheckoutReminder(worker, attendance)}
                    className="px-3.5 py-2 bg-white hover:bg-amber-100 text-amber-900 rounded-xl border border-amber-300 text-xs font-bold transition flex items-center justify-center gap-1.5 shrink-0 shadow-2xs cursor-pointer active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5 text-amber-600" />
                    <span>Telegramda Eslatish</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. BUGUN KELMAGANLAR BO'LIMI                               */}
      {/* ======================================================== */}
      {activeTab === 'morning' && (
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                Bugun Hali Kelmagan Xodimlar ({notCheckedInWorkers.length} ta)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Ertalabki ish vaqti boshlangach, kelmagan xodimlarga do'kon guruhi orqali umumiy eslatma yuboring.
              </p>
            </div>

            {notCheckedInWorkers.length > 0 && (
              <button
                type="button"
                disabled={isSending}
                onClick={handleSendMorningReminder}
                className="px-3.5 py-2 bg-gradient-to-r from-[#00a651] to-[#008f45] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer active:scale-95"
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Guruhga Ertalabki Eslatma Yuborish</span>
              </button>
            )}
          </div>

          {notCheckedInWorkers.length === 0 ? (
            <div className="text-center py-10 px-4 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <h4 className="text-sm font-bold text-emerald-900">Barcha xodimlar ishda!</h4>
              <p className="text-xs text-emerald-700/80 mt-1">
                Bugun barcha faol ishchilar «Ishga keldim» deb belgilagan.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {notCheckedInWorkers.map((w) => (
                <div
                  key={w.id}
                  className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center shrink-0">
                      {w.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {w.full_name}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {w.position} · Reja: {w.work_start_time || '08:00'}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md shrink-0">
                    Kelmagan
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. DO'KON E'LONI VA MAXSUS ESLATMA                          */}
      {/* ======================================================== */}
      {activeTab === 'announcement' && (
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-5">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-900">
              Do'kon Jamoasi Uchun Umumiy E'lon / Eslatma
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Bu yerda yozilgan eslatma barcha xodimlarning telefon ekranida (botda) ko'zga ko'rinadigan qilib chiqadi.
            </p>
          </div>

          {settings.active_announcement && (
            <div className="p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 rounded-2xl border border-emerald-300 relative shadow-2xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Megaphone className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                    Hozirda Faol E'lon:
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveAnnouncement}
                  className="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-700 rounded-lg text-xs font-bold border border-slate-200 hover:border-rose-300 transition cursor-pointer flex items-center gap-1 shadow-2xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Bekor qilish</span>
                </button>
              </div>

              <div className="mt-2 text-sm font-bold text-slate-900">
                {settings.active_announcement.title}
              </div>
              <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">
                {settings.active_announcement.message}
              </p>
              <div className="mt-2 text-[10px] text-emerald-700 font-semibold">
                Sana: {formatUzDate(settings.active_announcement.date)}
              </div>
            </div>
          )}

          <form onSubmit={handleSaveAnnouncement} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                E'lon sarlavhasi:
              </label>
              <input
                type="text"
                placeholder="Masalan: Ertaga tovar sanog'i (reviziya) bor"
                value={announcementTitle}
                onChange={(e) => setAnnouncementTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-[#00a651] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                E'lon matni / Eslatma tafsilotlari:
              </label>
              <textarea
                rows={3}
                placeholder="Barcha xodimlar ertaga soat 07:45 gacha kelishi shart..."
                value={announcementMsg}
                onChange={(e) => setAnnouncementMsg(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-[#00a651] outline-none"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="urgency"
                  checked={announcementUrgency === 'normal'}
                  onChange={() => setAnnouncementUrgency('normal')}
                  className="accent-[#00a651]"
                />
                <span>Oddiy eslatma</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-bold text-rose-700 cursor-pointer">
                <input
                  type="radio"
                  name="urgency"
                  checked={announcementUrgency === 'high'}
                  onChange={() => setAnnouncementUrgency('high')}
                  className="accent-rose-600"
                />
                <span>Muhim / Shoshilinch</span>
              </label>
            </div>

            <button
              type="submit"
              className="py-2.5 px-5 bg-gradient-to-r from-[#00a651] to-[#008f45] hover:opacity-95 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-95"
            >
              <Megaphone className="w-4 h-4" />
              <span>Eslatmani Saqlash va Xodimlarga Chiqarish</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
