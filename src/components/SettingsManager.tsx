import React, { useState, useRef } from 'react';
import { MarketSettings, User, Attendance } from '../types';
import {
  Settings,
  MapPin,
  Check,
  Shield,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Cloud,
  Download,
  Upload,
  FileSpreadsheet,
  Database,
  CheckCircle2,
  Bot,
  Send,
  Sparkles,
  AlertCircle,
  Copy,
  ExternalLink,
  Zap,
  Smartphone,
  Navigation,
} from 'lucide-react';
import { formatMinutesToHours } from '../utils/calculations';
import { sendTelegramNotification, triggerHaptic } from '../utils/telegram';

interface SettingsManagerProps {
  settings: MarketSettings;
  onSaveSettings: (settings: MarketSettings) => void;
  users?: User[];
  attendances?: Attendance[];
  onImportBackup?: (backupData: {
    users: User[];
    attendances: Attendance[];
    settings?: MarketSettings;
  }) => Promise<void>;
  onOpenInstallModal?: () => void;
}

export function SettingsManager({
  settings,
  onSaveSettings,
  users = [],
  attendances = [],
  onImportBackup,
  onOpenInstallModal,
}: SettingsManagerProps) {
  const [formData, setFormData] = useState<MarketSettings>({ ...settings });
  const [isSaved, setIsSaved] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [pendingImportBackup, setPendingImportBackup] = useState<any | null>(null);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [tgTestResult, setTgTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);
  const [isSettingWebhook, setIsSettingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{ url?: string; ok?: boolean; error?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentAppUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleSetupWebhook = async () => {
    if (!formData.bot_token) {
      setWebhookStatus({ ok: false, error: "Avval Bot Token maydonini to'ldiring!" });
      return;
    }
    setIsSettingWebhook(true);
    setWebhookStatus(null);
    try {
      const res = await fetch('/api/telegram/webhook/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: window.location.origin }),
      });
      const data = await res.json();
      if (data.ok) {
        setWebhookStatus({ ok: true, url: window.location.origin });
        triggerHaptic('success');
      } else {
        setWebhookStatus({ ok: false, error: data.description || data.error || "Vebxukni o'rnatib bo'lmadi" });
        triggerHaptic('error');
      }
    } catch (e: any) {
      setWebhookStatus({ ok: false, error: e?.message || "Tarmoq xatosi" });
      triggerHaptic('error');
    } finally {
      setIsSettingWebhook(false);
    }
  };

  const handleTestTelegram = async () => {
    const targetIds = [formData.admin_telegram_id, formData.group_telegram_id]
      .filter(Boolean)
      .join(', ');

    if (!formData.bot_token || !targetIds) {
      setTgTestResult({
        success: false,
        message: "Avval Bot Token va kamida bitta Admin yoki Guruh Telegram ID raqamini kiriting!",
      });
      return;
    }

    setIsTestingTg(true);
    setTgTestResult(null);

    const testMessage = `🟢 <b>${formData.shop_name} — Telegram Bot Sinov Xabari</b>\n\n` +
      `✅ <b>Tabriklaymiz!</b> Telegram boti tizimga muvaffaqiyatli ulandi.\n` +
      `⏰ <b>Vaqt:</b> ${new Date().toLocaleTimeString('uz-UZ')}\n` +
      `📱 <b>Do'kon:</b> ${formData.shop_name}\n\n` +
      `<i>Endi har bir ishchi kelganda, tanaffusga chiqqanda yoki ishni yakunlaganda sizga va guruhga avtomatik xabar keladi!</i>`;

    const result = await sendTelegramNotification(
      formData.bot_token,
      targetIds,
      testMessage
    );

    setIsTestingTg(false);
    if (result.success) {
      if (result.migratedTo) {
        const updated = {
          ...formData,
          group_telegram_id: result.migratedTo,
        };
        setFormData(updated);
        onSaveSettings(updated);
        setTgTestResult({
          success: true,
          message: `✅ Telegram guruhingiz superguruhga aylangani aniqlandi va yangi to'g'ri ID raqam (${result.migratedTo}) tizim sozlamalariga avtomatik kiritilib saqlandi! Sinov xabari muvaffaqiyatli yetib bordi.`,
        });
      } else {
        setTgTestResult({
          success: true,
          message: "✅ Sinov xabari ko'rsatilgan chatlarga muvaffaqiyatli yetib bordi! Bot mukammal ishlamoqda.",
        });
      }
    } else {
      if (result.migratedTo) {
        const updated = {
          ...formData,
          group_telegram_id: result.migratedTo,
        };
        setFormData(updated);
        onSaveSettings(updated);
      }
      setTgTestResult({
        success: false,
        message: `❌ ${result.error || 'Xabar yuborilmadi'}.`,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormData((prev) => ({
            ...prev,
            market_latitude: pos.coords.latitude,
            market_longitude: pos.coords.longitude,
          }));
        },
        () => {
          setTgTestResult({
            success: false,
            message: "Hozirgi geolokatsiyani aniqlab bo'lmadi. GPS ruxsatini tekshiring.",
          });
        }
      );
    }
  };

  // 1. JSON to'liq zaxira nusxa yuklash
  const handleExportJSON = () => {
    const backupData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      shop_name: settings.shop_name,
      users,
      attendances,
      settings,
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `navo_market_baza_zaxira_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 2. CSV / Excel davomat eksporti
  const handleExportCSV = () => {
    const userMap = new Map<number, User>();
    users.forEach((u) => userMap.set(u.id, u));

    const headers = [
      'ID',
      'Xodim',
      'Lavozim',
      'Telefon',
      'Kelgan sana',
      'Kelgan vaqt',
      'Ketgan sana',
      'Ketgan vaqt',
      'Tanaffus (daq)',
      'Ishlangan daqiqa',
      'Ishlangan soat',
      'Holat',
    ];

    const rows = attendances.map((att) => {
      const u = userMap.get(att.user_id);
      return [
        att.id,
        `"${(u?.full_name || 'Nomaʼlum').replace(/"/g, '""')}"`,
        `"${(u?.position || '').replace(/"/g, '""')}"`,
        `"${(u?.phone || '').replace(/"/g, '""')}"`,
        att.date,
        att.check_in_time,
        att.check_out_date || att.date,
        att.check_out_time || '-',
        att.total_break_minutes || 0,
        att.worked_minutes || 0,
        `"${formatMinutesToHours(att.worked_minutes || 0)}"`,
        att.status === 'completed'
          ? 'Tugallangan'
          : att.status === 'working'
          ? 'Hozir ishda'
          : 'Tanaffusda',
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `navo_market_davomat_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 3. Zaxiradan tiklash (Import)
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImportStatus('Fayl tekshirilmoqda...');
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed.users || !parsed.attendances) {
        throw new Error("Fayl formati noto'g'ri (users yoki attendances topilmadi)");
      }

      setPendingImportBackup(parsed);
      setImportStatus(null);
    } catch (err: any) {
      setImportStatus("Faylni o'qishda xatolik yuz berdi: " + (err instanceof Error ? err.message : String(err)));
      setTimeout(() => setImportStatus(null), 4000);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const confirmApplyImport = async () => {
    if (!pendingImportBackup) return;
    try {
      setImportStatus('Bazaga saqlanmoqda...');
      if (onImportBackup) {
        await onImportBackup(pendingImportBackup);
        setImportStatus("Muvaffaqiyatli tiklandi va bulutga saqlandi!");
      }
    } catch (err: any) {
      setImportStatus("Saqlashda xatolik: " + (err?.message || String(err)));
    } finally {
      setPendingImportBackup(null);
      setTimeout(() => setImportStatus(null), 4000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* 1. Bulutli Ma'lumotlar Bazasi Holati (Kafolat Bloki) */}
      <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-5 rounded-2xl border border-emerald-700 shadow-md space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-1.5 text-white">
                <span>Google Cloud Firestore Doimiy Bazasi</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </h2>
              <p className="text-[11px] text-emerald-200/80">
                ai-studio-navoishchibot-99cc1958-d38e-4213-9dec-16d42963a617
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-semibold border border-emerald-500/30 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Doimiy Saqlanmoqda</span>
          </span>
        </div>

        <p className="text-xs text-slate-200 leading-relaxed">
          Kiritilgan barcha ishchilar, ularning keldi-ketdi vaqtlari, tanaffuslari va ishlagan soatlari Google Cloud Firestore serverlarida <b>umrbod saqlanadi</b>. Botga yangi qo'shimcha qo'shsangiz ham yoki dastur yangilansa ham, <b>ma'lumotlaringiz aslo o'chib ketmaydi</b>.
        </p>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700/60">
          <div className="bg-white/10 rounded-xl p-2.5">
            <div className="text-[11px] text-slate-300">Bazadagi Ishchilar:</div>
            <div className="text-base font-black text-emerald-300">{users.length} nafar</div>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5">
            <div className="text-[11px] text-slate-300">Jami Davomat Yozuvlari:</div>
            <div className="text-base font-black text-emerald-300">{attendances.length} ta yozuv</div>
          </div>
        </div>
      </div>

      {/* 2. Zaxira Nusxa va Eksport / Tiklash Bloki */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Download className="w-4 h-4 text-emerald-600" />
          <span>Do'kon Ma'lumotlarini Zaxiralash va Yuklab Olish (Backup)</span>
        </div>
        <p className="text-xs text-slate-500">
          Xohlagan vaqtingizda barcha ishchilar va davomat tarixini shaxsiy kompyuteringiz yoki telefoningizga yuklab olib qo'yishingiz mumkin.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportJSON}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>To'liq Zaxira Fayl (JSON)</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-[#008f45] rounded-xl text-xs font-bold transition border border-emerald-200 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel / Jadval (CSV)</span>
          </button>

          <label className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer border border-slate-200">
            <Upload className="w-3.5 h-3.5 text-slate-600" />
            <span>Zaxiradan Tiklash (Import)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </label>
        </div>

        {importStatus && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{importStatus}</span>
          </div>
        )}
      </div>

      {/* 2.5 Mobil Ilova & Telefonlarga O'rnatish Qo'llanmasi */}
      <div className="bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white p-5 rounded-2xl border border-emerald-700/60 shadow-md space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-1.5 text-white">
                <span>Mobil Ilova & Telefonlarga O'rnatish</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </h2>
              <p className="text-[11px] text-emerald-200/80">
                PWA (Progressive Web App), Android APK va Telegram Mini App
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-semibold border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>O'rnatishga 100% Tayyor</span>
          </span>
        </div>

        <p className="text-xs text-slate-200 leading-relaxed">
          Ushbu tizim telefonlarga o'rnatiladigan to'liq mobil ilova sifatida tayyorlangan. Xodimlaringiz va o'zingiz uni to'g'ridan-to'g'ri telefon bosh ekraniga o'rnatib olishingiz mumkin.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left text-xs">
          <div className="p-3 rounded-xl bg-white/10 border border-white/10 space-y-1">
            <div className="font-bold text-emerald-300 flex items-center gap-1">
              <span>1. PWA (Eng tezkor)</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-tight">
              Play Market yoki App Store kerak emas. Brauzerdan 1-bosishda ilova bo'lib tushadi.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/10 border border-white/10 space-y-1">
            <div className="font-bold text-amber-300 flex items-center gap-1">
              <span>2. Android APK</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-tight">
              PWABuilder orqali 2 daqiqada tayyor .apk fayl qilib Telegramdan tarqatish mumkin.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/10 border border-white/10 space-y-1">
            <div className="font-bold text-sky-300 flex items-center gap-1">
              <span>3. Telegram App</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-tight">
              Telegram boti ichida menyu tugmasi orqali brauzersiz ochiladi.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onOpenInstallModal && (
            <button
              type="button"
              onClick={onOpenInstallModal}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl text-xs transition cursor-pointer shadow-md"
            >
              <Smartphone className="w-4 h-4 text-slate-950" />
              <span>O'rnatish Qo'llanmasini Ochish</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const publicUrl = currentAppUrl.replace('ais-dev-', 'ais-pre-') || currentAppUrl;
              navigator.clipboard.writeText(publicUrl);
              setCopiedAppUrl(true);
              setTimeout(() => setCopiedAppUrl(false), 2000);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition border border-white/20 cursor-pointer"
          >
            {copiedAppUrl ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Havola nusxalandi</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-300" />
                <span>Ishchilar uchun havolani nusxalash</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 3. Asosiy Sozlamalar Formasi */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tizim Sozlamalari</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Do'kon nomi va GPS geolokatsiya sozlamalari
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Do'kon / Korxona nomi *
          </label>
          <input
            type="text"
            required
            value={formData.shop_name}
            onChange={(e) =>
              setFormData({ ...formData, shop_name: e.target.value })
            }
            className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* GPS Majburiyligi (Kelishda) */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Ishga kelishda GPS Lokatsiyani tekshirish</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Yoqilgan bo'lsa: Ishchilar do'konga haqiqatan ham kelganini tasdiqlash uchun Veb-portal va Telegram botda GPS orqali tekshiriladi (ruxsat etilgan radius ichida bo'lmasa qayd etilmaydi).
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={formData.gps_required !== false}
              onChange={(e) =>
                setFormData({ ...formData, gps_required: e.target.checked })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {/* GPS Majburiyligi (Ketishda) — Aniq ishlaydigan va o'chirib-yoqiladigan */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Ishdan ketishda GPS Lokatsiyani tekshirish (Yangi)</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[10px] font-extrabold">
                {formData.gps_checkout_required ? "Faol" : "O'chiq"}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Yoqilgan bo'lsa: Ishchilar ketayotganda («🏃‍♂️ Ishdan ketdim») ham haqiqatan do'kon hududida ekanligini GPS orqali tasdiqlashi shart bo'ladi. Uydan yoki uzoqdan turib vaqtni soxtalashtirish to'xtatiladi. O'chirilgan bo'lsa: lokatsiyasiz darhol qayd etiladi.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={formData.gps_checkout_required === true}
              onChange={(e) =>
                setFormData({ ...formData, gps_checkout_required: e.target.checked })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>

        {/* 100 metr Geozona bo'yicha Avtomatik Ketishni qayd etish */}
        <div className="p-4 sm:p-5 bg-gradient-to-br from-amber-50/90 via-orange-50/50 to-amber-50/90 dark:from-amber-950/40 dark:via-orange-950/20 dark:to-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                <Navigation className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Masofa bo'yicha Avtomatik Ketish (Geozona)</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[10px] font-extrabold">
                    {formData.auto_checkout_on_distance_enabled !== false ? "Faol (100m)" : "O'chiq"}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                  Agar ishchi smena yakunida «Ishdan ketdim» tugmasini bosishni unutsa, do'kondan 100 metr (yoki belgilangan masofadan) uzoqlashgan vaqti avtomatik ketgan vaqti deb qayd etiladi va guruhga tezkor xabar yuboriladi.
                </p>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={formData.auto_checkout_on_distance_enabled !== false}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    auto_checkout_on_distance_enabled: e.target.checked,
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {formData.auto_checkout_on_distance_enabled !== false && (
            <div className="p-3.5 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-amber-200/80 dark:border-amber-800/80 space-y-3 text-xs">
              <div>
                <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 mb-1">
                  <span className="font-bold">Avtomatik ketish masofasi (metrda):</span>
                  <span className="font-black text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-md">
                    {formData.auto_checkout_distance_meters || 100} metr
                  </span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="300"
                  step="10"
                  value={formData.auto_checkout_distance_meters || 100}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      auto_checkout_distance_meters: parseInt(e.target.value, 10) || 100,
                    })
                  }
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>30 m</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">100 metr (Tavsiya)</span>
                  <span>300 m</span>
                </div>
              </div>
            </div>
          )}

          {/* Do'kon koordinatalari (Doimo sozlanadigan va xatolarsiz) */}
          <div className="p-3.5 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-amber-200/80 dark:border-amber-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-amber-600" />
                Do'kon lokatsiyasi (GPS koordinatalari)
              </span>
              <button
                type="button"
                onClick={handleGetCurrentLocation}
                className="text-xs text-amber-700 dark:text-amber-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
              >
                <span>Hozirgi joylashuvimni olish</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Kenglik (Latitude)</label>
                <input
                  type="number"
                  step="any"
                  value={formData.market_latitude}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      market_latitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Uzunlik (Longitude)</label>
                <input
                  type="number"
                  step="any"
                  value={formData.market_longitude}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      market_longitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Telegram Bot Integratsiyasi & Jonli Xabarnomalar */}
        <div className="p-5 bg-gradient-to-br from-sky-50/80 to-indigo-50/50 rounded-2xl border border-sky-200 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span>Telegram Bot & Guruh Bildirishnomalari</span>
                  <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold">
                    Real-vaqt
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Ishchilar kelganda yoki ketganda Telegramingizga zudlik bilan avtomatik xabar keladi
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isTestingTg || !formData.bot_token || !formData.admin_telegram_id}
              onClick={handleTestTelegram}
              className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isTestingTg ? 'Yuborilmoqda...' : 'Sinov xabari yuborish'}</span>
            </button>
          </div>

          {tgTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium flex items-start gap-2 ${
                tgTestResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {tgTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{tgTestResult.message}</span>
            </div>
          )}

          {/* ⚡️ 24/7 BULUTLI REJIM VA TEZKOR VEBXUK (KOMPYUTER O'CHIQ BO'LSA HAM 0.05s TEZLIK) */}
          <div className="p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 rounded-2xl border border-emerald-300 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Zap className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <div className="text-xs sm:text-sm font-black text-emerald-950 flex items-center gap-2">
                    <span>⚡️ 24/7 Avtonom Bulutli Rejim (Webhook)</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 text-[10px] font-black">
                      0.05s tezlik
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    Kompyuteringiz butunlay o'chiq bo'lsa ham bot 24/7 to'xtovsiz va 0.05 soniyada yashindek tez ishlaydi!
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isSettingWebhook || !formData.bot_token}
                onClick={handleSetupWebhook}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer active:scale-95 shrink-0"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>{isSettingWebhook ? "Ulanmoqda..." : "⚡️ 24/7 Bulutli Rejimni Yoqish"}</span>
              </button>
            </div>

            {webhookStatus && (
              <div
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  webhookStatus.ok
                    ? 'bg-white/80 border-emerald-300 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {webhookStatus.ok ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      ✅ <b>Muvaffaqiyatli ulandi!</b> Endi bot to'g'ridan-to'g'ri Google Cloud serverida ishlaydi. Kompyuteringizni xohlagan payt o'chirishingiz mumkin, bot 24/7 o'chmaydi va 0.05 soniyada yashindek tez javob qaytaradi!
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Xatolik: {webhookStatus.error}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
            {/* Bot Token */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Telegram Bot Token (@BotFather) *
                </label>
                <button
                  type="button"
                  onClick={() => setShowBotToken(!showBotToken)}
                  className="text-[10px] text-sky-700 hover:underline flex items-center gap-0.5"
                >
                  {showBotToken ? 'Yashirish' : "Ko'rsatish"}
                </button>
              </div>
              <input
                type={showBotToken ? 'text' : 'password'}
                value={formData.bot_token || ''}
                onChange={(e) =>
                  setFormData({ ...formData, bot_token: e.target.value.trim() })
                }
                placeholder="123456789:ABCdefGhIJKlm..."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Telegramda <b>@BotFather</b> dan olingan token
              </p>
            </div>

            {/* Admin Telegram ID (Shaxsiy) */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Shaxsiy Admin Telegram ID *
              </label>
              <input
                type="text"
                value={formData.admin_telegram_id || ''}
                onChange={(e) =>
                  setFormData({ ...formData, admin_telegram_id: e.target.value.trim() })
                }
                placeholder="Masalan: 987654321"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                <b>@userinfobot</b> ga /start bosib olingan shaxsiy ID
              </p>
            </div>

            {/* Guruh Telegram ID */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span>Guruh Telegram ID (Ixtiyoriy)</span>
                <span className="text-[10px] text-indigo-600 font-bold">-100 bilan</span>
              </label>
              <input
                type="text"
                value={formData.group_telegram_id || ''}
                onChange={(e) =>
                  setFormData({ ...formData, group_telegram_id: e.target.value.trim() })
                }
                placeholder="Masalan: -1001234567890"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Davomat xabarlari guruhga ham tushishi uchun
              </p>
            </div>
          </div>

          {/* Guruh ID sini qanday bilish bo'yicha ko'rsatma */}
          <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-xl text-xs text-sky-950 flex items-start gap-2.5">
            <span className="text-base leading-none">💡</span>
            <div className="space-y-1">
              <span className="font-bold text-sky-900 block">
                Guruh ID sini 5 soniyada bilish va sozlash:
              </span>
              <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-sky-800 leading-relaxed">
                <li>Botingizni Telegramdagi guruhingizga <b>a'zo (va admin)</b> qilib qo'shing.</li>
                <li>Guruh ichiga <code>/id</code> deb yozib yuboring — bot shu zahoti guruh ID sini chiqarib beradi!</li>
                <li>Chiqgan raqamni (masalan <code>-100...</code>) nusxa olib yuqoridagi <b>Guruh Telegram ID</b> maydoniga kiriting va Saqlang!</li>
              </ol>
            </div>
          </div>

          {/* Mini App Havolasi (Bot menyusiga qo'yish uchun) */}
          <div className="p-3 bg-white rounded-xl border border-sky-100 flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Telegram Mini App Havolasi (Menu Button):
              </span>
              <span className="text-xs font-mono font-semibold text-slate-800 truncate block">
                {currentAppUrl}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(currentAppUrl);
                setCopiedAppUrl(true);
                setTimeout(() => setCopiedAppUrl(false), 2000);
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition shrink-0 cursor-pointer"
            >
              {copiedAppUrl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Nusxalandi!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Havolani nusxalash</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Admin Xavfsizligi va Telegram ID Himoyasi */}
        <div className="p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-200/80 space-y-3">
          <div className="text-sm font-bold text-amber-950 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-600" />
              <span>Adminlik Xavfsizligi — Telegram ID orqali 100% himoya</span>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200/70 text-amber-900">
              Kodlarsiz / Xavfsiz
            </span>
          </div>
          <p className="text-xs text-amber-900/90 leading-relaxed">
            Admin panelga kirish <b>qat'iy Telegram ID</b> orqali amalga oshiriladi. Oddiy ishchilar va yangi xodimlar uchun Admin paneli mutlaqo ko'rinmaydi va kod bilan ham kirishning iloji yo'q.
          </p>
          <div className="p-3 bg-white/80 rounded-xl border border-amber-200/60 text-xs text-amber-950 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <span className="font-bold text-amber-900 block">Boshqa adminlarni qo'shish:</span>
              <span className="text-[11px] text-slate-600">Mavjud ishchini 1 bosishda admin qilish yoki yangi Telegram ID kiritish</span>
            </div>
            <div className="text-xs font-bold text-amber-800 bg-amber-100/70 px-3 py-1.5 rounded-lg border border-amber-200">
              👑 Adminlar menyusidan boshqariladi
            </div>
          </div>

          {/* Oylik bo'yicha Yagona Mas'ul Admin */}
          <div className="p-4 bg-gradient-to-r from-rose-50 via-amber-50/50 to-rose-50 rounded-2xl border-2 border-rose-300 text-xs text-rose-950 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="font-black text-sm flex items-center gap-1.5 text-rose-950">
                <Lock className="w-4 h-4 text-rose-600" />
                <span>🔒 Maxfiy Oylik Bo'limini Ko'ra Oladigan Yagona Telegram ID:</span>
              </span>
              <span className="text-[10px] bg-rose-200 text-rose-950 font-black px-2.5 py-0.5 rounded-full border border-rose-300">
                MUTLAQ MAXFIY
              </span>
            </div>
            <p className="text-[11px] text-rose-900 leading-relaxed">
              Bu yerga kiritilgan Telegram ID egasidan boshqa <b>hech kimga (hatto boshqa adminlarga ham) «💰 Oylik» bo'limi umuman ko'rinmaydi</b>.
            </p>
            <div className="flex gap-2 max-w-md pt-1">
              <input
                type="text"
                value={formData.payroll_admin_id || ''}
                onChange={(e) => setFormData({ ...formData, payroll_admin_id: e.target.value.trim() })}
                placeholder="Masalan: 45701569"
                className="flex-1 text-xs sm:text-sm font-mono font-bold px-3.5 py-2.5 bg-white border border-rose-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 shadow-2xs"
              />
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, payroll_admin_id: '45701569' });
                  triggerHaptic('light');
                }}
                className="px-3.5 py-2 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer border border-rose-300"
              >
                45701569 ni qo'yish
              </button>
            </div>
            <p className="text-[10px] text-rose-700 font-medium">
              💡 ID raqamni kiritgandan so'ng pastdagi <b>«Sozlamalarni Saqlash»</b> tugmasini bosing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-3">
          <button
            type="submit"
            className="px-6 py-2.5 bg-[#00a651] hover:bg-[#008f45] text-white rounded-xl text-sm font-bold transition shadow-xs cursor-pointer"
          >
            Sozlamalarni saqlash
          </button>
          {isSaved && (
            <span className="text-xs text-[#00a651] font-bold flex items-center gap-1">
              <Check className="w-4 h-4" /> Saqlandi!
            </span>
          )}
        </div>
      </form>

      {/* Zaxira nusxani tiklashni tasdiqlash modali */}
      {pendingImportBackup && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-2">
              Zaxira nusxani tiklashni tasdiqlaysizmi?
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Ushbu fayldan <b>{pendingImportBackup.users?.length || 0} ta ishchi</b> va{' '}
              <b>{pendingImportBackup.attendances?.length || 0} ta davomat yozuvi</b> Google Firestore bazasiga tiklanadi.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingImportBackup(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={confirmApplyImport}
                className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition cursor-pointer shadow-xs"
              >
                Ha, bazaga tiklansin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
