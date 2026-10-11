import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { User, Attendance, MarketSettings } from '../types';
import { INITIAL_USERS, INITIAL_SETTINGS } from '../data/mockData';

// Kolleksiya nomlari
const USERS_COLLECTION = 'users';
const ATTENDANCE_COLLECTION = 'attendance';
const SETTINGS_COLLECTION = 'settings';
const SETTINGS_DOC_ID = 'general_settings';

/**
 * Foydalanuvchilar (Ishchilar va Admin) ro'yxatini real-vaqtda tinglash
 */
export function subscribeToUsers(
  onData: (users: User[]) => void,
  onError?: (err: any) => void
) {
  const usersRef = collection(db, USERS_COLLECTION);
  return onSnapshot(
    usersRef,
    (snapshot) => {
      if (snapshot.empty) {
        // Agar baza bo'm-bo'sh bo'lsa, boshlang'ich adminni kiritib qo'yamiz
        initializeDefaultData();
        return;
      }
      const list: User[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: Number(data.id || docSnap.id),
          telegram_id: data.telegram_id,
          full_name: data.full_name || '',
          phone: data.phone || '',
          role: data.role || 'worker',
          position: data.position || 'Xodim',
          work_start_time: data.work_start_time || '08:00',
          work_end_time: data.work_end_time || '20:00',
          is_active: data.is_active !== undefined ? data.is_active : true,
          pin: data.pin || undefined,
          created_at: data.created_at,
          salary_type: data.salary_type || 'hourly',
          hourly_rate: data.hourly_rate !== undefined ? Number(data.hourly_rate) : undefined,
          fixed_salary: data.fixed_salary !== undefined ? Number(data.fixed_salary) : undefined,
        });
      });
      // ID bo'yicha tartiblash
      list.sort((a, b) => a.id - b.id);
      onData(list);
    },
    (err) => {
      console.error('Firestore users subscription error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Davomat yozuvlarini real-vaqtda tinglash
 */
export function subscribeToAttendance(
  onData: (attendances: Attendance[]) => void,
  onError?: (err: any) => void
) {
  const attRef = collection(db, ATTENDANCE_COLLECTION);
  return onSnapshot(
    attRef,
    (snapshot) => {
      const list: Attendance[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: Number(data.id || docSnap.id),
          user_id: Number(data.user_id),
          date: data.date,
          check_in_time: data.check_in_time,
          check_out_date: data.check_out_date,
          check_out_time: data.check_out_time,
          check_in_lat: data.check_in_lat,
          check_in_lon: data.check_in_lon,
          total_break_minutes: Number(data.total_break_minutes || 0),
          worked_minutes: Number(data.worked_minutes || 0),
          status: data.status,
          note: data.note,
          created_at: data.created_at,
        });
      });
      // Eng yangi davomat yuqorida turishi uchun
      list.sort((a, b) => b.id - a.id);
      onData(list);
    },
    (err) => {
      console.error('Firestore attendance subscription error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Sozlamalarni tinglash
 */
export function subscribeToSettings(
  onData: (settings: MarketSettings) => void,
  onError?: (err: any) => void
) {
  const docRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID);
  return onSnapshot(
    docRef,
    (docSnap) => {
      if (docSnap.exists()) {
        onData(docSnap.data() as MarketSettings);
      } else {
        // Boshlang'ich sozlamani yozish
        setDoc(docRef, INITIAL_SETTINGS).catch((e) =>
          console.error('Save initial settings error:', e)
        );
      }
    },
    (err) => {
      console.error('Firestore settings subscription error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Baza bo'sh bo'lganda boshlang'ich admin va sozlamalarni yaratish
 */
async function initializeDefaultData() {
  try {
    const adminUser = INITIAL_USERS[0];
    const userDocRef = doc(db, USERS_COLLECTION, String(adminUser.id));
    await setDoc(userDocRef, cleanForFirestore(adminUser), { merge: true });

    const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID);
    await setDoc(settingsRef, cleanForFirestore(INITIAL_SETTINGS), { merge: true });
  } catch (error) {
    console.error('Error initializing default data:', error);
  }
}

/**
 * Firestore ob'yektlarda undefined qiymatlarni qabul qilmaydi (xatolik beradi).
 * Shuning uchun barcha undefined bo'lgan maydonlarni xavfsiz tozalaymiz.
 */
export function cleanForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanForFirestore);
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = cleanForFirestore(val);
    }
  }
  return result;
}

// --- CRUD Funksiyalari ---

export async function saveUserToFirestore(user: User) {
  try {
    const userRef = doc(db, USERS_COLLECTION, String(user.id));
    await setDoc(userRef, cleanForFirestore(user), { merge: true });
  } catch (error) {
    console.error('Error saving user to Firestore:', error);
    throw error;
  }
}

export async function deleteUserFromFirestore(userId: number) {
  try {
    const userRef = doc(db, USERS_COLLECTION, String(userId));
    await deleteDoc(userRef);
  } catch (error) {
    console.error('Error deleting user from Firestore:', error);
    throw error;
  }
}

export async function saveAttendanceToFirestore(att: Attendance) {
  try {
    const attRef = doc(db, ATTENDANCE_COLLECTION, String(att.id));
    await setDoc(attRef, cleanForFirestore(att), { merge: true });
  } catch (error) {
    console.error('Error saving attendance to Firestore:', error);
    throw error;
  }
}

export async function deleteAttendanceFromFirestore(attId: number) {
  try {
    const attRef = doc(db, ATTENDANCE_COLLECTION, String(attId));
    await deleteDoc(attRef);
  } catch (error) {
    console.error('Error deleting attendance from Firestore:', error);
    throw error;
  }
}

export async function saveSettingsToFirestore(settings: MarketSettings) {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID);
    await setDoc(docRef, cleanForFirestore(settings), { merge: true });
  } catch (error) {
    console.error('Error saving settings to Firestore:', error);
    throw error;
  }
}
