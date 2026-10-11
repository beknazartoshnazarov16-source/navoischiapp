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
};

// Faqat bitta asosiy Admin foydalanuvchisi qoldirildi, barcha eski soxta ishchilar to'liq o'chirib tashlandi!
export const INITIAL_USERS: User[] = [
  {
    id: 1,
    telegram_id: '45701569',
    full_name: 'Beknazar Toshnazarov (Admin)',
    phone: '+99890 123 45 67',
    role: 'admin',
    position: 'Do\'kon egasi / Bosh Admin',
    work_start_time: '08:00',
    work_end_time: '20:00',
    is_active: true,
    created_at: new Date().toISOString(),
  },
];

// Bo'sh boshlang'ich davomat ro'yxati (hech qanday soxta yozuvlar yo'q)
export const INITIAL_ATTENDANCE: Attendance[] = [];
