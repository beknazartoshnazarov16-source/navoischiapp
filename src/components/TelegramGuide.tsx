import React, { useState } from 'react';
import { MarketSettings } from '../types';
import { generateTelegramBotCode } from '../data/telegramBotCode';
import {
  Bot,
  Copy,
  Check,
  Smartphone,
  Terminal,
  ExternalLink,
  ShieldCheck,
  Send,
  Download,
} from 'lucide-react';

interface TelegramGuideProps {
  settings: MarketSettings;
  onSaveSettings: (settings: MarketSettings) => void;
}

export function TelegramGuide({ settings, onSaveSettings }: TelegramGuideProps) {
  const [tokenInput, setTokenInput] = useState(settings.bot_token || '');
  const [adminIdInput, setAdminIdInput] = useState(settings.admin_telegram_id || '');
  const [groupIdInput, setGroupIdInput] = useState(settings.group_telegram_id || '');
  const [isSaved, setIsSaved] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Ommaviy havola (ais-pre) — yangi ishchilardan hech qanday Google akkaunt so'ramaydi!
  const rawOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicAppUrl = rawOrigin.replace('ais-dev-', 'ais-pre-') || 'https://ais-pre-sn5pew5d4v6dsgb6ijaf5d-752669647478.asia-southeast1.run.app';

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      ...settings,
      bot_token: tokenInput.trim(),
      admin_telegram_id: adminIdInput.trim(),
      group_telegram_id: groupIdInput.trim(),
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const pythonCode = generateTelegramBotCode(
    tokenInput.trim(),
    adminIdInput.trim(),
    settings.shop_name,
    publicAppUrl,
    groupIdInput.trim()
  );

  const handleCopyCode = () => {
    navigator.clipboard.writeText(pythonCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDownloadBotFile = () => {
    const blob = new Blob([pythonCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'telegram_bot.py';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(publicAppUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* 24/7 Doimiy Ishlash Kafolati Banneli */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white p-5 rounded-3xl shadow-md border border-emerald-500/30 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-xs rounded-full text-[11px] font-black uppercase tracking-wider text-emerald-100">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping"></span>
              24/7 Bulutli Rejim Faol
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white">
              Kompyuteringiz o'chirilgan bo'lsa ham bot to'xtamaydi!
            </h2>
            <p className="text-xs text-emerald-100 max-w-2xl leading-relaxed">
              Bot va tizim to'g'ridan-to'g'ri <b>Google Cloud</b> serverida 24/7 uzluksiz ishlaydi.
              Barcha davomatlar <b>Google Firestore</b> bulut bazasida saqlanadi. Ma'lumotlar hech qachon uchib ketmaydi va yo'qolmaydi!
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-xs px-4 py-3 rounded-2xl border border-white/20 shrink-0 text-center sm:text-right">
            <div className="text-[11px] text-emerald-200">Baza Holati</div>
            <div className="text-sm font-black text-white">Google Firestore Cloud</div>
            <div className="text-[10px] text-emerald-300 mt-0.5">100% O'chmas va Xavfsiz</div>
          </div>
        </div>
      </div>

      {/* Sarlavha */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center shrink-0">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Telegram Bot Bilan Ishlash
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Ishchilar Telegram orqali bitta tugma bilan kelib-ketish vaqtlarini belgilashlari mumkin
            </p>
          </div>
        </div>
      </div>

      {/* 2 Xil Usul: Telegram WebApp va Python Boti */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1-Usul: Telegram WebApp (Eng osoni va tezkor!) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-sky-100 text-sky-800 text-xs font-bold rounded-full mb-3">
              <Smartphone className="w-3.5 h-3.5" />
              1-Usul: Telegram WebApp (Server talab qilmaydi)
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-2">
              Telegram ichida ilovani ochish (Mini App)
            </h2>
            <p className="text-xs text-slate-600 mb-3 leading-relaxed">
              BotFather'da bot ochib, ushbu havolani bot menyusiga qo'ysangiz, yangi ishchilar kirganda <b>hech qanday Google akkaunt yoki parol so'ramaydi!</b> Ular faqat o'z ism-familiyasi va telefon raqamini kiritib bir zumda ro'yxatdan o'tadilar va ishga keldi-ketdisini qiladilar:
            </p>

            {/* Google Login Muammosini Hal Qilish Bo'yicha Maxsus Eslatma */}
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl mb-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-900 font-black text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                <span>💡 Ishchilar Uchun Eng Qulay Usul — Telegram Bot Chatining O'zi!</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                Ishchilar davomatni belgilash uchun ilova yoki sayt ochishlari <b>umuman shart emas</b>. Ular Telegram botda <b>«📍 Ishga keldim»</b> yoki <b>«🏃‍♂️ Ishdan ketdim»</b> tugmalarini bosishsa bas — vaqtlar bir zumda hisoblanadi va bazaga saqlanadi.
              </p>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Agar Telegram ichidagi Mini Appda Google logosi yoki aylanma (cookie tekshiruvi) chiqib qolsa, bu Telegramning ichki WebView tizimi cookie-fayllarni cheklashi sabablidir. Veb-portalni esa quyidagi havola orqali to'g'ridan-to'g'ri Google Chrome yoki Safari brauzerida ochish tavsiya etiladi:
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 flex items-center justify-between gap-2">
              <span className="text-xs font-mono font-bold text-emerald-800 truncate select-all">
                {publicAppUrl}
              </span>
              <button
                onClick={handleCopyUrl}
                className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs transition"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? 'Nusxalandi!' : 'Havolani Nusxalash'}</span>
              </button>
            </div>

            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl mb-4 space-y-1.5 text-[11px] text-emerald-950">
              <div className="font-bold text-emerald-900">BotFather'da 1 daqiqada to'g'rilash:</div>
              <ol className="list-decimal list-inside space-y-1 text-slate-700">
                <li>Telegramda <b>@BotFather</b> ga kiring va <b>/setmenubutton</b> deb yozing</li>
                <li>Botingizni tanlang va yuqoridagi <b>ais-pre-...</b> havolasini yuboring</li>
                <li>Agar BotFather'da <b>/myapps</b> orqali WebApp ochgan bo'lsangiz: <b>/myapps</b> &rarr; Botni tanlang &rarr; <b>Edit Web App URL</b> &rarr; Yuqoridagi <b>ais-pre-...</b> ni qo'ying</li>
              </ol>
            </div>
          </div>
        </div>

        {/* 2-Usul: Python Boti (telegram_bot.py) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full mb-3">
              <Terminal className="w-3.5 h-3.5" />
              2-Usul: Mustaqil Python Boti (telegram_bot.py)
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-2">
              Tayyor Python Telegram Boti
            </h2>
            <p className="text-xs text-slate-600 mb-3 leading-relaxed">
              Loyihangiz ichida <code>telegram_bot.py</code> fayli tayyor holatda mavjud. U SQLite bazaga ega, tuni bilan 00:00 dan keyin ketsa ham, erta ketsa ham soatlarini to'liq hisoblaydi!
            </p>

            <div className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-xs mb-4 space-y-1">
              <div className="text-emerald-400"># O'rnatish va ishga tushirish:</div>
              <div>pip install pyTelegramBotAPI</div>
              <div>python telegram_bot.py</div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <button
                onClick={handleCopyCode}
                className="flex-1 w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Kod nusxalandi!' : 'Kodni nusxalash'}</span>
              </button>

              <button
                onClick={handleDownloadBotFile}
                className="w-full sm:w-auto py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                title="telegram_bot.py faylini yuklab olish"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Faylni yuklab olish</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 24/7 Doimiy Ishlatish Qo'llanmasi */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl border border-slate-700 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping shrink-0" />
          <h2 className="text-base font-bold text-white">
            Botni 24/7 To'xtovsiz Ishlatish Bo'yicha 3 Ta Eng Yaxshi Yo'l
          </h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Bot kompyuteringiz o'chirilganida ham kechayu-kunduz ishlashi uchun quyidagi 3 usuldan birini tanlang:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {/* Variant 1 */}
          <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-xl space-y-2">
            <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <span>⭐️ 1-Yo'l: WebApp (Server Kerak Emas)</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Eng osoni va 100% tekin! Ilova allaqachon Google Cloud serverida 24/7 ishlab turibdi. BotFather'da havolani Menu Button qilib qo'ysangiz, hech narsa sotib olmaysiz.
            </p>
          </div>

          {/* Variant 2 */}
          <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-xl space-y-2">
            <div className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
              <span>☁️ 2-Yo'l: Bepul Bulut (Render.com / Railway)</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              <code>telegram_bot.py</code> va <code>requirements.txt</code> ni <b>Render.com</b> yoki <b>Railway.app</b> ga bepul yuklab, "Background Worker" sifatida 24/7 tekinga ishlatishingiz mumkin.
            </p>
          </div>

          {/* Variant 3 */}
          <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-xl space-y-2">
            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <span>🖥 3-Yo'l: VPS Server (Ubuntu)</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Arzon VPS serverda (oyiga 2-3$) <code>systemd</code> yoki <code>screen</code> orqali ishga tushirsangiz, server qayta yoqilganda ham bot avtomatik qayta ishlab ketadi.
            </p>
          </div>
        </div>
      </div>

      {/* Bot Sozlamalarini kiritish formasi */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-1">
          Telegram Bot Ma'lumotlari (Ixtiyoriy)
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Agar BotFather'dan token olgan bo'lsangiz, shu yerga kiritib saqlab qo'yishingiz mumkin:
        </p>

        <form onSubmit={handleSave} className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Bot Token (BotFather bergan token)
            </label>
            <input
              type="text"
              placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Admin Telegram ID (Sizning Telegram ID'ingiz)
            </label>
            <input
              type="text"
              placeholder="Masalan: 987654321"
              value={adminIdInput}
              onChange={(e) => setAdminIdInput(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
              <span>Guruh Telegram ID (Ixtiyoriy)</span>
              <span className="text-[11px] text-indigo-600 font-semibold">Guruhga /id yuboring</span>
            </label>
            <input
              type="text"
              placeholder="Masalan: -1001234567890"
              value={groupIdInput}
              onChange={(e) => setGroupIdInput(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Botni guruhga qo'shib, guruh ichida <code>/id</code> deb yozsangiz, bot guruh ID sini chiqarib beradi.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold transition"
            >
              Saqlash
            </button>
            {isSaved && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" /> Sozlamalar saqlandi!
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
