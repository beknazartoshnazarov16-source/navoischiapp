export function generateTelegramBotCode(
  botToken: string,
  adminId: string,
  shopName: string,
  webappUrl: string,
  groupId?: string
): string {
  const token = botToken || 'SIZNING_TELEGRAM_BOT_TOKENINGIZ';
  const rawAdmin = [adminId, groupId].filter(Boolean).join(', ') || '123456789';
  const shop = shopName || 'Navo Market';

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
${shop} — Xodimlar Ish Vaqti va Davomat Telegram Boti (Mukammal Versiya)
========================================================================
1. Toshkent (UTC+5) vaqti bilan 100% aniq hisoblaydi.
2. Tungi smenalar (00:00 dan keyin ketish) va bir kunda bir necha smenani to'liq qabul qiladi.
3. Tanaffuslarni aniq daqiqasigacha hisoblab, ish vaqtidan ayirib beradi.
4. Xavfsiz HTML xabarlar: ismlardagi maxsus belgilar xatolik keltirib chiqarmaydi.
5. Guruh/Kanal ID lari (-100...) va shaxsiy admin ID larni qo'llab-quvvatlaydi.
"""

import os
import re
import html
import sqlite3
from datetime import datetime, timezone, timedelta
import telebot
from telebot import types

# O'ZBEKISTON VAQTI (Toshkent UTC+5)
UZ_TZ = timezone(timedelta(hours=5))

def get_uz_now():
    return datetime.now(UZ_TZ)

BOT_TOKEN = os.getenv("BOT_TOKEN") or "${token}"
ADMINS_RAW = os.getenv("ADMINS") or os.getenv("ADMIN_ID") or "${rawAdmin}"
ADMIN_IDS = [x.strip() for x in re.split(r'[,;\\s]+', str(ADMINS_RAW)) if x.strip()]
ADMIN_ID = ADMIN_IDS[0] if ADMIN_IDS else "${adminId || '123456789'}"
SHOP_NAME = os.getenv("SHOP_NAME") or "${shop}"
WEBAPP_URL = os.getenv("WEBAPP_URL") or "${webappUrl}"
DB_PATH = os.getenv("DB_PATH") or "market_time.db"

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML")

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS workers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT UNIQUE,
                full_name TEXT NOT NULL,
                phone TEXT,
                position TEXT DEFAULT 'Xodim',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                worker_id INTEGER NOT NULL,
                check_in_time TIMESTAMP NOT NULL,
                check_out_time TIMESTAMP,
                worked_minutes INTEGER DEFAULT 0,
                total_break_minutes INTEGER DEFAULT 0,
                status TEXT DEFAULT 'working',
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (worker_id) REFERENCES workers(id)
            )
        """)
        try:
            cursor.execute("ALTER TABLE attendance ADD COLUMN total_break_minutes INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        conn.commit()

init_db()

def clean_phone(phone_raw):
    if not phone_raw:
        return ""
    digits = re.sub(r'\\D', '', str(phone_raw))
    if digits.startswith("998") and len(digits) == 12:
        return digits
    elif len(digits) == 9:
        return "998" + digits
    return digits

def format_minutes(minutes):
    if not minutes or minutes <= 0:
        return "0 daqiqa"
    hours = minutes // 60
    mins = minutes % 60
    if hours > 0 and mins > 0:
        return f"{hours} soat {mins} daqiqa"
    elif hours > 0:
        return f"{hours} soat"
    return f"{mins} daqiqa"

def is_user_admin(tg_id):
    tg_str = str(tg_id).strip()
    return tg_str in [str(x).strip() for x in ADMIN_IDS] or tg_str == str(ADMIN_ID).strip()

def notify_admin(text):
    global ADMIN_IDS
    for idx, adm in enumerate(list(ADMIN_IDS)):
        adm_clean = str(adm).strip()
        if adm_clean and adm_clean != "123456789" and re.match(r'^-?\\d+$', adm_clean):
            try:
                bot.send_message(adm_clean, text, parse_mode="HTML")
            except Exception as e:
                err_str = str(e).lower()
                migrated_id = None
                if hasattr(e, 'result_json') and isinstance(e.result_json, dict):
                    migrated_id = e.result_json.get('parameters', {}).get('migrate_to_chat_id')
                if 'upgraded to a supergroup' in err_str or migrated_id:
                    if migrated_id:
                        new_id_str = str(migrated_id)
                        print(f"Guruh superguruhga o'tdi: {adm_clean} -> {new_id_str}")
                        ADMIN_IDS[idx] = new_id_str
                        try:
                            bot.send_message(new_id_str, text, parse_mode="HTML")
                        except Exception as e2:
                            print(f"Yangi superguruhga yuborishda xato: {e2}")
                else:
                    print(f"Admin ({adm_clean}) bildirishnoma xatosi: {e}")

def get_main_keyboard(is_admin=False):
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True)
    btn_in = types.KeyboardButton("📍 Ishga keldim")
    btn_out = types.KeyboardButton("🏃‍♂️ Ishdan ketdim")
    btn_break_start = types.KeyboardButton("☕️ Tanaffusga chiqish")
    btn_break_end = types.KeyboardButton("▶️ Tanaffusdan qaytish")
    btn_my_hours = types.KeyboardButton("⏱ Mening soatlarim")
    
    markup.row(btn_in, btn_out)
    markup.row(btn_break_start, btn_break_end)
    markup.row(btn_my_hours)

    if WEBAPP_URL and WEBAPP_URL.startswith("http"):
        btn_app = types.KeyboardButton("📱 Mini Appni ochish", web_app=types.WebAppInfo(url=WEBAPP_URL))
        markup.row(btn_app)

    if is_admin:
        btn_live = types.KeyboardButton("🔴 Hozir ishda kim bor?")
        btn_report = types.KeyboardButton("📊 Oylik umumiy hisobot")
        btn_workers = types.KeyboardButton("👥 Ishchilar ro'yxati")
        markup.row(btn_live)
        markup.row(btn_report, btn_workers)

    return markup

def is_cmd(msg, *variants):
    if not msg or not msg.text:
        return False
    clean = msg.text.split('@')[0].strip().lower()
    return clean in [v.lower() for v in variants]

@bot.message_handler(commands=['id', 'chatid', 'guruh'])
def handle_chat_id(message):
    is_group = message.chat.type in ['group', 'supergroup']
    chat_type = "guruh" if is_group else "shaxsiy chat"
    bot.reply_to(
        message,
        f"🆔 <b>Ushbu {chat_type} ID raqami:</b> <code>{message.chat.id}</code>\\n\\n"
        f"<i>Nusxa olish uchun raqam ustiga bosing va tizim sozlamalariga kiriting!</i>",
        parse_mode="HTML"
    )

@bot.message_handler(commands=['start'])
def handle_start(message):
    tg_id = str(message.from_user.id)
    first_name = html.escape(message.from_user.first_name or "Foydalanuvchi")
    is_adm = is_user_admin(tg_id)
    is_group = message.chat.type in ['group', 'supergroup']

    if is_group:
        bot.reply_to(
            message,
            f"🏪 <b>{SHOP_NAME}</b> davomat boti guruhda faol!\\n\\n"
            f"Guruhdagi buyruqlar:\\n"
            f"📍 <b>/keldim</b> — Ishga kelganingizni qayd etish\\n"
            f"🏃‍♂️ <b>/ketdim</b> — Ishdan ketganingizni qayd etish\\n"
            f"☕️ <b>/tanaffus</b> — Tanaffusga chiqish\\n"
            f"▶️ <b>/qaytdim</b> — Tanaffusdan qaytish\\n"
            f"⏱ <b>/soatlarim</b> — Oylik ishlagan soatlaringiz\\n"
            f"📅 <b>/bugun</b> — Bugungi davomat ro'yxati\\n"
            f"🆔 <b>/id</b> — Ushbu guruh ID raqamini ko'rish\\n\\n"
            f"<i>Yangi xodimlar to'liq ro'yxatdan o'tish uchun botga shaxsiy xabar yozing!</i>",
            parse_mode="HTML"
        )
        return

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

    if is_adm:
        bot.send_message(
            message.chat.id,
            f"Assalomu alaykum, Hurmatli Admin!\\n\\n"
            f"🏪 <b>{SHOP_NAME}</b> xodimlari ish vaqti hisobi botiga xush kelibsiz.\\n"
            f"Quyidagi boshqaruv tugmalari orqali davomatni nazorat qilishingiz mumkin.",
            reply_markup=get_main_keyboard(is_admin=True),
            parse_mode="HTML"
        )
        return

    if not worker:
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
        btn_phone = types.KeyboardButton("📱 Telefon raqamni yuborish", request_contact=True)
        markup.add(btn_phone)
        bot.send_message(
            message.chat.id,
            f"Assalomu alaykum, <b>{first_name}</b>!\\n\\n"
            f"<b>{SHOP_NAME}</b> botida ro'yxatdan o'tish uchun quyidagi '📱 Telefon raqamni yuborish' tugmasini bosing:",
            reply_markup=markup,
            parse_mode="HTML"
        )
    else:
        name_esc = html.escape(worker[1])
        bot.send_message(
            message.chat.id,
            f"Assalomu alaykum, <b>{name_esc}</b>!\\n\\n"
            f"Kelganingizda '📍 Ishga keldim', ketayotganingizda '🏃‍♂️ Ishdan ketdim' tugmasini bosing.",
            reply_markup=get_main_keyboard(is_admin=False),
            parse_mode="HTML"
        )

@bot.message_handler(content_types=['contact'])
def handle_contact(message):
    tg_id = str(message.from_user.id)
    first_name = (message.from_user.first_name or "").strip()
    last_name = (message.from_user.last_name or "").strip()
    full_name = f"{first_name} {last_name}".strip() or "Xodim"
    phone = clean_phone(message.contact.phone_number)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM workers WHERE phone = ? OR telegram_id = ?", (phone, tg_id))
        existing = cursor.fetchone()

        if existing:
            cursor.execute("UPDATE workers SET telegram_id = ?, phone = ?, full_name = ? WHERE id = ?", (tg_id, phone, full_name, existing[0]))
        else:
            cursor.execute("INSERT INTO workers (telegram_id, full_name, phone) VALUES (?, ?, ?)", (tg_id, full_name, phone))
        conn.commit()

    name_esc = html.escape(full_name)
    bot.send_message(
        message.chat.id,
        f"✅ <b>Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>\\n\\n"
        f"👤 Xodim: <b>{name_esc}</b>\\n"
        f"📱 Telefon: +{phone}",
        reply_markup=get_main_keyboard(is_admin=is_user_admin(tg_id)),
        parse_mode="HTML"
    )
    notify_admin(f"👤 <b>Yangi xodim ro'yxatdan o'tdi:</b>\\nIsm: <b>{name_esc}</b>\\nTel: +{phone}")

@bot.message_handler(func=lambda msg: msg.text == "📍 Ishga keldim")
def handle_check_in(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting (/start).")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, check_in_time, status FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        active = cursor.fetchone()

        if active:
            if active[2] == 'on_break':
                bot.send_message(
                    message.chat.id,
                    f"☕️ Siz hozir tanaffusdasiz (boshlangan vaqti: <b>{active[1][11:16]}</b>).\\nQaytganingizda <b>'▶️ Tanaffusdan qaytish'</b> tugmasini bosing.",
                    parse_mode="HTML"
                )
                return

            try:
                prev_in = datetime.strptime(active[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
            except Exception:
                prev_in = now
            diff_h = (now - prev_in).total_seconds() / 3600

            if diff_h > 16 or prev_in.date() < now.date():
                capped_m = min(int(diff_h * 60), 600)
                cursor.execute(
                    "UPDATE attendance SET check_out_time = ?, worked_minutes = ?, status = 'completed', note = 'Unutilgan smena avtomatik yopildi' WHERE id = ?",
                    (now.strftime("%Y-%m-%d %H:%M:%S"), capped_m, active[0])
                )
                conn.commit()
                bot.send_message(message.chat.id, "⚠️ <i>Avvalgi kungi unutilgan smenangiz xavfsiz yopildi va bugungi yangi smenangiz boshlandi.</i>", parse_mode="HTML")
            else:
                bot.send_message(message.chat.id, f"⚠️ Siz allaqachon ishdasiz! Kelgan vaqtingiz: <b>{active[1][11:16]}</b>", parse_mode="HTML")
                return

        today_str = now.strftime("%Y-%m-%d")
        cursor.execute(
            "SELECT COUNT(*) FROM attendance WHERE worker_id = ? AND check_in_time LIKE ? AND status = 'completed'",
            (worker_id, f"{today_str}%")
        )
        count = cursor.fetchone()[0]
        shift_num = count + 1

        cursor.execute(
            "INSERT INTO attendance (worker_id, check_in_time, total_break_minutes, status) VALUES (?, ?, 0, 'working')",
            (worker_id, now.strftime("%Y-%m-%d %H:%M:%S"))
        )
        conn.commit()

    time_str = now.strftime("%H:%M")
    bot.send_message(
        message.chat.id,
        f"✅ <b>Ishga kelganingiz qayd etildi! ({shift_num}-smena)</b>\\n\\n"
        f"👤 Xodim: <b>{name_esc}</b>\\n"
        f"🕒 Kelgan vaqt: <b>{time_str}</b>\\n\\n"
        f"Kuningiz barakali o'tsin!",
        parse_mode="HTML"
    )
    notify_admin(f"🟢 <b>Ishga keldi:</b> {name_esc}\\n🕒 Vaqt: <b>{time_str}</b> ({shift_num}-smena)")

@bot.message_handler(func=lambda msg: msg.text == "☕️ Tanaffusga chiqish")
def handle_break_start(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, status FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        shift = cursor.fetchone()

        if not shift or shift[1] == 'on_break':
            bot.send_message(message.chat.id, "⚠️ Hozir tanaffus belgilab bo'lmaydi.")
            return

        cursor.execute("UPDATE attendance SET status = 'on_break', note = ? WHERE id = ?", (now.strftime("%Y-%m-%d %H:%M:%S"), shift[0]))
        conn.commit()

    time_str = now.strftime("%H:%M")
    bot.send_message(message.chat.id, f"☕️ <b>Tanaffus boshlandi ({time_str})</b>\\nQaytganingizda '▶️ Tanaffusdan qaytish' tugmasini bosing.", parse_mode="HTML")
    notify_admin(f"☕️ <b>Tanaffusga chiqdi:</b> {name_esc} ({time_str})")

@bot.message_handler(func=lambda msg: msg.text == "▶️ Tanaffusdan qaytish")
def handle_break_end(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, status, note, COALESCE(total_break_minutes, 0) FROM attendance WHERE worker_id = ? AND status = 'on_break' ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        shift = cursor.fetchone()

        if not shift:
            bot.send_message(message.chat.id, "⚠️ Siz hozir tanaffusda emassiz.")
            return

        b_mins = 15
        if shift[2]:
            try:
                b_start = datetime.strptime(shift[2], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
                b_mins = max(1, int((now - b_start).total_seconds() // 60))
            except Exception:
                b_mins = 15

        new_total = (shift[3] or 0) + b_mins
        cursor.execute("UPDATE attendance SET status = 'working', total_break_minutes = ?, note = NULL WHERE id = ?", (new_total, shift[0]))
        conn.commit()

    time_str = now.strftime("%H:%M")
    bot.send_message(message.chat.id, f"▶️ <b>Tanaffus yakunlandi ({time_str})</b>. Ish davom etmoqda!", parse_mode="HTML")
    notify_admin(f"▶️ <b>Tanaffusdan qaytdi:</b> {name_esc} ({time_str}, davomiyligi: {format_minutes(b_mins)})")

@bot.message_handler(func=lambda msg: msg.text == "🏃‍♂️ Ishdan ketdim")
def handle_check_out(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, check_in_time, COALESCE(total_break_minutes, 0), status, note FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        shift = cursor.fetchone()

        if not shift:
            bot.send_message(message.chat.id, "⚠️ Siz hali ish boshlamagansiz.")
            return

        shift_id, in_str, total_b, st, b_note = shift
        if st == 'on_break' and b_note:
            try:
                b_start = datetime.strptime(b_note, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
                total_b += max(1, int((now - b_start).total_seconds() // 60))
            except Exception:
                pass

        try:
            in_dt = datetime.strptime(in_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
        except Exception:
            in_dt = now

        diff_sec = (now - in_dt).total_seconds()
        raw_minutes = max(1, int(diff_sec // 60))
        net_minutes = max(1, raw_minutes - total_b)
        capped_minutes = min(net_minutes, 600) if raw_minutes > 1200 else net_minutes

        cursor.execute(
            "UPDATE attendance SET check_out_time = ?, worked_minutes = ?, total_break_minutes = ?, status = 'completed' WHERE id = ?",
            (now.strftime("%Y-%m-%d %H:%M:%S"), capped_minutes, total_b, shift_id)
        )
        conn.commit()

        today_str = now.strftime("%Y-%m-%d")
        cursor.execute(
            "SELECT SUM(worked_minutes), COUNT(*) FROM attendance WHERE worker_id = ? AND check_in_time LIKE ? AND status = 'completed'",
            (worker_id, f"{today_str}%")
        )
        tot = cursor.fetchone()

    total_today = tot[0] or capped_minutes
    today_shifts = tot[1] or 1
    b_info = f" (☕️ Tanaffus: {format_minutes(total_b)})" if total_b > 0 else ""

    msg = (
        f"🏁 <b>Ishdan ketganingiz qayd etildi!</b>\\n\\n"
        f"👤 Xodim: <b>{name_esc}</b>\\n"
        f"🟢 Keldi: <b>{in_dt.strftime('%H:%M')}</b> | 🔴 Ketdi: <b>{now.strftime('%H:%M')}</b>\\n"
        f"⏱ Ushbu smenada: <b>{format_minutes(capped_minutes)}</b>{b_info}\\n"
        f"📊 Bugun jami: <b>{format_minutes(total_today)}</b> ({today_shifts} smena)"
    )
    bot.send_message(message.chat.id, msg, parse_mode="HTML")
    notify_admin(f"🔴 <b>Ishdan ketdi:</b> {name_esc}\\n⏱ Smena: <b>{format_minutes(capped_minutes)}</b>{b_info} | Jami bugun: <b>{format_minutes(total_today)}</b>")

@bot.message_handler(commands=['bugun'])
def handle_today(message):
    now = get_uz_now()
    today_str = now.strftime("%Y-%m-%d")
    tg_id = str(message.from_user.id)
    is_adm = is_user_admin(tg_id)

    with get_db() as conn:
        cursor = conn.cursor()
        if is_adm:
            cursor.execute("""
                SELECT w.full_name, a.check_in_time, a.check_out_time, a.worked_minutes, a.status
                FROM attendance a
                JOIN workers w ON a.worker_id = w.id
                WHERE a.check_in_time LIKE ?
                ORDER BY a.id ASC
            """, (f"{today_str}%",))
            rows = cursor.fetchall()
            if not rows:
                bot.send_message(message.chat.id, f"📅 Bugun ({now.strftime('%d.%m.%Y')}) hali hech kim ishga kelmadi.")
                return

            text = f"📅 <b>Bugungi kunlik davomat ({now.strftime('%d.%m.%Y')}):</b>\\n\\n"
            for r in rows:
                name, cin, cout, wmins, st = r
                name_esc = html.escape(name)
                in_t = cin[11:16] if cin else "--:--"
                out_t = cout[11:16] if cout else ("☕️ Tanaffusda" if st == 'on_break' else "🟢 Hozir ishda")
                w_str = format_minutes(wmins) if wmins else "davom etmoqda"
                text += f"👤 <b>{name_esc}</b>\\n   Keldi: {in_t} | Ketdi: {out_t} ({w_str})\\n\\n"
            bot.send_message(message.chat.id, text, parse_mode="HTML")
        else:
            cursor.execute("SELECT id FROM workers WHERE telegram_id = ?", (tg_id,))
            w = cursor.fetchone()
            if not w:
                bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting.")
                return
            cursor.execute("""
                SELECT check_in_time, check_out_time, worked_minutes, status
                FROM attendance WHERE worker_id = ? AND check_in_time LIKE ? ORDER BY id ASC
            """, (w[0], f"{today_str}%"))
            rows = cursor.fetchall()
            if not rows:
                bot.send_message(message.chat.id, "📅 Bugun hali ish qayd etilmadi.")
                return
            text = f"📅 <b>Sizning bugungi davomatingiz ({now.strftime('%d.%m.%Y')}):</b>\\n\\n"
            tot = 0
            for r in rows:
                in_t = r[0][11:16] if r[0] else "--:--"
                out_t = r[1][11:16] if r[1] else ("☕️ Tanaffusda" if r[3] == 'on_break' else "🟢 Hozir ishda")
                m = r[2] or 0
                tot += m
                text += f"• {in_t} ➡️ {out_t} ({format_minutes(m) if m else 'davom etmoqda'})\\n"
            text += f"\\n📊 <b>Jami:</b> <b>{format_minutes(tot)}</b>"
            bot.send_message(message.chat.id, text, parse_mode="HTML")

print("==========================================")
print(f"{SHOP_NAME} Boti ishga tushirildi...")
print(f"O'zbekiston vaqti: {get_uz_now().strftime('%Y-%m-%d %H:%M:%S')}")
print("==========================================")
bot.infinity_polling()
`;
}
