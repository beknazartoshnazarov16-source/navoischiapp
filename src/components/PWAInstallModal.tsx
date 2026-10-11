import React, { useState } from 'react';
import { usePWAInstall } from '../utils/usePWAInstall';
import {
  Download,
  Smartphone,
  Share2,
  PlusSquare,
  CheckCircle2,
  X,
  Zap,
  ShieldCheck,
  Sparkles,
  Copy,
  Check,
  Layers,
  Bot,
  ExternalLink,
  HelpCircle,
} from 'lucide-react';
import { triggerHaptic } from '../utils/telegram';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PWAInstallModal({ isOpen, onClose }: PWAInstallModalProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [installSuccess, setInstallSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'pwa' | 'apk' | 'telegram'>('pwa');
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  // Ommaviy havola (ais-pre) — yangi ishchilardan Google akkaunt so'ramaydi
  const rawOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicAppUrl =
    rawOrigin.replace('ais-dev-', 'ais-pre-') ||
    'https://ais-pre-sn5pew5d4v6dsgb6ijaf5d-752669647478.asia-southeast1.run.app';

  const handleInstallClick = async () => {
    triggerHaptic('light');
    if (isInstallable) {
      const outcome = await install();
      if (outcome) {
        setInstallSuccess(true);
        triggerHaptic('success');
        setTimeout(() => {
          onClose();
        }, 2500);
      }
    }
  };

  const handleCopyLink = () => {
    triggerHaptic('light');
    navigator.clipboard.writeText(publicAppUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
        {/* Yuqori qism: Sarlavha & Brend */}
        <div className="relative p-5 sm:p-6 bg-gradient-to-br from-emerald-600 via-teal-700 to-emerald-800 text-white text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            aria-label="Yopish"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="mx-auto w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-white p-2.5 sm:p-3 shadow-xl flex items-center justify-center mb-3">
            <img
              src="/pwa-192x192.png"
              alt="Navo Market"
              className="w-full h-full object-contain rounded-2xl"
            />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-black uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Mobil Ilova & O'rnatish</span>
          </div>

          <h3 className="text-xl sm:text-2xl font-black tracking-tight">
            Navo Market Mobil Ilovasi
          </h3>
          <p className="text-xs text-emerald-100 mt-1 max-w-sm mx-auto leading-relaxed">
            Telefoningiz bosh ekraniga o'rnatib oling — brauzersiz, to'liq ekranli va yashindek tez ishlaydi!
          </p>

          {/* 3 ta yo'nalish tablari */}
          <div className="mt-4 flex items-center bg-black/20 p-1 rounded-2xl max-w-md mx-auto">
            <button
              type="button"
              onClick={() => setActiveTab('pwa')}
              className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'pwa'
                  ? 'bg-white text-emerald-900 shadow-sm'
                  : 'text-white/80 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>PWA (Tezkor)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('apk')}
              className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'apk'
                  ? 'bg-white text-emerald-900 shadow-sm'
                  : 'text-white/80 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Android APK</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('telegram')}
              className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'telegram'
                  ? 'bg-white text-emerald-900 shadow-sm'
                  : 'text-white/80 hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Telegram Mini App</span>
            </button>
          </div>
        </div>

        {/* Tanasi */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* TAB 1: PWA (Telefon Bosh Ekraniga O'rnatish) */}
          {activeTab === 'pwa' && (
            <div className="space-y-4">
              {installSuccess ? (
                <div className="py-6 text-center space-y-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-base font-black text-slate-900">
                    Ilova muvaffaqiyatli o'rnatildi!
                  </h4>
                  <p className="text-xs text-slate-500">
                    Endi telefoningiz ekranidagi <b>Navo Market</b> belgisini bosib bemalol kira olasiz.
                  </p>
                </div>
              ) : isInstalled ? (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <div className="text-sm font-bold text-emerald-950">
                    Ilova allaqachon telefoningizga o'rnatilgan!
                  </div>
                  <p className="text-xs text-emerald-800">
                    Telefoningiz bosh ekranidagi Navo Market belgisi orqali to'g'ridan-to'g'ri foydalanishingiz mumkin.
                  </p>
                </div>
              ) : isInstallable ? (
                /* Android / Chrome / PC uchun 1-bosishda o'rnatish */
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <Zap className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                      <span className="font-bold text-slate-700 block">Yashindek Tez</span>
                      <span className="text-[10px] text-slate-400">0.1 soniyada ochiladi</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <Smartphone className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                      <span className="font-bold text-slate-700 block">To'liq Ekran</span>
                      <span className="text-[10px] text-slate-400">Brauzer chiziqlarisiz</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <ShieldCheck className="w-4 h-4 text-sky-600 mx-auto mb-1" />
                      <span className="font-bold text-slate-700 block">Kesh & Xavfsiz</span>
                      <span className="text-[10px] text-slate-400">Xotiradan kam joy oladi</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleInstallClick}
                    className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-sm sm:text-base shadow-lg shadow-emerald-600/25 active:scale-[0.98] transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5 stroke-[2.5]" />
                    <span>Telefonimga O'rnatish (1-bosishda)</span>
                  </button>
                </div>
              ) : isIOS ? (
                /* iPhone / iPad Safari yo'riqnomasi */
                <div className="space-y-3.5 text-left">
                  <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 font-medium">
                    Apple kompaniyasi iOS tizimida Safari brauzeri orqali o'rnatishga ruxsat beradi. Quyidagi 3 ta oson qadamni bajaring:
                  </div>

                  <div className="space-y-2 text-xs text-slate-700">
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                      <div className="w-7 h-7 rounded-xl bg-sky-100 text-sky-700 font-black text-xs flex items-center justify-center shrink-0">
                        1
                      </div>
                      <div>
                        Safari brauzerining pastidagi <b>«Ulashish» (Share)</b> tugmasini bosing:
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-50 text-sky-800 font-bold border border-sky-200 text-[11px]">
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Ulashish (Kvadrat ichida yuqoriga strelka)</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                      <div className="w-7 h-7 rounded-xl bg-sky-100 text-sky-700 font-black text-xs flex items-center justify-center shrink-0">
                        2
                      </div>
                      <div>
                        Menyuni biroz pastga surib, <b>«Bosh ekranga qo'shish» (Add to Home Screen)</b> ni tanlang:
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-bold border border-slate-300 text-[11px]">
                          <PlusSquare className="w-3.5 h-3.5" />
                          <span>Add to Home Screen (+)</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                      <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-700 font-black text-xs flex items-center justify-center shrink-0">
                        3
                      </div>
                      <div>
                        Yuqori o'ng burchakdagi <b>«Qo'shish» (Add)</b> tugmasini bosing.
                        <div className="mt-1 text-[11px] text-emerald-700 font-bold">
                          ✓ Tayyor! Navo Market ilovasi iPhone ekraningizga o'rnatiladi.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Umumiy brauzer qo'llanmasi */
                <div className="space-y-3 text-left text-xs text-slate-600">
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                    <span className="font-bold text-slate-800 block text-sm">
                      Android / Chrome brauzer menyusi orqali o'rnatish:
                    </span>
                    <ol className="list-decimal list-inside space-y-1.5 leading-relaxed text-slate-700">
                      <li>Brauzeringizning yuqori o'ng burchagidagi <b>uchta nuqta (⋮)</b> ni bosing.</li>
                      <li>Chiqgan ro'yxatdan <b>«Ilovani o'rnatish»</b> yoki <b>«Bosh ekranga qo'shish» (Install app)</b> bandini tanlang.</li>
                      <li>Telefoningiz ekranida <b>Navo Market</b> ilovasi paydo bo'ladi!</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* Havolani nusxalash kartasi */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-left">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Do'kon ommaviy havolasi (Ishchilarga yuborish uchun):
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-700 truncate block">
                    {publicAppUrl}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-1.5 shrink-0 transition cursor-pointer shadow-2xs"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Nusxalandi</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Nusxa olish</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Android APK (.apk) FAYL QILISH QO'LLANMASI */}
          {activeTab === 'apk' && (
            <div className="space-y-3.5 text-left text-xs text-slate-700">
              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                <div className="text-sm font-bold text-emerald-950 mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>Nega PWA usuli APK fayldan afzalroq?</span>
                </div>
                <p className="text-emerald-800 leading-relaxed text-[11px]">
                  PWA — bu Google va Apple tomonidan tasdiqlangan rasmiy standart. Uni o'rnatish uchun hech qanday «Noma'lum manbalar» ruxsatini yoqish kerak emas, xotiradan atigi 2-3 MB joy oladi va eng asosiysi: siz tizimga biror narsa qo'shsangiz yoki o'zgartirsangiz, barcha ishchilarda <b>avtomatik yangilanadi</b> (qaytadan yangi APK yuborib o'tirish shart emas)!
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Agar baribir Telegramdan xodimlarga yuborish uchun tayyor .APK fayl kerak bo'lsa:
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Loyihamiz to'liq PWA standartida qurilgani sababli, undan <b>2 daqiqada bepul APK</b> yasab olish mumkin:
                </p>

                <div className="space-y-2 pt-1">
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      1
                    </span>
                    <span>
                      Kompyuterda yoki telefonda Microsoft ning rasmiy bepul servisi bo'lgan <b>PWABuilder.com</b> saytiga kiring.
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      2
                    </span>
                    <span>
                      U yerga do'koningiz havolasini (<code>{publicAppUrl}</code>) kiriting va <b>«Start»</b> tugmasini bosing. Sayt 100 ball beradi.
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      3
                    </span>
                    <span>
                      <b>«Package for Android»</b> tugmasini bosing — tayyor imzolangan <b>.apk</b> faylni yuklab oling va Telegram orqali xodimlarga tashlang!
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-100 rounded-xl text-[11px] text-slate-500">
                💡 <i>Tavsiyamiz: Xodimlar va o'zingiz uchun 1-tabdagi <b>PWA usuli</b> eng qulay, xavfsiz va tezkor usuldir.</i>
              </div>
            </div>
          )}

          {/* TAB 3: TELEGRAM MINI APP SIFATIDA FOYDALANISH */}
          {activeTab === 'telegram' && (
            <div className="space-y-3.5 text-left text-xs text-slate-700">
              <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200">
                <div className="text-sm font-bold text-sky-950 mb-1 flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-sky-600" />
                  <span>Telegram Ichida Hech Narsa O'rnatmasdan Ishlatish</span>
                </div>
                <p className="text-sky-800 leading-relaxed text-[11px]">
                  Ishchilar va adminlar ilovadan to'g'ridan-to'g'ri Telegram messenjerining o'zida ham foydalanishlari mumkin. Telegram pastida katta menyu tugmasi sifatida chiqadi.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-900 block text-xs">
                  Telegram Botga Mini App Menyusini Qo'shish:
                </span>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-700 leading-relaxed">
                  <li>Telegramda <b>@BotFather</b> ga kiring va <code>/mybots</code> ni bosing.</li>
                  <li>O'z botingizni tanlang va <b>Bot Settings</b> ➔ <b>Menu Button</b> ➔ <b>Configure menu button</b> ni bosing.</li>
                  <li>Sayt havolasini yuboring: <br/><code className="bg-slate-200 px-1.5 py-0.5 rounded text-[11px] select-all break-all">{publicAppUrl}</code></li>
                  <li>Tugma nomiga <b>«Navo Market»</b> deb yozing.</li>
                  <li>Endi botga kirgan har bir odam pastdagi menyu tugmasini bosib, to'g'ridan-to'g'ri ilovadan foydalana oladi!</li>
                </ol>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Progressive Web App (PWA) Standard</span>
            <span>Versiya 1.2 · Barcha qurilmalarga mos</span>
          </div>
        </div>
      </div>
    </div>
  );
}
