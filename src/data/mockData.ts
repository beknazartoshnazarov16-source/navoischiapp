import { Attendance, MarketSettings, User } from '../types';

export const INITIAL_SETTINGS: MarketSettings = {
  shop_name: 'Navo Market',
  gps_required: true, // Do'konga haqiqatan ham kelganligini tekshirish uchun GPS standart yoqilgan
  gps_checkout_required: true, // Do'kondan ketayotganda ham do'kon hududida ekanligini tekshirish (o'chirib-yoqiladigan)
  market_latitude: 38.829651,
  market_longitude: 65.810833,
  gps_radius_meters: 100,
  bot_token: '',
  admin_telegram_id: '45701569',
  payroll_admin_id: '45701569',
  admin_pin: '7207',
  timezone: 'Asia/Tashkent',
  payroll_master_pin: '9009',
  payroll_default_hourly_rate: 15000,
  salary_adjustments: [],
  payroll_payout_status: {},
  auto_checkout_on_distance_enabled: true,
  auto_checkout_distance_meters: 100,
  late_penalty_enabled: true,
  late_grace_period_minutes: 10,
  late_penalty_per_minute_sum: 1000,
  reminder_morning_wakeup_enabled: true,
  reminder_morning_wakeup_minutes_before: 30,
};

// Foydalanuvchilar faqat Firestore bazasidan yuklanadi — yangi kirganlarga hech qachon Admin profili ochilib ketmasligi uchun bo'sh!
export const INITIAL_USERS: User[] = [];

// Bo'sh boshlang'ich davomat ro'yxati (hech qanday soxta yozuvlar yo'q)
export const INITIAL_ATTENDANCE: Attendance[] = [];
