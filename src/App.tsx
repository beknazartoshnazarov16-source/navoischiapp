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
  calculateLatePenaltyAmount,
  formatUzSum,
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

  // Maxfiy kalit nomi yangilandi (avvalgi xato tufayli boshqa qurilmalarda qolib ketgan eski admin keshlarini 100% tozalash uchun)
  const ADMIN_AUTH_STORAGE_KEY = 'navo_verified_admin_v2';

  // Faqat haqiqiy PIN kiritgan yoki Telegram WebApp orqali tasdiqlangan adminlargina huquq oladi
  const [verifiedAdminTgId, setVerifiedAdminTgId] = useState<string | null>(() => {
    try {
      // Eski versiyadagi keshni xavfsizlik uchun tozalaymiz
      localStorage.removeItem('navo_verified_admin_tg_id');
      sessionStorage.removeItem('navo_verified_admin_tg_id');
      const saved =
        sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) ||
        localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
      return saved || null;
    } catch {
      return null;
    }
  });

  const [inTelegram, setInTelegram] = useState<boolean>(false);
  const [tgUserObj, setTgUserObj] = useState<any>(null);
  const [showAdminLoginModal, setShowAdminLoginModal] = useState<boolean>(false);
  const [showSelfRegister, setShowSelfRegister] = useState<boolean>(false);
  const [showPWAInstallModal, setShowPWAInstallModal] = useState<boolean>(false);

  // Faol bo'lim / Tab
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const savedTab = localStorage.getItem('navo_active_tab');
      return savedTab || 'bot_screen';
    } catch {}
    return 'bot_screen';
  });

  // Hozirgi tanlangan foydalanuvchi:
  // QAT'IY XAVFSIZLIK: Tizimga kirmagan yangi foydalanuvchi uchun DOIMO `null` (Kirish ekrani) ochiladi!
  // Hech qachon avtomatik ravishda Admin yoki begona ishchi profili ochib berilmaydi!
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const savedUserId = localStorage.getItem('navo_current_user_id');
      const savedVerifiedAdmin =
        sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) ||
        localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
      const savedSettings = loadState<MarketSettings>('settings', INITIAL_SETTINGS);
      const savedUsers = loadState<User[]>('users', INITIAL_USERS);

      if (!savedUserId) {
        return null;
      }

      const found = savedUsers.find((u) => String(u.id) === savedUserId);
      if (!found) {
        return null;
      }

      const isFoundAdminAccount =
        found.id === 1 ||
        found.role === 'admin' ||
        isUserAdminByTelegramId(found.telegram_id, savedSettings, savedUsers);

      if (isFoundAdminAccount) {
        if (!savedVerifiedAdmin) {
          localStorage.removeItem('navo_current_user_id');
          return null;
        }
        return found;
      }

      return found;
    } catch {
      return null;
    }
  });

  // Foydalanuvchining admin ekanligini QAT'IY tekshirish:
  // Faqat (1) Telegram Mini App ichida haqiqiy admin Telegram akkaunti bilan kirganda
  // yoki (2) Maxfiy Admin PIN-kod bilan tasdiqlangandagina `true` bo'ladi!
  // `currentUser.telegram_id` yoki URL parametridan kelgan ID o'z-o'zidan HECH QACHON admin huquqini bermaydi!
  const isAdmin = useMemo(() => {
    if (!currentUser) return false;

    // 1. Agar Telegram Mini App ichida haqiqiy Telegram foydalanuvchisi aniqlangan bo'lsa:
    if (inTelegram && tgUserObj?.id) {
      const liveTgId = String(tgUserObj.id).trim();
      if (isUserAdminByTelegramId(liveTgId, settings, users)) {
        return true;
      }
      if (
        verifiedAdminTgId === 'PIN_VERIFIED_ADMIN' ||
        verifiedAdminTgId === 'PAYROLL_PIN_VERIFIED'
      ) {
        return true;
      }
      // Oddiy ishchi Telegram Mini App orqali kirganda HECH QACHON admin bo'la olmaydi
      return false;
    }

    // 2. Oddiy brauzerda (yoki Telegram WebApp initData bo'lmaganda):
    // Faqat PIN-kod orqali tasdiqlangan `verifiedAdminTgId` bo'lsagina ruxsat beriladi!
    if (!verifiedAdminTgId) {
      return false;
    }

    if (
      verifiedAdminTgId === 'PIN_VERIFIED_ADMIN' ||
      verifiedAdminTgId === 'PAYROLL_PIN_VERIFIED'
    ) {
      return true;
    }

    return isUserAdminByTelegramId(verifiedAdminTgId, settings, users);
  }, [currentUser, settings, users, verifiedAdminTgId, inTelegram, tgUserObj]);

  // Agar foydalanuvchi Admin bo'lmasa, uni maxfiy admin boshqaruv bo'limlariga o'tkazmaslik
  useEffect(() => {
    if (!isAdmin) {
      if (['workers', 'attendance', 'monthly_report', 'payroll', 'kpi_rating', 'reminders', 'admins', 'settings', 'telegram_guide'].includes(activeTab)) {
        setActiveTab('bot_screen');
      }
    }
  }, [isAdmin, activeTab]);

  // Maxfiy Oylik (Payroll) bo'limiga kirish huquqi (faqat tasdiqlangan mas'ul admin uchun):
  const effectiveVerifiedAdminId = useMemo(() => {
    if (verifiedAdminTgId) return verifiedAdminTgId;
    if (inTelegram && tgUserObj?.id && isUserAdminByTelegramId(tgUserObj.id, settings, users)) {
      return String(tgUserObj.id).trim();
    }
    return null;
  }, [verifiedAdminTgId, inTelegram, tgUserObj, settings, users]);

  const isPayrollAuthorized = useMemo(() => {
    if (!isAdmin || !currentUser) return false;
    return isUserAuthorizedForPayroll(currentUser, effectiveVerifiedAdminId, settings);
  }, [isAdmin, currentUser, effectiveVerifiedAdminId, settings]);

  // 1. CLOUD FIRESTORE REAL-TIME SYNCHRONIZATION
  useEffect(() => {
    initTelegramApp();
    const unsubUsers = subscribeToUsers(
      (cloudUsers) => {
        if (cloudUsers && cloudUsers.length > 0) {
          setUsers(cloudUsers);
          localStorage.setItem('navo_time_users', JSON.stringify(cloudUsers));

          setCurrentUser((prevCurr) => {
            const urlParams = new URLSearchParams(window.location.search);
            const workerTgId = (urlParams.get('worker_tg_id') || '').trim();
            const autoAdmin = urlParams.get('auto_admin') === 'true';
            const liveTg = getTelegramUser();
            const savedSettings = loadState<MarketSettings>('settings', INITIAL_SETTINGS);
            const savedVerifiedAdmin =
              sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) ||
              localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);

            // Agar ishchi havola orqali ochgan bo'lsa (faqat oddiy ishchilar uchun, admin ID url orqali avto-ochilmaydi!)
            if (workerTgId && !autoAdmin && !liveTg) {
              if (isUserAdminByTelegramId(workerTgId, savedSettings, cloudUsers)) {
                return savedVerifiedAdmin ? prevCurr : null;
              }
              const matchedWorker = cloudUsers.find(
                (u) => u.role === 'worker' && String(u.telegram_id || '').trim() === workerTgId
              );
              if (matchedWorker) {
                try {
                  localStorage.setItem('navo_current_user_id', String(matchedWorker.id));
                } catch {}
                return matchedWorker;
              }
              // Ro'yxatdan o'tmagan yangi odam bo'lsa — Login / Ro'yxatdan o'tish ekraniga yuboramiz!
              try {
                localStorage.removeItem('navo_current_user_id');
              } catch {}
              return null;
            }

            if (!prevCurr) {
              try {
                const savedId = localStorage.getItem('navo_current_user_id');
                if (savedId) {
                  const savedUser = cloudUsers.find((u) => String(u.id) === savedId);
                  if (!savedUser) return null;
                  const isAdmAccount =
                    savedUser.id === 1 ||
                    savedUser.role === 'admin' ||
                    isUserAdminByTelegramId(savedUser.telegram_id, savedSettings, cloudUsers);
                  if (isAdmAccount && !savedVerifiedAdmin && !liveTg) {
                    localStorage.removeItem('navo_current_user_id');
                    return null;
                  }
                  return savedUser;
                }
              } catch {}
              return null;
            }

            const updated = cloudUsers.find((u) => u.id === prevCurr.id) || prevCurr;
            const isUpdatedAdm =
              updated.id === 1 ||
              updated.role === 'admin' ||
              isUserAdminByTelegramId(updated.telegram_id, savedSettings, cloudUsers);
            if (isUpdatedAdm && !savedVerifiedAdmin && !liveTg) {
              try {
                localStorage.removeItem('navo_current_user_id');
              } catch {}
              return null;
            }
            return updated;
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

  // 2. Telegram WebApp va URL orqali foydalanuvchini va rolni QAT'IY XAVFSIZ aniqlash
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const workerTgId = (urlParams.get('worker_tg_id') || '').trim();
    const autoAdmin = urlParams.get('auto_admin') === 'true';

    const isTg = isTelegramWebApp();
    setInTelegram(isTg);

    const tgUser = getTelegramUser();
    if (tgUser) {
      setTgUserObj(tgUser);
      const tgIdStr = String(tgUser.id).trim();
      const tgUsername = tgUser.username ? `@${tgUser.username.toLowerCase()}` : '';

      const explicitDesignatedPayrollId = (settings.payroll_admin_id || '45701569').trim();
      const isPayrollUser = tgIdStr === explicitDesignatedPayrollId || tgIdStr === '45701569';
      const isAdminCheck = isPayrollUser || isUserAdminByTelegramId(tgIdStr, settings, users);

      if (isAdminCheck) {
        // Haqiqiy Telegram Admin kirdi!
        setVerifiedAdminTgId(tgIdStr);
        try {
          sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, tgIdStr);
          localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, tgIdStr);
        } catch {}

        const existingAdmin = users.find(
          (u) =>
            u.role === 'admin' &&
            (String(u.telegram_id || '').trim() === tgIdStr ||
              (tgUsername && String(u.telegram_id || '').toLowerCase() === tgUsername))
        );

        const adminObj: User = existingAdmin
          ? { ...existingAdmin, telegram_id: tgIdStr, role: 'admin' }
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

        if (isPayrollUser) {
          setActiveTab((prev) => (prev === 'bot_screen' ? 'payroll' : prev));
        } else {
          setActiveTab((prev) => (prev === 'bot_screen' || prev === 'payroll' ? 'workers' : prev));
        }
      } else {
        // Oddiy ishchi yoki begona foydalanuvchi Telegram Mini App orqali kirdi!
        // Har qanday eski admin tasdig'ini darhol o'chiramiz:
        if (
          verifiedAdminTgId &&
          verifiedAdminTgId !== 'PIN_VERIFIED_ADMIN' &&
          verifiedAdminTgId !== 'PAYROLL_PIN_VERIFIED'
        ) {
          setVerifiedAdminTgId(null);
          try {
            sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
            localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
          } catch {}
        }

        const matchedWorker = users.find(
          (u) =>
            u.role === 'worker' &&
            ((u.telegram_id && String(u.telegram_id).trim() === tgIdStr) ||
              (tgUsername && u.telegram_id && String(u.telegram_id).toLowerCase() === tgUsername))
        );

        if (matchedWorker) {
          setCurrentUser(matchedWorker);
          try {
            localStorage.setItem('navo_current_user_id', String(matchedWorker.id));
          } catch {}
          setActiveTab('bot_screen');
        } else if (users.length > 0) {
          // Ushbu Telegram foydalanuvchisi hali ro'yxatdan o'tmagan — Kirish/Ro'yxatdan o'tish oynasini ochamiz!
          try {
            localStorage.removeItem('navo_current_user_id');
          } catch {}
          setCurrentUser(null);
          setActiveTab('bot_screen');
        }
      }
      return;
    }

    // Telegram WebApp bo'lmagan oddiy brauzerda (yoki botdan havola orqali) ochilganda:
    if (workerTgId && !autoAdmin && users.length > 0) {
      // Admin ID hech qachon oddiy URL parametr orqali PIN-kodsiz ochilmaydi!
      if (isUserAdminByTelegramId(workerTgId, settings, users)) {
        if (!verifiedAdminTgId) {
          setCurrentUser(null);
          setShowAdminLoginModal(true);
        }
        return;
      }

      const foundWorker = users.find(
        (u) => u.role === 'worker' && String(u.telegram_id || '').trim() === workerTgId
      );
      if (foundWorker) {
        setVerifiedAdminTgId(null);
        setCurrentUser(foundWorker);
        try {
          sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
          localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
          localStorage.setItem('navo_current_user_id', String(foundWorker.id));
        } catch {}
        setActiveTab('bot_screen');
      } else {
        // Yangi / ro'yxatdan o'tmagan foydalanuvchi -> Kirish ekrani
        setVerifiedAdminTgId(null);
        setCurrentUser(null);
        try {
          localStorage.removeItem('navo_current_user_id');
        } catch {}
        setActiveTab('bot_screen');
      }
      return;
    }

    if (!isTg) {
      if (autoAdmin && !verifiedAdminTgId) {
        setCurrentUser(null);
        setShowAdminLoginModal(true);
      }
      try {
        const savedId = localStorage.getItem('navo_current_user_id');
        const savedVerifiedAdmin =
          sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) ||
          localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
        if (savedId && users.length > 0) {
          const savedUser = users.find((u) => String(u.id) === savedId);
          if (!savedUser) {
            localStorage.removeItem('navo_current_user_id');
            setCurrentUser(null);
          } else {
            const isSavedAdmin =
              savedUser.id === 1 ||
              savedUser.role === 'admin' ||
              isUserAdminByTelegramId(savedUser.telegram_id, settings, users);
            if (isSavedAdmin && !savedVerifiedAdmin) {
              localStorage.removeItem('navo_current_user_id');
              setCurrentUser(null);
            } else {
              setCurrentUser(savedUser);
            }
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

  // Tizimdan chiqish (Logout) - iframe va Telegram WebView ichida ham 100% ishonchli ishlaydi
  const handleLogout = () => {
    triggerHaptic('medium');
    try {
      localStorage.removeItem('navo_current_user_id');
      localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
      sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
      localStorage.removeItem('navo_verified_admin_tg_id');
      sessionStorage.removeItem('navo_verified_admin_tg_id');
      sessionStorage.removeItem('navo_payroll_vault_unlocked');
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
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

  const sendNotification = (publicMsg: string, privateAdminMsg?: string) => {
    if (!settings.bot_token) return;

    const rawAdminTargets = [
      ...(settings.admin_telegram_id || '').split(/[,;\s]+/),
      ...(settings.admin_ids || []),
      ...(settings.admins || []).map((a) => String(a.telegram_id || '')),
    ]
      .map((s) => String(s || '').trim())
      .filter((s) => s && !s.startsWith('-') && s !== '123456789');

    const rawGroupTargets = (settings.group_telegram_id || '')
      .split(/[,;\s]+/)
      .map((s) => String(s || '').trim())
      .filter((s) => s && s.startsWith('-'));

    const uniqueAdmins = Array.from(new Set(rawAdminTargets));
    const uniqueGroups = Array.from(new Set(rawGroupTargets));

    if (uniqueAdmins.length > 0) {
      sendTelegramNotification(
        settings.bot_token,
        uniqueAdmins.join(', '),
        privateAdminMsg || publicMsg
      ).catch((e) => console.error('Telegram admin notification error:', e));
    }

    if (uniqueGroups.length > 0) {
      sendTelegramNotification(settings.bot_token, uniqueGroups.join(', '), publicMsg)
        .then((res) => {
          if (res.migratedTo && res.migratedTo !== settings.group_telegram_id) {
            console.log('Superguruh migratsiyasi aniqlandi:', res.migratedTo);
            const updated = { ...settings, group_telegram_id: res.migratedTo };
            setSettings(updated);
            saveSettingsToFirestore(updated).catch(console.error);
          }
        })
        .catch((e) => console.error('Telegram group notification error:', e));
    }
  };

  const handleWorkerCheckIn = (lat?: number, lon?: number) => {
    if (!currentUser) return;
    const now = new Date();
    const todayDate = getLocalDateString(now);
    const timeStr = getTashkentTimeString(now, true);

    // Bugungi mavjud/tugallangan smenalarni hisoblash
    const todayShifts = attendances.filter(
      (a) => a.user_id === currentUser.id && a.date === todayDate && a.status === 'completed'
    );
    const isFirstShift = todayShifts.length === 0;
    const shiftNumber = todayShifts.length + 1;

    const penaltyInfo = calculateLatePenaltyAmount(
      timeStr,
      currentUser.work_start_time || '08:00',
      shiftNumber,
      settings
    );

    const newAttendance: Attendance = {
      id: Date.now(),
      user_id: currentUser.id,
      date: todayDate,
      check_in_time: timeStr,
      check_in_lat: lat,
      check_in_lon: lon,
      total_break_minutes: 0,
      worked_minutes: 0,
      late_minutes: penaltyInfo.lateMinutes,
      chargeable_late_minutes: penaltyInfo.chargeableLateMinutes,
      late_penalty: penaltyInfo.penaltyAmount,
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

    const lateMins = penaltyInfo.lateMinutes;
    let lateText = '';

    if (isFirstShift) {
      lateText = lateMins > 0 ? `⚠️ ${lateMins} daqiqa kechikdi` : `✅ O'z vaqtida keldi`;
    } else {
      lateText = `🔄 ${shiftNumber}-smena (Qaytadan kirish — kechikish hisoblanmaydi)`;
    }

    const locText = lat && lon ? `📍 Do'konda (GPS tasdiqlandi)` : `📱 Mini App orqali`;
    const shiftBadge = shiftNumber > 1 ? ` (${shiftNumber}-smena)` : '';

    const publicMsg =
      `🟢 <b>${settings.shop_name} — Ishga keldi${shiftBadge}</b>\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name} (${currentUser.position || 'Xodim'})\n` +
      `⏰ <b>Kelgan vaqti:</b> ${timeStr.slice(0, 5)} (${todayDate})\n` +
      `⏱ <b>Ish rejasi:</b> ${currentUser.work_start_time || '08:00'} - ${currentUser.work_end_time || '20:00'} [${lateText}]\n` +
      `📍 <b>Lokatsiya:</b> ${locText}`;

    const adminPenaltyExtra =
      isFirstShift && penaltyInfo.penaltyAmount > 0
        ? `\n⚠️ <b>Kechikish jarimasi (Maxfiy/Admin):</b> <b>${formatUzSum(penaltyInfo.penaltyAmount)}</b> (${penaltyInfo.chargeableLateMinutes} daq × ${(settings.late_penalty_per_minute_sum ?? 1000).toLocaleString()} so'm)`
        : '';

    sendNotification(publicMsg, publicMsg + adminPenaltyExtra);
  };

  const handleStartBreak = () => {
    if (!currentUser) return;
    const now = new Date();
    const targetAtt = attendances.find(
      (a) => a.user_id === currentUser.id && a.status === 'working'
    );
    if (!targetAtt) return;

    const updatedTarget: Attendance = {
      ...targetAtt,
      status: 'on_break',
      note: `Tanaffus: ${Date.now()}`,
    };

    setAttendances((prev) =>
      prev.map((a) => (a.id === updatedTarget.id ? updatedTarget : a))
    );
    saveAttendanceToFirestore(updatedTarget).catch((e) =>
      console.error('Error saving break to Firestore:', e)
    );

    const timeStr = getTashkentTimeString(now, false);
    const msg =
      `☕️ <b>${settings.shop_name} — Tanaffusga chiqdi</b>\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name}\n` +
      `⏰ <b>Vaqt:</b> ${timeStr}`;
    sendNotification(msg);
  };

  const handleEndBreak = () => {
    if (!currentUser) return;
    const now = new Date();
    const targetAtt = attendances.find(
      (a) => a.user_id === currentUser.id && a.status === 'on_break'
    );
    if (!targetAtt) return;

    let breakMinutes = 15;
    if (targetAtt.note && targetAtt.note.startsWith('Tanaffus: ')) {
      try {
        const raw = targetAtt.note.replace('Tanaffus: ', '').trim();
        const startMs = /^\d+$/.test(raw) ? parseInt(raw, 10) : new Date(raw).getTime();
        const diffMs = Date.now() - startMs;
        breakMinutes = Math.max(1, Math.round(diffMs / 60000));
        if (breakMinutes > 180) breakMinutes = 30;
      } catch {
        breakMinutes = 15;
      }
    }

    const updatedTarget: Attendance = {
      ...targetAtt,
      status: 'working',
      total_break_minutes: (targetAtt.total_break_minutes || 0) + breakMinutes,
      note: undefined,
    };

    setAttendances((prev) =>
      prev.map((a) => (a.id === updatedTarget.id ? updatedTarget : a))
    );
    saveAttendanceToFirestore(updatedTarget).catch((e) =>
      console.error('Error saving break end to Firestore:', e)
    );

    const timeStr = getTashkentTimeString(now, false);
    const msg =
      `▶️ <b>${settings.shop_name} — Tanaffus yakunlandi</b>\n\n` +
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

    const targetAtt = attendances.find(
      (a) =>
        a.user_id === currentUser.id &&
        (a.status === 'working' || a.status === 'on_break')
    );
    if (!targetAtt) return;

    const sameDayShifts = attendances
      .filter((item) => item.user_id === currentUser.id && item.date === targetAtt.date)
      .sort(
        (x, y) =>
          (x.check_in_time || '').localeCompare(y.check_in_time || '') || x.id - y.id
      );
    const shiftIdx = Math.max(
      1,
      sameDayShifts.findIndex((item) => item.id === targetAtt.id) + 1
    );

    // Smena yakunlanganda kechikkan daqiqalar va jarimani avtomatik hisoblab Attendance ob'ektiga qo'shib saqlash
    const isBossOrAdmin =
      currentUser.role === 'admin' ||
      /boshliq|admin|rahbar|direktor|owner/i.test(currentUser.position || '');

    const penaltyInfo = isBossOrAdmin
      ? { lateMinutes: 0, chargeableLateMinutes: 0, penaltyAmount: 0 }
      : calculateLatePenaltyAmount(
          targetAtt.check_in_time,
          currentUser.work_start_time || '08:00',
          shiftIdx,
          settings
        );

    const computedLateMinutes = penaltyInfo.lateMinutes;
    const computedChargeableMinutes = penaltyInfo.chargeableLateMinutes;
    const computedLatePenalty = penaltyInfo.penaltyAmount;

    const updatedTarget: Attendance = {
      ...targetAtt,
      status: 'completed',
      check_out_date: checkOutDate,
      check_out_time: checkOutTime,
      worked_minutes: workedMinutes,
      late_minutes: computedLateMinutes,
      chargeable_late_minutes: computedChargeableMinutes,
      late_penalty: computedLatePenalty,
      note: autoReason ? `Avtomatik ketish: ${autoReason}` : targetAtt.note,
    };

    setAttendances((prev) =>
      prev.map((a) => (a.id === updatedTarget.id ? updatedTarget : a))
    );
    saveAttendanceToFirestore(updatedTarget).catch((e) =>
      console.error('Error saving check-out to Firestore:', e)
    );

    const hours = Math.floor(workedMinutes / 60);
    const mins = workedMinutes % 60;
    const workedStr = `${hours} soat ${mins} daqiqa`;

    const titlePrefix = autoReason
      ? `🔴 <b>${settings.shop_name} — Ishdan ketdi (Avtomatik Geozona)</b>`
      : `🔴 <b>${settings.shop_name} — Ishdan ketdi</b>`;

    const reasonLine = autoReason
      ? `📍 <b>Sabab:</b> ${autoReason}\n`
      : '';

    const publicMsg =
      `${titlePrefix}\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name} (${currentUser.position || 'Xodim'})\n` +
      `⏰ <b>Ketgan vaqti:</b> ${checkOutTime.slice(0, 5)} (${checkOutDate})\n` +
      `⏱ <b>Ishlagan vaqti:</b> <b>${workedStr}</b> (${(workedMinutes / 60).toFixed(1)} soat)\n` +
      reasonLine +
      `✅ Davomat Google Firestore bazasiga yozildi.`;

    const adminPenaltyLine =
      computedLatePenalty > 0
        ? `⚠️ <b>Smena kechikish jarimasi (Maxfiy/Admin):</b> <b>${formatUzSum(computedLatePenalty)}</b> (${computedLateMinutes} daq kechikish, ${computedChargeableMinutes} daq jarima)\n`
        : '';

    const adminMsg =
      `${titlePrefix}\n\n` +
      `👤 <b>Xodim:</b> ${currentUser.full_name} (${currentUser.position || 'Xodim'})\n` +
      `⏰ <b>Ketgan vaqti:</b> ${checkOutTime.slice(0, 5)} (${checkOutDate})\n` +
      `⏱ <b>Ishlagan vaqti:</b> <b>${workedStr}</b> (${(workedMinutes / 60).toFixed(1)} soat)\n` +
      adminPenaltyLine +
      reasonLine +
      `✅ Davomat Google Firestore bazasiga yozildi.`;

    sendNotification(publicMsg, adminMsg);
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
                sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, targetId);
                localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, targetId);
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
              // PIN bilan kirish
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
                telegram_id: undefined,
                role: 'admin',
              };

              setVerifiedAdminTgId('PIN_VERIFIED_ADMIN');
              try {
                sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'PIN_VERIFIED_ADMIN');
                localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'PIN_VERIFIED_ADMIN');
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
              sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, verifiedId);
              localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, verifiedId);
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
              role: 'admin',
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
        verifiedAdminTgId={effectiveVerifiedAdminId}
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
              settings={settings}
              forWorkerId={currentUser.id}
            />
          ) : activeTab === 'telegram_guide' ? (
            <TelegramGuide
              settings={settings}
              onSaveSettings={async (newSettings) => {
                if (isAdmin) {
                  setSettings(newSettings);
                  await saveSettingsToFirestore(newSettings);
                }
              }}
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
                settings={settings}
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
                settings={settings}
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
                settings={settings}
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
                verifiedAdminTgId={effectiveVerifiedAdminId}
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
        verifiedAdminTgId={effectiveVerifiedAdminId}
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
            sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, verifiedId);
            localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, verifiedId);
          } catch {}

          // Admin foydalanuvchi ob'ektini yangilash (begona Telegram ID lar avtomatik bazaga admin qilib yozilmaydi!)
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

          const designatedPayroll = String(settings.payroll_admin_id || '45701569').trim();
          if (verifiedId === designatedPayroll || verifiedId === '45701569' || verifiedId === 'PIN_VERIFIED_ADMIN') {
            setActiveTab('workers');
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
