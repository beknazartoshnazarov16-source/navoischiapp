import React, { useState, useEffect, useMemo } from 'react';
import { Attendance, MarketSettings, User, Role } from './types';
import {
  INITIAL_ATTENDANCE,
  INITIAL_SETTINGS,
  INITIAL_USERS,
} from './data/mockData';
import {
  subscribeToUsers,
  subscribeToAttendance,
  subscribeToSettings,
  saveUserToFirestore,
  deleteUserFromFirestore,
  saveAttendanceToFirestore,
  deleteAttendanceFromFirestore,
  saveSettingsToFirestore,
} from './lib/firestoreSync';
import { Header } from './components/Header';
import { WorkersManager } from './components/WorkersManager';
import { AttendanceManager } from './components/AttendanceManager';
import { MonthlyHoursReport } from './components/MonthlyHoursReport';
import { PayrollManager } from './components/PayrollManager';
import { KpiRatingManager } from './components/KpiRatingManager';
import { WorkerPortal } from './components/WorkerPortal';
import { TelegramGuide } from './components/TelegramGuide';
import { SettingsManager } from './components/SettingsManager';
import { AdminManager } from './components/AdminManager';
import { RemindersManager } from './components/RemindersManager';
import { MobileBottomNav } from './components/MobileBottomNav';
import { AdminTelegramAuthModal } from './components/AdminTelegramAuthModal';
import { WorkerSelfRegisterModal } from './components/WorkerSelfRegisterModal';
import { LoginScreen } from './components/LoginScreen';
import { PWAInstallModal } from './components/PWAInstallModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  getLocalDateString,
  calculateLateMinutes,
  getTashkentTimeString,
  formatMinutesToHours,
} from './utils/calculations';
import { isUserAdminByTelegramId, getAllAdminIds, isUserAuthorizedForPayroll } from './utils/adminAuth';
import { useTheme } from './context/ThemeContext';
import {
  initTelegramApp,
  getTelegramUser,
  isTelegramWebApp,
  sendTelegramNotification,
  triggerHaptic,
} from './utils/telegram';

export function App() {
  const { theme, toggleTheme } = useTheme();

  // LocalStorage dan yuklash (offline fallback sifatida)
  const loadState = <T,>(key: string, fallback: T): T => {
    try {
      const saved = localStorage.getItem(`navo_time_${key}`);
      return saved ? JSON.parse(saved) : fallback;
    } catch {
      return fallback;
    }
  };

  const [settings, setSettings] = useState<MarketSettings>(() =>
    loadState('settings', INITIAL_SETTINGS)
  );

  const [users, setUsers] = useState<User[]>(() => {
    const saved = loadState<User[]>('users', INITIAL_USERS);
    return Array.isArray(saved) && saved.length > 0 ? saved : INITIAL_USERS;
  });

  const [attendances, setAttendances] = useState<Attendance[]>(() => {
    const saved = loadState<Attendance[]>('attendances', INITIAL_ATTENDANCE);
    return Array.isArray(saved) ? saved : INITIAL_ATTENDANCE;
  });

  const [isCloudConnected, setIsCloudConnected] = useState<boolean>(true);

  // Desktop brauzer yoki Telegram orqali kirilganda avtomatik Admin va hech qanday tekshiruvlarsiz ochish
  const [verifiedAdminTgId, setVerifiedAdminTgId] = useState<string | null>(() => {
    try {
      localStorage.setItem('navo_verified_admin_tg_id', 'PIN_VERIFIED_ADMIN');
      return 'PIN_VERIFIED_ADMIN';
    } catch {
      return 'PIN_VERIFIED_ADMIN';
    }
  });

  const [inTelegram, setInTelegram] = useState<boolean>(false);
  const [tgUserObj, setTgUserObj] = useState<any>(null);
  const [showAdminLoginModal, setShowAdminLoginModal] = useState<boolean>(false);
  const [showSelfRegister, setShowSelfRegister] = useState<boolean>(false);
  const [showPWAInstallModal, setShowPWAInstallModal] = useState<boolean>(false);

  // Faol bo'lim / Tab (to'g'ridan-to'g'ri boshqaruv panelidan ochiladi)
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const savedTab = localStorage.getItem('navo_active_tab');
      return savedTab || 'bot_screen';
    } catch {}
    return 'bot_screen';
  });

  // Hozirgi tanlangan foydalanuvchi (avtomatik Bosh Admin sifatida ochiladi)
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const adminObj: User = {
      id: 1,
      full_name: "Bosh Admin",
      role: 'admin',
      position: "Do'kon egasi / Bosh Admin",
      phone: '',
      work_start_time: '08:00',
      work_end_time: '20:00',
      is_active: true,
    };
    try {
      localStorage.setItem('navo_current_user_id', String(adminObj.id));
      const savedUserId = localStorage.getItem('navo_current_user_id');
      if (savedUserId && users.length > 0) {
        const found = users.find((u) => String(u.id) === savedUserId);
        if (found) return found;
      }
    } catch {}
    return adminObj;
  });

  // Foydalanuvchining admin ekanligini aniqlash (Faqat haqiqiy adminlar yoki admin Telegram ID egalari admin paneliga kirishi mumkin)
  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const tgId = currentUser.telegram_id ? String(currentUser.telegram_id).trim() : '';
    if (tgId) {
      if (tgId === '45701569' || tgId === settings.admin_telegram_id) return true;
      const allAdmins = getAllAdminIds(settings, users);
      if (allAdmins.includes(tgId)) return true;
    }
    if (verifiedAdminTgId && verifiedAdminTgId === 'PIN_VERIFIED_ADMIN') {
      return true;
    }
    return false;
  }, [currentUser, settings, users, verifiedAdminTgId]);

  // Agar foydalanuvchi Admin bo'lmasa, uni admin bo'limlariga aslo o'tkazmaslik
  useEffect(() => {
    if (!isAdmin) {
      if (['workers', 'attendance', 'monthly_report', 'payroll', 'kpi_rating', 'reminders', 'admins', 'telegram_guide', 'settings'].includes(activeTab)) {
        setActiveTab('bot_screen');
      }
    }
  }, [isAdmin, activeTab]);

  // Maxfiy Oylik (Payroll) bo'limiga kirish huquqi:
  const isPayrollAuthorized = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return isAdmin;
  }, [currentUser, isAdmin]);

  // 1. CLOUD FIRESTORE REAL-TIME SYNCHRONIZATION
  useEffect(() => {
    initTelegramApp();
    const unsubUsers = subscribeToUsers(
      (cloudUsers) => {
        if (cloudUsers && cloudUsers.length > 0) {
          setUsers(cloudUsers);
          localStorage.setItem('navo_time_users', JSON.stringify(cloudUsers));

          setCurrentUser((prevCurr) => {
            if (!prevCurr) {
              try {
                const savedId = localStorage.getItem('navo_current_user_id');
                if (savedId) {
                  const savedUser = cloudUsers.find((u) => String(u.id) === savedId);
                  if (savedUser) return savedUser;
                }
              } catch {}
              return null;
            }
            const updated = cloudUsers.find((u) => u.id === prevCurr.id);
            return updated || prevCurr;
          });
        }
        setIsCloudConnected(true);
      },
      (err) => {
        console.error('Firestore users sync error:', err);
      }
    );

    const unsubAttendance = subscribeToAttendance(
      (cloudAtt) => {
        setAttendances(cloudAtt);
        localStorage.setItem('navo_time_attendances', JSON.stringify(cloudAtt));
        setIsCloudConnected(true);
      },
      (err) => {
        console.error('Firestore attendance sync error:', err);
      }
    );

    const unsubSettings = subscribeToSettings(
      (cloudSettings) => {
        setSettings(cloudSettings);
        localStorage.setItem('navo_time_settings', JSON.stringify(cloudSettings));
      },
      (err) => {
        console.error('Firestore settings sync error:', err);
      }
    );

    return () => {
      unsubUsers();
      unsubAttendance();
      unsubSettings();
    };
  }, []);

  // 2. Telegram WebApp orqali avtomatik foydalanuvchini va rolni aniqlash
  useEffect(() => {
    const isTg = isTelegramWebApp();
    setInTelegram(isTg);

    const tgUser = getTelegramUser();
    if (tgUser) {
      setTgUserObj(tgUser);
      const tgIdStr = String(tgUser.id);
      const tgUsername = tgUser.username ? `@${tgUser.username.toLowerCase()}` : '';

      const explicitDesignatedPayrollId = (settings.payroll_admin_id || '').trim();
      const isPayrollUser = explicitDesignatedPayrollId
        ? tgIdStr === explicitDesignatedPayrollId
        : tgIdStr === '45701569';
      const isAdminCheck = isPayrollUser || isUserAdminByTelegramId(tgUser.id, settings, users);

      if (isAdminCheck) {
        // Haqiqiy admin kirdi!
        if (isPayrollUser) {
          setVerifiedAdminTgId(tgIdStr);
          try {
            sessionStorage.setItem('navo_verified_admin_tg_id', tgIdStr);
            localStorage.setItem('navo_verified_admin_tg_id', tgIdStr);
          } catch {}
        } else {
          // Boshqa oddiy admin kirganda oylik tasdig'i tozalanadi
          try {
            sessionStorage.removeItem('navo_verified_admin_tg_id');
            localStorage.removeItem('navo_verified_admin_tg_id');
          } catch {}
        }

        const existingAdmin = users.find(
          (u) =>
            u.role === 'admin' &&
            (String(u.telegram_id || '').trim() === tgIdStr ||
              (tgUsername && String(u.telegram_id || '').toLowerCase() === tgUsername))
        );

        const adminObj: User = existingAdmin
          ? { ...existingAdmin, telegram_id: tgIdStr }
          : {
              id: 1,
              telegram_id: tgIdStr,
              full_name: `${tgUser.first_name || 'Admin'} ${tgUser.last_name || ''}`.trim() || 'Admin',
              phone: '',
              role: 'admin' as Role,
              position: "Do'kon egasi / Bosh Admin",
              work_start_time: '08:00',
              work_end_time: '20:00',
              is_active: true,
            };

        setCurrentUser(adminObj);
        try {
          localStorage.setItem('navo_current_user_id', String(adminObj.id));
        } catch {}

        // Agar maxfiy oylik ID egasi bo'lsa, to'g'ridan-to'g'ri oylik sahifasiga kiradi
        if (isPayrollUser) {
          setActiveTab('payroll');
        } else {
          setActiveTab((prev) => (prev === 'bot_screen' ? 'workers' : prev));
        }
      } else {
        // Ishchi kirdi!
        const matchedWorker = users.find(
          (u) =>
            (u.telegram_id && String(u.telegram_id).trim() === tgIdStr) ||
            (tgUsername && u.telegram_id && String(u.telegram_id).toLowerCase() === tgUsername)
        );

        if (matchedWorker) {
          setCurrentUser(matchedWorker);
          try {
            localStorage.setItem('navo_current_user_id', String(matchedWorker.id));
          } catch {}
          setActiveTab('bot_screen');
        } else {
          // Ushbu Telegram ID hali birorta ham ishchiga bog'lanmagan
          // Foydalanuvchini Arslon profiliga aslo tiqmaymiz!
          try {
            const savedId = localStorage.getItem('navo_current_user_id');
            if (savedId) {
              const savedUser = users.find((u) => String(u.id) === savedId);
              if (savedUser) {
                setCurrentUser(savedUser);
                setActiveTab('bot_screen');
                return;
              }
            }
          } catch {}
          setCurrentUser(null);
        }
      }
    } else if (!isTg) {
      // Telegram WebApp bo'lmagan oddiy brauzerda ochilganda
      try {
        const savedId = localStorage.getItem('navo_current_user_id');
        if (savedId) {
          const savedUser = users.find((u) => String(u.id) === savedId);
          if (savedUser) {
            setCurrentUser(savedUser);
          }
        }
      } catch {}
    }
  }, [users, settings]);

  // Agar foydalanuvchi Admin bo'lmasa, uni admin bo'limlariga aslo o'tkazmaslik
  useEffect(() => {
    if (!isAdmin && activeTab !== 'bot_screen' && activeTab !== 'my_hours') {
      setActiveTab('bot_screen');
    }
  }, [isAdmin, activeTab]);

  // LocalStorage ga saqlash
  useEffect(() => {
    localStorage.setItem('navo_time_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('navo_time_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('navo_time_attendances', JSON.stringify(attendances));
  }, [attendances]);

  // Tizimdan chiqish (Logout) - Barcha foydalanuvchilar uchun alohida toza chiqish
  const handleLogout = () => {
    triggerHaptic('medium');
    const ok = window.confirm(
      isAdmin
        ? "Admin paneldan chiqmoqchimisiz?"
        : "Haqiqatan ham profilingizdan chiqmoqchimisiz?"
    );
    if (!ok) return;

    try {
      localStorage.removeItem('navo_current_user_id');
      localStorage.removeItem('navo_verified_admin_tg_id');
      sessionStorage.removeItem('navo_verified_admin_tg_id');
    } catch {}
    setVerifiedAdminTgId(null);
    setCurrentUser(null);
    setActiveTab('bot_screen');
  };

  // --- Ishchilar CRUD ---
  const handleAddUser = (newUserData: Omit<User, 'id'>): User => {
    const newUser: User = {
      ...newUserData,
      id: Date.now(),
      created_at: new Date().toISOString(),
    };
    setUsers((prev) => [...prev, newUser]);
    saveUserToFirestore(newUser).catch((e) =>
      console.error('Error saving user to Firestore:', e)
    );
    return newUser;
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === updatedUser.id ? updatedUser : u))
    );
    if (currentUser?.id === updatedUser.id) {
      setCurrentUser(updatedUser);
    }
    saveUserToFirestore(updatedUser).catch((e) =>
      console.error('Error updating user in Firestore:', e)
    );
  };

  const handleDeleteUser = (userId: number) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setAttendances((prev) => prev.filter((a) => a.user_id !== userId));
    if (currentUser?.id === userId) {
      setCurrentUser(null);
    }
    deleteUserFromFirestore(userId).catch((e) =>
      console.error('Error deleting user from Firestore:', e)
    );
  };

  // --- Davomat CRUD ---
  const handleAddAttendance = (attData: Omit<Attendance, 'id'>) => {
    const newAtt: Attendance = {
      ...attData,
      id: Date.now(),
      created_at: new Date().toISOString(),
    };
    setAttendances((prev) => [newAtt, ...prev]);
    saveAttendanceToFirestore(newAtt).catch((e) =>
      console.error('Error saving attendance to Firestore:', e)
    );
  };

  const handleUpdateAttendance = (updatedAtt: Attendance) => {
    setAttendances((prev) =>
      prev.map((a) => (a.id === updatedAtt.id ? updatedAtt : a))
    );
    saveAttendanceToFirestore(updatedAtt).catch((e) =>
      console.error('Error updating attendance in Firestore:', e)
    );
  };

  const handleDeleteAttendance = (attId: number) => {
    setAttendances((prev) => prev.filter((a) => a.id !== attId));
    deleteAttendanceFromFirestore(attId).catch((e) =>
      console.error('Error deleting attendance from Firestore:', e)
    );
  };

  // --- Ishchi / Bot Ekrani Harakatlari ---
  const handleSelectUserProfile = async (selectedWorker: User, linkTelegram = false) => {
    try {
      localStorage.setItem('navo_current_user_id', String(selectedWorker.id));
    } catch {}

    if (linkTelegram && inTelegram && tgUserObj?.id) {
      const tgIdStr = String(tgUserObj.id);
      // Agar boshqa biror foydalanuvchida (masalan Arslonda) bu Telegram ID birikkan bo'lsa, undan uzamiz:
      const prevHolder = users.find(
        (u) => u.id !== selectedWorker.id && u.telegram_id && String(u.telegram_id).trim() === tgIdStr
      );
      if (prevHolder) {
        const cleanPrev: User = { ...prevHolder, telegram_id: undefined };
        setUsers((prev) => prev.map((u) => (u.id === prevHolder.id ? cleanPrev : u)));
        await saveUserToFirestore(cleanPrev).catch(console.error);
      }

      const updatedWorker: User = {
        ...selectedWorker,
        telegram_id: tgIdStr,
      };
      setUsers((prev) => prev.map((u) => (u.id === selectedWorker.id ? updatedWorker : u)));
      setCurrentUser(updatedWorker);
      await saveUserToFirestore(updatedWorker).catch(console.error);
    } else {
      setCurrentUser(selectedWorker);
    }
  };

  const handleUnlinkTelegramUser = async (userId: number) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    const updated: User = {
      ...target,
      telegram_id: undefined,
    };
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    if (currentUser?.id === userId) {
      setCurrentUser(updated);
    }
    await saveUserToFirestore(updated).catch(console.error);
  };

  const handleLinkTelegramUser = async (tgId: string) => {
    if (!currentUser) return;
    const tgIdStr = String(tgId).trim();
    // Boshqa foydalanuvchida bu Telegram ID birikkan bo'lsa, undan tozalaymiz
    const prevHolder = users.find(
      (u) => u.id !== currentUser.id && u.telegram_id && String(u.telegram_id).trim() === tgIdStr
    );
    if (prevHolder) {
      const cleanPrev: User = { ...prevHolder, telegram_id: undefined };
      setUsers((prev) => prev.map((u) => (u.id === prevHolder.id ? cleanPrev : u)));
      await saveUserToFirestore(cleanPrev).catch(console.error);
    }

    const updatedUser: User = {
      ...currentUser,
      telegram_id: tgIdStr,
    };
    setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? updatedUser : u)));
    setCurrentUser(updatedUser);
    try {
      localStorage.setItem('navo_current_user_id', String(updatedUser.id));
    } catch {}
    await saveUserToFirestore(updatedUser).catch(console.error);
  };

  const sendNotification = (msg: string) => {
    const rawTargets = [
      settings.admin_telegram_id,
      settings.group_telegram_id,
      ...(settings.admin_ids || []),
    ].filter(Boolean);

    const targets = Array.from(new Set(rawTargets.map((t) => String(t).trim()))).join(', ');

    if (settings.bot_token && targets) {
      sendTelegramNotification(settings.bot_token, targets, msg)
        .then((res) => {
          if (res.migratedTo && res.migratedTo !== settings.group_telegram_id) {
            console.log('Superguruh migratsiyasi aniqlandi:', res.migratedTo);
            const updated = { ...settings, group_telegram_id: res.migratedTo };
            setSettings(updated);
            saveSettingsToFirestore(updated).catch(console.error);
          }
        })
        .catch((e) => console.error('Telegram notification error:', e));
    }
  };

  const handleWorkerCheckIn = (lat?: number, lon?: number) => {
    if (!currentUser) return;
    const now = new Date();
    const todayDate = getLocalDateString(now);
    const timeStr = getTashkentTimeString(now, true);

    const newAttendance: Attendance = {
      id: Date.now(),
      user_id: currentUser.id,
      date: todayDate,
      check_in_time: timeStr,
      check_in_lat: lat,
      check_in_lon: lon,
      total_break_minutes: 0,
      worked_minutes: 0,
      status: 'working',
      created_at: now.toISOString(),
    };

    setAttendances((prev) => [
      newAttendance,
      ...prev.filter(
        (a) => !(a.user_id === currentUser.id && a.status === 'working')
      ),
    ]);

    saveAttendanceToFirestore(newAttendance).catch((e) =>
      console.error('Error saving check-in to Firestore:', e)
    );

    // Bugungi mavjud/tugallangan smenalarni hisoblash
    const todayShifts = attendances.filter(
      (a) => a.user_id === currentUser.id && a.date === todayDate
    );
    const isFirstShift = todayShifts.length === 0;
    const shiftNumber = todayShifts.length + 1;

    let lateMins = 0;
    let lateText = '';

    if (isFirstShift) {
      lateMins = calculateLateMinutes(
        timeStr,
        currentUser.work_start_time || '08:00'
      );
      lateText = lateMins > 0 ? `⚠️ ${lateMins} daqiqa kechikdi` : `✅ O'z vaqtida keldi`;
    } else {
      lateText = `🔄 ${shiftNumber}-smena (Qaytadan kirish — kechikish hisoblanmaydi)`;
    }

    const locText = lat && lon ? `📍 Do'konda (GPS tasdiqlandi)` : `📱 Mini App orqali`;
    const shiftBadge = shiftNumber > 1 ? ` (${shiftNumber}-smena)` : '';

    const msg = `🟢 <b>${settings.shop_name} — Ishga keldi${shiftBadge}</b>\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name} (${currentUser.position || 'Xodim'})\n` +
      `⏰ <b>Kelgan vaqti:</b> ${timeStr.slice(0, 5)} (${todayDate})\n` +
      `⏱ <b>Ish rejasi:</b> ${currentUser.work_start_time || '08:00'} - ${currentUser.work_end_time || '20:00'} [${lateText}]\n` +
      `📍 <b>Lokatsiya:</b> ${locText}`;

    sendNotification(msg);
  };

  const handleStartBreak = () => {
    if (!currentUser) return;
    const now = new Date();
    let updatedTarget: Attendance | null = null;
    setAttendances((prev) =>
      prev.map((a) => {
        if (a.user_id === currentUser.id && a.status === 'working') {
          const updated: Attendance = {
            ...a,
            status: 'on_break',
            note: `Tanaffus: ${Date.now()}`,
          };
          updatedTarget = updated;
          return updated;
        }
        return a;
      })
    );
    if (updatedTarget) {
      saveAttendanceToFirestore(updatedTarget).catch((e) =>
        console.error('Error saving break to Firestore:', e)
      );
    }

    const timeStr = getTashkentTimeString(now, false);
    const msg = `☕️ <b>${settings.shop_name} — Tanaffusga chiqdi</b>\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name}\n` +
      `⏰ <b>Vaqt:</b> ${timeStr}`;
    sendNotification(msg);
  };

  const handleEndBreak = () => {
    if (!currentUser) return;
    const now = new Date();
    let updatedTarget: Attendance | null = null;
    let breakMinutes = 1;

    setAttendances((prev) =>
      prev.map((a) => {
        if (a.user_id === currentUser.id && a.status === 'on_break') {
          if (a.note && a.note.startsWith('Tanaffus: ')) {
            try {
              const raw = a.note.replace('Tanaffus: ', '').trim();
              const startMs = /^\d+$/.test(raw) ? parseInt(raw, 10) : new Date(raw).getTime();
              const diffMs = Date.now() - startMs;
              breakMinutes = Math.max(1, Math.round(diffMs / 60000));
              if (breakMinutes > 180) breakMinutes = 30;
            } catch {
              breakMinutes = 15;
            }
          } else {
            breakMinutes = 15;
          }

          const updated: Attendance = {
            ...a,
            status: 'working',
            total_break_minutes: (a.total_break_minutes || 0) + breakMinutes,
            note: undefined,
          };
          updatedTarget = updated;
          return updated;
        }
        return a;
      })
    );
    if (updatedTarget) {
      saveAttendanceToFirestore(updatedTarget).catch((e) =>
        console.error('Error saving break end to Firestore:', e)
      );
    }

    const timeStr = getTashkentTimeString(now, false);
    const msg = `▶️ <b>${settings.shop_name} — Tanaffus yakunlandi</b>\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name}\n` +
      `⏰ <b>Qaytdi:</b> ${timeStr} (Tanaffus: ${breakMinutes} daqiqa)`;
    sendNotification(msg);
  };

  const handleWorkerCheckOut = (
    workedMinutes: number,
    checkOutDate: string,
    checkOutTime: string,
    autoReason?: string
  ) => {
    if (!currentUser) return;
    let updatedTarget: Attendance | null = null;
    setAttendances((prev) =>
      prev.map((a) => {
        if (
          a.user_id === currentUser.id &&
          (a.status === 'working' || a.status === 'on_break')
        ) {
          const updated: Attendance = {
            ...a,
            status: 'completed',
            check_out_date: checkOutDate,
            check_out_time: checkOutTime,
            worked_minutes: workedMinutes,
            note: autoReason ? `Avtomatik ketish: ${autoReason}` : a.note,
          };
          updatedTarget = updated;
          return updated;
        }
        return a;
      })
    );
    if (updatedTarget) {
      saveAttendanceToFirestore(updatedTarget).catch((e) =>
        console.error('Error saving check-out to Firestore:', e)
      );
    }

    const hours = Math.floor(workedMinutes / 60);
    const mins = workedMinutes % 60;
    const workedStr = `${hours} soat ${mins} daqiqa`;

    const titlePrefix = autoReason
      ? `🔴 <b>${settings.shop_name} — Ishdan ketdi (Avtomatik Geozona)</b>`
      : `🔴 <b>${settings.shop_name} — Ishdan ketdi</b>`;

    const reasonLine = autoReason
      ? `📍 <b>Sabab:</b> ${autoReason}\n`
      : '';

    const msg = `${titlePrefix}\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name} (${currentUser.position || 'Xodim'})\n` +
      `⏰ <b>Ketgan vaqti:</b> ${checkOutTime.slice(0, 5)} (${checkOutDate})\n` +
      `⏱ <b>Ishlagan vaqti:</b> <b>${workedStr}</b> (${(workedMinutes / 60).toFixed(1)} soat)\n` +
      reasonLine +
      `✅ Davomat Google Firestore bazasiga yozildi.`;

    sendNotification(msg);
  };

  // Agar foydalanuvchi hali kirmagan bo'lsa (yoki Chiqish bosgan bo'lsa), LoginScreen ko'rsatamiz!
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 font-sans antialiased text-slate-800">
        <LoginScreen
          users={users}
          settings={settings}
          onWorkerLogin={(worker, linkTelegram) => {
            handleSelectUserProfile(worker, linkTelegram);
            setActiveTab('bot_screen');
          }}
          onAdminLogin={(directTgId) => {
            if (directTgId) {
              const targetId = directTgId.trim();
              setVerifiedAdminTgId(targetId);
              try {
                sessionStorage.setItem('navo_verified_admin_tg_id', targetId);
                localStorage.setItem('navo_verified_admin_tg_id', targetId);
              } catch {}

              const existingAdmin = users.find((u) => u.role === 'admin') || {
                id: 1,
                full_name: "Bosh Admin",
                role: 'admin' as Role,
                position: "Do'kon egasi / Bosh Admin",
                phone: '',
                work_start_time: '08:00',
                work_end_time: '20:00',
                is_active: true,
              };

              const adminUser: User = {
                ...existingAdmin,
                telegram_id: targetId,
                role: 'admin',
              };

              setCurrentUser(adminUser);
              try {
                localStorage.setItem('navo_current_user_id', String(adminUser.id));
              } catch {}

              const explicitPayroll = (settings.payroll_admin_id || '').trim();
              const isPayroll = explicitPayroll ? targetId === explicitPayroll : targetId === '45701569';
              if (isPayroll) {
                setActiveTab('payroll');
              } else {
                setActiveTab('workers');
              }
            } else {
              // PIN bilan kirish (Oylik ko'rinmaydi, faqat ishchilar va davomat boshqaruvi)
              const existingAdmin = users.find((u) => u.role === 'admin') || {
                id: 1,
                full_name: "Do'kon Ma'muri (Admin)",
                role: 'admin' as Role,
                position: "Do'kon Boshqaruvchisi",
                phone: '',
                work_start_time: '08:00',
                work_end_time: '20:00',
                is_active: true,
              };

              const pinAdminUser: User = {
                ...existingAdmin,
                telegram_id: undefined, // PIN bilan kirganda telegram_id qo'yilmaydi!
                role: 'admin',
              };

              setVerifiedAdminTgId('PIN_VERIFIED_ADMIN');
              try {
                sessionStorage.setItem('navo_verified_admin_tg_id', 'PIN_VERIFIED_ADMIN');
                localStorage.setItem('navo_verified_admin_tg_id', 'PIN_VERIFIED_ADMIN');
                localStorage.setItem('navo_current_user_id', String(pinAdminUser.id));
              } catch {}

              setCurrentUser(pinAdminUser);
              setActiveTab('workers');
            }
          }}
          onOpenRegister={() => setShowSelfRegister(true)}
          inTelegram={inTelegram}
          telegramUser={tgUserObj}
          onOpenInstallModal={() => setShowPWAInstallModal(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        {/* Desktop / PIN orqali Admin Kirish Modali */}
        <AdminTelegramAuthModal
          isOpen={showAdminLoginModal}
          onClose={() => setShowAdminLoginModal(false)}
          settings={settings}
          users={users}
          onSuccess={async (verifiedId) => {
            setVerifiedAdminTgId(verifiedId);
            try {
              sessionStorage.setItem('navo_verified_admin_tg_id', verifiedId);
              localStorage.setItem('navo_verified_admin_tg_id', verifiedId);
            } catch {}

            const existingAdmin = users.find((u) => u.role === 'admin') || {
              id: 1,
              full_name: "Beknazar Toshnazarov (Admin)",
              role: 'admin' as Role,
              position: "Do'kon egasi / Bosh Admin",
              phone: '',
              work_start_time: '08:00',
              work_end_time: '20:00',
              is_active: true,
            };

            const adminUser: User = {
              ...existingAdmin,
              telegram_id: verifiedId !== 'PIN_VERIFIED_ADMIN' ? verifiedId : undefined,
            };

            setCurrentUser(adminUser);
            try {
              localStorage.setItem('navo_current_user_id', String(adminUser.id));
            } catch {}

            const explicitPayroll = (settings.payroll_admin_id || '').trim();
            const isPayroll = explicitPayroll ? verifiedId === explicitPayroll : verifiedId === '45701569';
            if (isPayroll) {
              setActiveTab('payroll');
            } else {
              setActiveTab('workers');
            }
            setShowAdminLoginModal(false);
          }}
        />

        {/* Yangi ishchi ro'yxatdan o'tish modali */}
        {showSelfRegister && (
          <WorkerSelfRegisterModal
            telegramUser={tgUserObj}
            onCancel={() => setShowSelfRegister(false)}
            onRegister={(newWorkerData) => {
              const addedUser = handleAddUser(newWorkerData);
              handleSelectUserProfile(addedUser, inTelegram);
              setShowSelfRegister(false);

              const tgInfo = addedUser.telegram_id
                ? `<code>${addedUser.telegram_id}</code> (Ulangan)`
                : `<i>Ulanmagan</i>`;

              const adminNotice =
                `👤 <b>Yangi ishchi ro'yxatdan o'tdi (Mini App):</b>\n\n` +
                `👤 <b>Ismi:</b> ${addedUser.full_name}\n` +
                `📱 <b>Telefoni:</b> <b>${addedUser.phone}</b>\n` +
                `💼 <b>Lavozimi:</b> ${addedUser.position || 'Xodim'}\n` +
                `🆔 <b>Telegram ID:</b> ${tgInfo}\n\n` +
                `✅ Ma'lumotlar Firestore bazasiga muvaffaqiyatli saqlandi.`;

              sendNotification(adminNotice);
            }}
          />
        )}

        {/* PWA O'rnatish modali */}
        <PWAInstallModal
          isOpen={showPWAInstallModal}
          onClose={() => setShowPWAInstallModal(false)}
        />

        {/* Oflayn rejim indikatori */}
        <OfflineIndicator />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans text-slate-800 dark:text-slate-100 antialiased selection:bg-emerald-500 selection:text-white transition-colors duration-200">
      {/* Yuqori Header */}
      <Header
        settings={settings}
        currentUser={currentUser}
        isAdmin={isAdmin}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLockAdmin={handleLogout}
        onLogout={handleLogout}
        onRequestAdminLogin={!isAdmin ? () => setShowAdminLoginModal(true) : undefined}
        isCloudConnected={isCloudConnected}
        onOpenInstallModal={() => setShowPWAInstallModal(true)}
        verifiedAdminTgId={verifiedAdminTgId}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Telegram Mini App rejimi indikatori */}
      {inTelegram && (
        <div className={`text-white text-xs px-4 py-1.5 flex items-center justify-between ${isAdmin ? 'bg-amber-600' : 'bg-emerald-600'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0"></span>
            <span className="truncate">
              Telegram: <b>{tgUserObj?.first_name || currentUser.full_name}</b> {tgUserObj?.username ? `(@${tgUserObj.username})` : ''}
            </span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 ${isAdmin ? 'bg-amber-800' : 'bg-emerald-800'}`}>
            {isAdmin ? '👑 Admin' : '👤 Ishchi'}
          </span>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 md:pb-8">
        {!isAdmin ? (
          /* ======================================================== */
          /* ISHCHILAR VA YANGI XODIMLAR UCHUN MAXSUS CHEKLANGAN PANEL */
          /* Admin panellari, kodlar yoki menyular mutlaqo ko'rinmaydi */
          /* ======================================================== */
          activeTab === 'my_hours' ? (
            <MonthlyHoursReport
              users={users}
              attendances={attendances}
              forWorkerId={currentUser.id}
            />
          ) : (
            <WorkerPortal
              user={currentUser}
              settings={settings}
              attendances={attendances}
              onCheckIn={handleWorkerCheckIn}
              onStartBreak={handleStartBreak}
              onEndBreak={handleEndBreak}
              onCheckOut={handleWorkerCheckOut}
              onOpenRegister={() => setShowSelfRegister(true)}
              onLogout={handleLogout}
              isAdmin={false}
              onLinkTelegram={handleLinkTelegramUser}
              onOpenInstallModal={() => setShowPWAInstallModal(true)}
              onRequestAdminLogin={() => setShowAdminLoginModal(true)}
            />
          )
        ) : (
          /* ======================================================== */
          /* FAQAT ADMINLAR UCHUN TO'LIQ BOSHQARUV PANEL              */
          /* Telegram ID orqali tasdiqlangan foydalanuvchilar uchun  */
          /* ======================================================== */
          <>
            {/* 0. Kassa / Ishchi Ekran (Admin uchun ham to'liq ishlaydi) */}
            {activeTab === 'bot_screen' && (
              <WorkerPortal
                user={currentUser}
                settings={settings}
                attendances={attendances}
                onCheckIn={handleWorkerCheckIn}
                onStartBreak={handleStartBreak}
                onEndBreak={handleEndBreak}
                onCheckOut={handleWorkerCheckOut}
                onOpenRegister={() => setShowSelfRegister(true)}
                onLogout={handleLogout}
                isAdmin={true}
                onLinkTelegram={handleLinkTelegramUser}
                onOpenInstallModal={() => setShowPWAInstallModal(true)}
                onRequestAdminLogin={() => setShowAdminLoginModal(true)}
              />
            )}

            {/* 0.1. O'z soatlari (Admin uchun) */}
            {activeTab === 'my_hours' && (
              <MonthlyHoursReport
                users={users}
                attendances={attendances}
                forWorkerId={currentUser.id}
              />
            )}

            {/* 1. Ishchilar bo'limi */}
            {activeTab === 'workers' && (
              <WorkersManager
                users={users}
                onAddUser={handleAddUser}
                onUpdateUser={handleUpdateUser}
                onDeleteUser={handleDeleteUser}
              />
            )}

            {/* 2. Davomat jurnali */}
            {activeTab === 'attendance' && (
              <AttendanceManager
                users={users}
                attendances={attendances}
                onAddAttendance={handleAddAttendance}
                onUpdateAttendance={handleUpdateAttendance}
                onDeleteAttendance={handleDeleteAttendance}
              />
            )}

            {/* 3. Oylik soatlar hisoboti */}
            {activeTab === 'monthly_report' && (
              <MonthlyHoursReport
                users={users}
                attendances={attendances}
                onNavigateToPayroll={() => setActiveTab('payroll')}
              />
            )}

            {/* 3.1. 💰 Maxfiy Oylik va Ish Haqi Hisob-kitobi (Faqat 1 nafar vakolatli admin uchun) */}
            {activeTab === 'payroll' && (
              <PayrollManager
                settings={settings}
                users={users}
                attendances={attendances}
                currentUser={currentUser}
                verifiedAdminTgId={verifiedAdminTgId}
                onRequestAdminLogin={() => setShowAdminLoginModal(true)}
                onUpdateSettings={async (newSettings) => {
                  setSettings(newSettings);
                  await saveSettingsToFirestore(newSettings);
                }}
                onUpdateUser={async (updatedUser) => {
                  handleUpdateUser(updatedUser);
                }}
              />
            )}

            {/* 3.2. 🏆 Yangi: Samaradorlik Reytingi (KPI) */}
            {activeTab === 'kpi_rating' && (
              <KpiRatingManager
                users={users}
                attendances={attendances}
                settings={settings}
              />
            )}

            {/* 4. 🔔 Aqlli Eslatmalar va Xabarnomalar */}
            {activeTab === 'reminders' && (
              <RemindersManager
                settings={settings}
                users={users}
                attendances={attendances}
                onSaveSettings={async (newSettings) => {
                  setSettings(newSettings);
                  await saveSettingsToFirestore(newSettings);
                }}
              />
            )}

            {/* 5. 👑 Yangi: Adminlar Boshqaruvi */}
            {activeTab === 'admins' && (
              <AdminManager
                settings={settings}
                users={users}
                onUpdateSettings={async (newSettings) => {
                  setSettings(newSettings);
                  await saveSettingsToFirestore(newSettings);
                }}
                onUpdateUser={handleUpdateUser}
              />
            )}

            {/* 5. Telegram Bot / Ishchi ekrani (Admin test qilishi uchun) */}
            {activeTab === 'bot_screen' && (
              <WorkerPortal
                user={currentUser}
                settings={settings}
                attendances={attendances}
                onCheckIn={handleWorkerCheckIn}
                onStartBreak={handleStartBreak}
                onEndBreak={handleEndBreak}
                onCheckOut={handleWorkerCheckOut}
                onOpenRegister={() => setShowSelfRegister(true)}
                onLogout={handleLogout}
                isAdmin={true}
                onLinkTelegram={handleLinkTelegramUser}
              />
            )}

            {/* 6. Telegram Bot Qo'llanmasi & Python Bot Kodu */}
            {activeTab === 'telegram_guide' && (
              <TelegramGuide
                settings={settings}
                onSaveSettings={async (newSettings) => {
                  setSettings(newSettings);
                  await saveSettingsToFirestore(newSettings);
                }}
              />
            )}

            {/* 7. Sozlamalar */}
            {activeTab === 'settings' && (
              <SettingsManager
                settings={settings}
                users={users}
                attendances={attendances}
                onOpenInstallModal={() => setShowPWAInstallModal(true)}
                onSaveSettings={async (newSettings) => {
                  setSettings(newSettings);
                  await saveSettingsToFirestore(newSettings);
                }}
                onImportBackup={async (backup) => {
                  if (backup.users && Array.isArray(backup.users)) {
                    setUsers(backup.users);
                    for (const u of backup.users) {
                      await saveUserToFirestore(u);
                    }
                  }
                  if (backup.attendances && Array.isArray(backup.attendances)) {
                    setAttendances(backup.attendances);
                    for (const a of backup.attendances) {
                      await saveAttendanceToFirestore(a);
                    }
                  }
                  if (backup.settings) {
                    setSettings(backup.settings);
                    await saveSettingsToFirestore(backup.settings);
                  }
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Telefonlar uchun mobil navigatsiya */}
      <MobileBottomNav
        currentUser={currentUser}
        isAdmin={isAdmin}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRequestAdminLogin={() => setShowAdminLoginModal(true)}
        onLogout={handleLogout}
        verifiedAdminTgId={verifiedAdminTgId}
        payrollAdminId={settings.payroll_admin_id}
        isPayrollAuthorized={isPayrollAuthorized}
      />

      {/* Desktop brauzerda admin kirish modali */}
      <AdminTelegramAuthModal
        isOpen={showAdminLoginModal}
        onClose={() => setShowAdminLoginModal(false)}
        settings={settings}
        users={users}
        onSuccess={async (verifiedId) => {
          setVerifiedAdminTgId(verifiedId);
          try {
            sessionStorage.setItem('navo_verified_admin_tg_id', verifiedId);
            localStorage.setItem('navo_verified_admin_tg_id', verifiedId);
          } catch {}

          // Admin foydalanuvchi ob'ektini yangilash
          const existingAdmin = users.find((u) => u.role === 'admin') || {
            id: 1,
            full_name: "Bosh Admin",
            role: 'admin' as Role,
            position: "Do'kon egasi / Bosh Admin",
            phone: '',
            work_start_time: '08:00',
            work_end_time: '20:00',
            is_active: true,
          };

          const adminUser: User = {
            ...existingAdmin,
            telegram_id: verifiedId !== 'PIN_VERIFIED_ADMIN' ? verifiedId : undefined,
            role: 'admin',
          };
          setCurrentUser(adminUser);
          try {
            localStorage.setItem('navo_current_user_id', String(adminUser.id));
          } catch {}

          // Agar foydalanuvchi Telegram ichida bo'lsa va PIN bilan kirgan bo'lsa,
          // uning Telegram ID sini avtomatik adminlar ro'yxatiga qo'shamiz
          if (inTelegram && tgUserObj?.id) {
            const myTgId = String(tgUserObj.id);
            const currentAdmins = settings.admins || [];
            const currentAdminIds = getAllAdminIds(settings, users);
            if (!currentAdminIds.includes(myTgId)) {
              const newAdminObj = {
                telegram_id: myTgId,
                full_name: `${tgUserObj.first_name || ''} ${tgUserObj.last_name || ''}`.trim() || 'Admin',
                phone: '',
                role_title: "Do'kon Ma'muri",
                added_at: new Date().toISOString(),
                is_primary: currentAdmins.length === 0,
              };
              const updatedAdmins = [...currentAdmins, newAdminObj];
              const updatedAdminIds = Array.from(new Set([...currentAdminIds, myTgId]));
              const updatedSettings: MarketSettings = {
                ...settings,
                admins: updatedAdmins,
                admin_ids: updatedAdminIds,
                admin_telegram_id: updatedAdminIds.join(', '),
              };
              setSettings(updatedSettings);
              await saveSettingsToFirestore(updatedSettings);
            }
          } else if (verifiedId && verifiedId !== 'PIN_VERIFIED_ADMIN') {
            const existingAdmins = getAllAdminIds(settings, users);
            if (!existingAdmins.includes(verifiedId)) {
              const updatedSettings: MarketSettings = {
                ...settings,
                admin_telegram_id: settings.admin_telegram_id
                  ? `${settings.admin_telegram_id}, ${verifiedId}`
                  : verifiedId,
              };
              setSettings(updatedSettings);
              await saveSettingsToFirestore(updatedSettings);
            }
          }

          const designatedPayroll = String(settings.payroll_admin_id || '45701569').trim();
          if (verifiedId === designatedPayroll || verifiedId === '45701569') {
            setActiveTab('payroll');
          } else {
            setActiveTab('workers');
          }
          setShowAdminLoginModal(false);
        }}
      />

      {/* Yangi ishchi ro'yxatdan o'tish modali */}
      {showSelfRegister && (
        <WorkerSelfRegisterModal
          telegramUser={tgUserObj}
          onCancel={() => setShowSelfRegister(false)}
          onRegister={(newWorkerData) => {
            const addedUser = handleAddUser(newWorkerData);
            handleSelectUserProfile(addedUser, inTelegram);
            setShowSelfRegister(false);

            const tgInfo = addedUser.telegram_id
              ? `<code>${addedUser.telegram_id}</code> (Ulangan)`
              : `<i>Ulanmagan</i>`;

            const adminNotice =
              `👤 <b>Yangi ishchi ro'yxatdan o'tdi (Mini App):</b>\n\n` +
              `👤 <b>Ismi:</b> ${addedUser.full_name}\n` +
              `📱 <b>Telefoni:</b> <b>${addedUser.phone}</b>\n` +
              `💼 <b>Lavozimi:</b> ${addedUser.position || 'Xodim'}\n` +
              `🆔 <b>Telegram ID:</b> ${tgInfo}\n\n` +
              `✅ Ma'lumotlar Firestore bazasiga muvaffaqiyatli saqlandi.`;

            sendNotification(adminNotice);
          }}
        />
      )}

      {/* PWA O'rnatish modali */}
      <PWAInstallModal
        isOpen={showPWAInstallModal}
        onClose={() => setShowPWAInstallModal(false)}
      />

      {/* Oflayn rejim indikatori */}
      <OfflineIndicator />
    </div>
  );
}
