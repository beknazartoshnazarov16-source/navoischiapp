export type Role = 'admin' | 'worker';
export type AttendanceStatus = 'working' | 'on_break' | 'completed';

export interface User {
  id: number;
  telegram_id?: string | number;
  full_name: string;
  phone: string;
  role: Role;
  position: string;
  work_start_time: string; // Masalan: "08:00"
  work_end_time: string;   // Masalan: "18:00" yoki "20:00"
  is_active: boolean;
  pin?: string;            // 4 xonali shaxsiy PIN kod (masalan: "2008")
  created_at?: string;
  salary_type?: 'hourly' | 'fixed'; // Soatbay yoki oylik qat'iy
  hourly_rate?: number;             // Masalan: 15000 so'm/soat
  fixed_salary?: number;            // Masalan: 3500000 so'm/oy
}

export interface Attendance {
  id: number;
  user_id: number;
  date: string; // Kelgan sana: YYYY-MM-DD
  check_in_time: string; // Kelgan vaqti: HH:MM (yoki HH:MM:SS)
  check_out_date?: string; // Ketgan sana: YYYY-MM-DD (agar 00:00 dan keyin ketsa keyingi kun)
  check_out_time?: string; // Ketgan vaqti: HH:MM (yoki HH:MM:SS)
  check_in_lat?: number;
  check_in_lon?: number;
  total_break_minutes: number;
  worked_minutes: number; // Jami ishlagan daqiqasi
  status: AttendanceStatus;
  note?: string;
  created_at?: string;
}

export interface AdminMember {
  telegram_id: string;
  full_name: string;
  phone?: string;
  role_title?: string; // Masalan: "Bosh Admin", "Do'kon Ma'muri", "Menejer"
  added_at?: string;
  is_primary?: boolean;
}

export interface StoreAnnouncement {
  id: string;
  title: string;
  message: string;
  date: string;
  created_by?: string;
  urgency?: 'normal' | 'high';
}

export interface SalaryAdjustment {
  id: string;
  user_id: number;
  month: string; // YYYY-MM
  type: 'advance' | 'bonus' | 'penalty';
  amount: number;
  date: string;
  note: string;
  created_at?: string;
}

export interface PayrollPayoutRecord {
  id: string;
  user_id: number;
  start_date: string; // Masalan: "2026-10-01"
  end_date: string;   // Masalan: "2026-10-15"
  period_label?: string;
  worked_minutes: number;
  worked_hours: number;
  worked_days: number;
  hourly_rate?: number;
  gross_salary: number; // Hisoblangan asosiy maosh
  advances: number;     // Avans
  penalties: number;    // Jarima
  bonuses: number;      // Mukofot
  net_amount: number;   // Yakuniy to'langan summa
  payment_method?: 'cash' | 'card' | 'transfer';
  payment_date: string; // YYYY-MM-DD
  paid_at: string;      // ISO
  note?: string;
  paid_by?: string;
}

export interface MarketSettings {
  shop_name: string;
  gps_required: boolean;
  gps_checkout_required?: boolean;
  market_latitude: number;
  market_longitude: number;
  gps_radius_meters: number;
  bot_token?: string;
  admin_telegram_id?: string;
  group_telegram_id?: string;
  admin_pin?: string;
  timezone: string;
  admins?: AdminMember[];
  admin_ids?: string[];
  // Aqlli Eslatmalar Sozlamalari
  reminder_checkout_enabled?: boolean;
  reminder_morning_enabled?: boolean;
  reminder_daily_summary?: boolean;
  reminder_six_hours_enabled?: boolean;
  reminder_six_hours_last_sent?: string;
  active_announcement?: StoreAnnouncement | null;
  // Geozona va Masofa bo'yicha Avtomatik ketish (100 metr uzoqlashganda)
  auto_checkout_on_distance_enabled?: boolean; // Do'kondan uzoqlashganda avtomatik ketishni qayd etish
  auto_checkout_distance_meters?: number;      // Necha metr uzoqlashganda (standart: 100 metr)
  // Oylik va Ish haqi (Buxgalteriya) sozlamalari - FAQAT 1 NAZORATCHI ADMIN UCHUN
  payroll_admin_id?: string;               // Faqat ushbu yagona Bosh Admin ko'ra oladi
  payroll_master_pin?: string;             // Maxfiy Oylik PIN kodi (boshlang'ich: "9009")
  payroll_default_hourly_rate?: number;    // Standart soatlik to'lov (masalan: 15 000 so'm)
  salary_adjustments?: SalaryAdjustment[]; // Avanslar, mukofot va jarimalar
  payroll_payout_status?: Record<string, 'pending' | 'paid'>; // To'lov holati (masalan "2026-09_12": "paid")
  payroll_payout_records?: PayrollPayoutRecord[]; // To'langan maoshlar va oraliq kvitansiyalari tarixi
}

export interface WorkerMonthlyHours {
  user_id: number;
  full_name: string;
  position: string;
  phone: string;
  worked_days: number;
  total_worked_minutes: number;
  total_worked_hours: number; // Masalan 184.5
  formatted_total_hours: string; // Masalan "184 soat 30 daqiqa"
  average_daily_minutes: number;
}
