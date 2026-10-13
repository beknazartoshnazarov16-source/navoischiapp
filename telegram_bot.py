#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Navo Market — Xodimlar Ish Vaqti va Davomat Telegram Boti (Professional Versiya)
================================================================================
Imkoniyatlari:
1. Toshkent (UTC+5) vaqti bilan 100% aniq ishlaydi (server qayerda joylashganidan qat'i nazar).
2. Tungi smenalarni (00:00 dan keyin ketish) va erta ketishni daqiqasigacha to'g'ri hisoblaydi.
3. Bir kunda bir necha smena: xodim kun davomida bir necha bor kelib-ketishi mumkin.
4. Tanaffus (break) tizimi: tanaffusga chiqish va qaytish vaqtini daqiqasigacha hisoblab,
   ish vaqtidan to'g'ri chegirib beradi.
5. Unutilgan smenalarni avtomatik tuzatish: kecha ketishni bosish unutilgan bo'lsa,
   ertasi kuni kelganda eski smena xavfsiz yopilib, yangi smena muammosiz ochiladi.
6. Admin va Guruhlarga xabarnomalar: Shaxsiy admin ID hamda Telegram guruh/kanal ID (-100...) larni
   qo'llab-quvvatlaydi.
7. Xavfsiz HTML formatlash: Foydalanuvchi ismida belgi (_ * [ ] < > &) bo'lsa ham bot aslo xatolik bermaydi.
8. Mini App integratsiyasi: Menyuda va /app buyrug'i orqali WebApp ochish imkoniyati.
"""

import os
import re
import html
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
import telebot
from telebot import types

# O'ZBEKISTON VAQTI (Toshkent UTC+5)
UZ_TZ = timezone(timedelta(hours=5))

def get_uz_now():
    """O'zbekiston (Toshkent) ning joriy aniq vaqtini qaytaradi"""
    return datetime.now(UZ_TZ)

# SOZLAMALAR
BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN") or "BOT_TOKENINGIZNI_SHU_YERGA_YOZING"
ADMINS_RAW = os.getenv("ADMINS") or os.getenv("ADMIN_TELEGRAM_ID") or "123456789"
ADMIN_IDS = [x.strip() for x in re.split(r'[,;\s]+', str(ADMINS_RAW)) if x.strip()]
ADMIN_ID = ADMIN_IDS[0] if ADMIN_IDS else "123456789"
GROUP_CHAT_ID = os.getenv("GROUP_CHAT_ID") or os.getenv("GROUP_TELEGRAM_ID") or ""
SHOP_NAME = os.getenv("SHOP_NAME", "Navo Market")
DB_PATH = os.getenv("DB_PATH", "market_time.db")
WEBAPP_URL = os.getenv("WEBAPP_URL") or os.getenv("MINI_APP_URL") or "https://ais-pre-sn5pew5d4v6dsgb6ijaf5d-752669647478.asia-southeast1.run.app"

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML")

# --- Ma'lumotlar bazasi boshqaruvi ---
def get_db():
    """SQLite ulanishini ochish va xavfsiz yopish uchun yordamchi"""
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn

def init_db():
    """Baza va jadvallarni initsializatsiya qilish"""
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
                FOREIGN KEY (worker_id) REFERENCES workers (id)
            )
        """)
        # Avvalgi bazalar uchun ustunlarni tekshirib qo'shish (migratsiya)
        try:
            cursor.execute("ALTER TABLE attendance ADD COLUMN total_break_minutes INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute("ALTER TABLE workers ADD COLUMN position TEXT DEFAULT 'Xodim'")
        except sqlite3.OperationalError:
            pass
        conn.commit()

init_db()

# --- Yordamchi Funksiyalar ---
def clean_phone(phone_str):
    """Telefon raqamni xalqaro standart 998XXXXXXXXX ko'rinishiga keltiradi"""
    if not phone_str:
        return ""
    digits = re.sub(r'\D', '', str(phone_str))
    if digits.startswith("998") and len(digits) == 12:
        return digits
    elif len(digits) == 9:
        return "998" + digits
    return digits

def format_minutes(minutes):
    """Daqiqalarni chiroyli qilib 'X soat Y daqiqa' ko'rinishiga aylantirish"""
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
    """Foydalanuvchi admin ekanligini tekshirish"""
    tg_str = str(tg_id).strip()
    return tg_str in [str(x).strip() for x in ADMIN_IDS] or tg_str == str(ADMIN_ID).strip()

def notify_admin(text):
    """Admin yoki guruh chatlariga bildirishnoma yuborish (shaxsiy yoki -100 guruh)"""
    global ADMIN_IDS
    for idx, adm in enumerate(list(ADMIN_IDS)):
        adm_clean = str(adm).strip()
        # Shaxsiy ID (123456) yoki guruh ID (-100123456789)
        if adm_clean and adm_clean != "123456789" and re.match(r'^-?\d+$', adm_clean):
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
                    print(f"Admin ({adm_clean}) ga xabar yuborishda xatolik: {e}")

def get_main_keyboard(is_admin=False):
    """Asosiy klaviatura tugmalari"""
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
        btn_reminders = types.KeyboardButton("🔔 Eslatmalar")
        btn_kpi = types.KeyboardButton("🏆 KPI Reyting")
        btn_report = types.KeyboardButton("📊 Oylik umumiy hisobot")
        btn_workers = types.KeyboardButton("👥 Ishchilar ro'yxati")
        markup.row(btn_live, btn_reminders)
        markup.row(btn_kpi, btn_report)
        markup.row(btn_workers)

    return markup

def is_cmd(msg, *variants):
    """Xabar guruhda yoki shaxsiy chatda variantlardan biriga mos kelishini tekshiradi"""
    if not msg or not msg.text:
        return False
    clean = msg.text.split('@')[0].strip().lower()
    return clean in [v.lower() for v in variants]

# --- BUYRUQLAR ---

@bot.message_handler(commands=['id', 'chatid', 'guruh'])
def handle_chat_id(message):
    is_group = message.chat.type in ['group', 'supergroup']
    chat_type = "guruh" if is_group else "shaxsiy chat"
    bot.reply_to(
        message,
        f"🆔 <b>Ushbu {chat_type} ID raqami:</b> <code>{message.chat.id}</code>\n\n"
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
            f"🏪 <b>{SHOP_NAME}</b> davomat boti guruhda faol!\n\n"
            f"Guruhda ishlatiladigan buyruqlar:\n"
            f"📍 <b>/keldim</b> — Ishga kelganingizni qayd etish\n"
            f"🏃‍♂️ <b>/ketdim</b> — Ishdan ketganingizni qayd etish\n"
            f"☕️ <b>/tanaffus</b> — Tanaffusga chiqish\n"
            f"▶️ <b>/qaytdim</b> — Tanaffusdan qaytish\n"
            f"⏱ <b>/soatlarim</b> — Oylik ishlagan soatlaringiz\n"
            f"📅 <b>/bugun</b> — Bugungi davomat ro'yxati\n"
            f"🆔 <b>/id</b> — Ushbu guruh ID raqamini ko'rish\n\n"
            f"<i>Yangi xodimlar to'liq ro'yxatdan o'tish uchun botga shaxsiy xabar yozing!</i>",
            parse_mode="HTML"
        )
        return

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name, phone FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

    if is_adm:
        bot.send_message(
            message.chat.id,
            f"Assalomu alaykum, Hurmatli Admin!\n\n"
            f"🏪 <b>{SHOP_NAME}</b> xodimlari ish vaqti hisobi botiga xush kelibsiz.\n"
            f"Quyidagi boshqaruv tugmalari orqali davomatni jonli nazorat qilishingiz mumkin.",
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
            f"Assalomu alaykum, <b>{first_name}</b>!\n\n"
            f"<b>{SHOP_NAME}</b> ish vaqti hisobi botiga xush kelibsiz.\n"
            f"Tizimdan foydalanish uchun quyidagi '📱 Telefon raqamni yuborish' tugmasini bosing:",
            reply_markup=markup,
            parse_mode="HTML"
        )
    else:
        name_esc = html.escape(worker[1])
        bot.send_message(
            message.chat.id,
            f"Assalomu alaykum, <b>{name_esc}</b>!\n\n"
            f"Ish boshlaganingizda '📍 Ishga keldim', ketayotganingizda '🏃‍♂️ Ishdan ketdim' tugmasini bosing.\n"
            f"Bir kunda necha marta kelib-ketsangiz ham har biri aniq daqiqasigacha hisoblab boriladi.",
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
        cursor.execute("SELECT id, full_name FROM workers WHERE phone = ? OR telegram_id = ?", (phone, tg_id))
        existing = cursor.fetchone()

        if existing:
            cursor.execute(
                "UPDATE workers SET telegram_id = ?, phone = ?, full_name = ? WHERE id = ?",
                (tg_id, phone, full_name, existing[0])
            )
        else:
            cursor.execute(
                "INSERT INTO workers (telegram_id, full_name, phone) VALUES (?, ?, ?)",
                (tg_id, full_name, phone)
            )
        conn.commit()

    is_adm = is_user_admin(tg_id)
    name_esc = html.escape(full_name)
    bot.send_message(
        message.chat.id,
        f"✅ <b>Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>\n\n"
        f"👤 Xodim: <b>{name_esc}</b>\n"
        f"📱 Telefon: +{phone}\n\n"
        f"Endi bemalol ish vaqtingizni belgilashingiz mumkin.",
        reply_markup=get_main_keyboard(is_admin=is_adm),
        parse_mode="HTML"
    )
    notify_admin(f"👤 <b>Yangi xodim ro'yxatdan o'tdi:</b>\nIsm: <b>{name_esc}</b>\nTel: +{phone}")

# --- ISHGA KELDIM ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "📍 Ishga keldim", "/keldim", "/in", "keldim"))
def handle_check_in(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()
    is_adm = is_user_admin(tg_id)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval /start buyrug'ini bosing va telefon raqamingizni yuboring.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        # Ochiq smena bormi (working yoki on_break)
        cursor.execute(
            "SELECT id, check_in_time, status FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        active_shift = cursor.fetchone()

        if active_shift:
            shift_id, in_time_str, shift_status = active_shift
            if shift_status == 'on_break':
                bot.send_message(
                    message.chat.id,
                    f"☕️ Siz hozir tanaffusdasiz (boshlangan vaqti: <b>{in_time_str[11:16]}</b>).\n\n"
                    f"Ishni davom ettirish uchun iltimos <b>'▶️ Tanaffusdan qaytish'</b> tugmasini bosing.",
                    parse_mode="HTML"
                )
                return

            try:
                prev_check_in = datetime.strptime(in_time_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
            except Exception:
                prev_check_in = now

            diff_hours = (now - prev_check_in).total_seconds() / 3600

            # Agar kecha kelib ketishni unutgan bo'lsa (16+ soat yoki yangi kalendar kun)
            if diff_hours > 16 or prev_check_in.date() < now.date():
                capped_minutes = min(int(diff_hours * 60), 600)  # maks 10 soat
                cursor.execute("""
                    UPDATE attendance 
                    SET check_out_time = ?, worked_minutes = ?, status = 'completed', note = 'Avvalgi kungi unutilgan smena avtomatik yopildi'
                    WHERE id = ?
                """, (now.strftime("%Y-%m-%d %H:%M:%S"), capped_minutes, shift_id))
                conn.commit()

                bot.send_message(
                    message.chat.id,
                    f"⚠️ <i>Eslatma: Avvalgi smenangiz ({in_time_str[11:16]}) da ketish belgilanmagan ekan. Eski smena xavfsiz yopildi.</i>",
                    parse_mode="HTML"
                )
            else:
                bot.send_message(
                    message.chat.id,
                    f"⚠️ Siz allaqachon ishdasiz!\n"
                    f"Kelgan vaqtingiz: <b>{in_time_str[11:16]}</b> ({in_time_str[:10]})\n\n"
                    f"Ish tugaganda <b>'🏃‍♂️ Ishdan ketdim'</b> tugmasini bosing.",
                    parse_mode="HTML"
                )
                return

        # Bugungi smenalar soni
        today_str = now.strftime("%Y-%m-%d")
        cursor.execute("""
            SELECT COUNT(*) FROM attendance 
            WHERE worker_id = ? AND check_in_time LIKE ? AND status = 'completed'
        """, (worker_id, f"{today_str}%"))
        completed_today = cursor.fetchone()[0]
        shift_num = completed_today + 1

        # Yangi smenani ochish
        cursor.execute(
            "INSERT INTO attendance (worker_id, check_in_time, total_break_minutes, status) VALUES (?, ?, 0, 'working')",
            (worker_id, now.strftime("%Y-%m-%d %H:%M:%S"))
        )
        conn.commit()

    time_str = now.strftime("%H:%M")
    date_str = now.strftime("%d.%m.%Y")

    if completed_today > 0:
        msg = (
            f"✅ <b>Qaytadan ishga kelganingiz qayd etildi! (Bugungi {shift_num}-smena)</b>\n\n"
            f"👤 Xodim: <b>{name_esc}</b>\n"
            f"🕒 Vaqt: <b>{time_str}</b> ({date_str})\n\n"
            f"Kuningiz barakali o'tsin!"
        )
    else:
        msg = (
            f"✅ <b>Ishga kelganingiz qayd etildi!</b>\n\n"
            f"👤 Xodim: <b>{name_esc}</b>\n"
            f"🕒 Kelgan vaqt: <b>{time_str}</b> ({date_str})\n\n"
            f"Kuningiz barakali o'tsin!"
        )

    bot.send_message(message.chat.id, msg, parse_mode="HTML")
    notify_admin(f"🟢 <b>Ishga keldi:</b> {name_esc}\n🕒 Vaqt: <b>{time_str}</b> ({date_str})\nSmena: {shift_num}")

# --- TANAFFUSGA CHIQISH ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "☕️ Tanaffusga chiqish", "/tanaffus", "/break", "tanaffus"))
def handle_break_start(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval /start bosing.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, status FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        shift = cursor.fetchone()

        if not shift:
            bot.send_message(message.chat.id, "⚠️ Siz hali ish boshlamagansiz. Avval '📍 Ishga keldim' tugmasini bosing.")
            return

        if shift[1] == 'on_break':
            bot.send_message(message.chat.id, "☕️ Siz allaqachon tanaffusdasiz. Qaytganingizda '▶️ Tanaffusdan qaytish' tugmasini bosing.")
            return

        # Tanaffus boshlanish vaqtini saqlaymiz
        cursor.execute(
            "UPDATE attendance SET status = 'on_break', note = ? WHERE id = ?",
            (now.strftime("%Y-%m-%d %H:%M:%S"), shift[0])
        )
        conn.commit()

    time_str = now.strftime("%H:%M")
    bot.send_message(
        message.chat.id,
        f"☕️ <b>Tanaffus boshlandi!</b>\n"
        f"Vaqt: <b>{time_str}</b>\n\n"
        f"Dam olib qaytganingizda <b>'▶️ Tanaffusdan qaytish'</b> tugmasini bosing.",
        parse_mode="HTML"
    )
    notify_admin(f"☕️ <b>Tanaffusga chiqdi:</b> {name_esc}\n🕒 Vaqt: <b>{time_str}</b>")

# --- TANAFFUSDAN QAYTISH ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "▶️ Tanaffusdan qaytish", "/qaytdim", "/resume", "qaytdim"))
def handle_break_end(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval /start bosing.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, status, note, COALESCE(total_break_minutes, 0) FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        shift = cursor.fetchone()

        if not shift or shift[1] != 'on_break':
            bot.send_message(message.chat.id, "⚠️ Siz hozir tanaffusda emassiz.")
            return

        shift_id = shift[0]
        break_start_str = shift[2]
        prev_break_mins = shift[3] or 0

        # Aniq tanaffus davomiyligi
        break_mins = 15
        if break_start_str:
            try:
                b_start = datetime.strptime(break_start_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
                diff_sec = (now - b_start).total_seconds()
                break_mins = max(1, int(diff_sec // 60))
            except Exception:
                break_mins = 15

        new_total_break = prev_break_mins + break_mins

        cursor.execute(
            "UPDATE attendance SET status = 'working', total_break_minutes = ?, note = NULL WHERE id = ?",
            (new_total_break, shift_id)
        )
        conn.commit()

    time_str = now.strftime("%H:%M")
    bot.send_message(
        message.chat.id,
        f"▶️ <b>Tanaffus yakunlandi!</b>\n"
        f"Vaqt: <b>{time_str}</b> (Tanaffus davomiyligi: <b>{format_minutes(break_mins)}</b>)\n\n"
        f"Ish davom etmoqda. Omadli ish!",
        parse_mode="HTML"
    )
    notify_admin(f"▶️ <b>Tanaffusdan qaytdi:</b> {name_esc}\n🕒 Vaqt: <b>{time_str}</b> (Tanaffus: {format_minutes(break_mins)})")

# --- ISHDAN KETDIM ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "🏃‍♂️ Ishdan ketdim", "/ketdim", "/out", "ketdim"))
def handle_check_out(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval /start bosing.")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        cursor.execute(
            "SELECT id, check_in_time, COALESCE(total_break_minutes, 0), status, note FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        active_shift = cursor.fetchone()

        if not active_shift:
            bot.send_message(
                message.chat.id,
                "⚠️ Siz hali '📍 Ishga keldim' tugmasini bosmagansiz.\nAvval ish boshlagan vaqtingizni qayd eting."
            )
            return

        shift_id, check_in_str, total_break, status, break_note = active_shift

        # Agar tanaffusda turib ketishni bossa, tanaffusni ham qo'shib yopamiz
        if status == 'on_break' and break_note:
            try:
                b_start = datetime.strptime(break_note, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
                extra_break = max(1, int((now - b_start).total_seconds() // 60))
                total_break += extra_break
            except Exception:
                pass

        check_in_dt = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%H:%M:%S", "%H:%M"):
            try:
                dt = datetime.strptime(check_in_str.strip(), fmt)
                if fmt in ("%H:%M:%S", "%H:%M"):
                    check_in_dt = now.replace(hour=dt.hour, minute=dt.minute, second=dt.second if hasattr(dt, 'second') else 0, microsecond=0)
                    if check_in_dt > now:
                        check_in_dt -= timedelta(days=1)
                else:
                    check_in_dt = dt.replace(tzinfo=UZ_TZ)
                break
            except Exception:
                continue

        if not check_in_dt:
            check_in_dt = now

        # Ishlangan vaqtni hisoblash (00:00 dan oldin yoki keyin ketganidan qat'iy nazar)
        time_diff = now - check_in_dt
        raw_minutes = int(time_diff.total_seconds() // 60)
        if raw_minutes < 0:
            # Agar sana bir xil bo'lib, vaqt oldinroq bo'lsa (tungi smena)
            raw_minutes += 24 * 60

        warning_note = None
        if raw_minutes > 1200:  # 20 soatdan ko'p (unutib ketilgan)
            total_minutes = 600
            warning_note = "Vaqt uzoq cho'zilganligi uchun standart 10 soat qilib belgilandi."
        else:
            net_minutes = raw_minutes - total_break
            total_minutes = max(1, net_minutes)

        cursor.execute(
            "UPDATE attendance SET check_out_time = ?, worked_minutes = ?, total_break_minutes = ?, status = 'completed', note = ? WHERE id = ?",
            (now.strftime("%Y-%m-%d %H:%M:%S"), total_minutes, total_break, warning_note, shift_id)
        )
        conn.commit()

        # Bugungi jami ishlangan vaqt (har xil sana formatlarini hisobga olgan holda)
        today_str = now.strftime("%Y-%m-%d")
        today_dmy = now.strftime("%d.%m.%Y")
        cursor.execute("""
            SELECT SUM(worked_minutes), COUNT(*) FROM attendance 
            WHERE worker_id = ? AND status = 'completed' AND (check_in_time LIKE ? OR check_in_time LIKE ? OR check_out_time LIKE ?)
        """, (worker_id, f"{today_str}%", f"{today_dmy}%", f"{today_str}%"))
        today_row = cursor.fetchone()

        today_total_minutes = today_row[0] or total_minutes
        today_shifts_count = today_row[1] or 1

    worked_str = format_minutes(total_minutes)
    today_total_str = format_minutes(today_total_minutes)
    in_display = check_in_dt.strftime("%d.%m.%Y %H:%M")
    out_display = now.strftime("%d.%m.%Y %H:%M")

    break_info = f" (☕️ Tanaffus: {format_minutes(total_break)})" if total_break > 0 else ""

    resp = (
        f"🏁 <b>Ishdan ketganingiz qayd etildi!</b>\n\n"
        f"👤 Xodim: <b>{name_esc}</b>\n"
        f"🟢 Kelgan: <b>{in_display}</b>\n"
        f"🔴 Ketgan: <b>{out_display}</b>\n"
        f"⏱ Ushbu smenada: <b>{worked_str}</b>{break_info}\n\n"
        f"📊 <b>Bugun jami:</b> <b>{today_total_str}</b> ({today_shifts_count} ta smena)\n\n"
        f"💡 <i>Agar bugun yana kelsangiz, istalgan vaqt '📍 Ishga keldim'ni bosishingiz mumkin!</i>"
    )
    if warning_note:
        resp += f"\n\n⚠️ <i>{warning_note}</i>"

    bot.send_message(message.chat.id, resp, parse_mode="HTML")
    notify_admin(
        f"🔴 <b>Ishdan ketdi:</b> {name_esc}\n"
        f"⏱ Ushbu smena: <b>{worked_str}</b>{break_info}\n"
        f"📊 Bugungi jami: <b>{today_total_str}</b> ({today_shifts_count}-marta)"
    )

    # BARCHA ISHCHILAR ISHINI TUGATGANLIGINI TEKSHIRISH:
    # Faqat hamma xodimlar ketgandagina kunlik yakuniy hisobot jo'natiladi!
    check_and_trigger_daily_closing_report(today_str)

# --- MENING SOATLARIM ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "⏱ Mening soatlarim", "/soatlarim", "/vaqtim"))
def handle_my_hours(message):
    tg_id = str(message.from_user.id)
    now = get_uz_now()
    current_month_prefix = now.strftime("%Y-%m")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
        worker = cursor.fetchone()

        if not worker:
            bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting (/start).")
            return

        worker_id, worker_name = worker[0], worker[1]
        name_esc = html.escape(worker_name)

        # Oydagi barcha tugallangan smenalar
        cursor.execute("""
            SELECT check_in_time, check_out_time, worked_minutes
            FROM attendance
            WHERE worker_id = ? AND status = 'completed' AND check_in_time LIKE ?
            ORDER BY id DESC
        """, (worker_id, f"{current_month_prefix}%"))
        shifts = cursor.fetchall()

        # Hozir ochiq smenasi bormi?
        cursor.execute(
            "SELECT check_in_time, status FROM attendance WHERE worker_id = ? AND (status = 'working' OR status = 'on_break') ORDER BY id DESC LIMIT 1",
            (worker_id,)
        )
        active_shift = cursor.fetchone()

    total_minutes = sum(s[2] for s in shifts) if shifts else 0
    unique_days = len(set(s[0][:10] for s in shifts)) if shifts else 0
    total_shifts_count = len(shifts) if shifts else 0

    text = f"📊 <b>{name_esc} ning {now.strftime('%m.%Y')} oyi hisoboti:</b>\n\n"
    text += f"📅 Kelgan kunlar: <b>{unique_days} kun</b> ({total_shifts_count} ta smena)\n"
    text += f"⏱ <b>JAMI ISHLANGAN VAQT:</b> <b>{format_minutes(total_minutes)}</b> ({round(total_minutes/60, 1)} soat)\n"

    if active_shift:
        st_text = "🟢 Hozir ishdasiz" if active_shift[1] == 'working' else "☕️ Hozir tanaffusdasiz"
        text += f"\n<i>{st_text} (Kelgan vaqtingiz: {active_shift[0][11:16]})</i>\n"

    if shifts:
        text += "\nSo'nggi keldi-ketdilar:\n"
        for s in shifts[:6]:
            in_t = s[0][5:16]
            out_t = s[1][5:16] if s[1] else "---"
            mins_str = format_minutes(s[2])
            text += f"• {in_t} ➡️ {out_t} ({mins_str})\n"

    bot.send_message(message.chat.id, text, parse_mode="HTML")

# --- ADMIN: HOZIR ISHDA KIM BOR? ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "🔴 Hozir ishda kim bor?", "/live"))
def handle_admin_live(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        return

    now = get_uz_now()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT w.full_name, a.check_in_time, a.status 
            FROM attendance a
            JOIN workers w ON a.worker_id = w.id
            WHERE a.status IN ('working', 'on_break')
            ORDER BY a.id ASC
        """)
        active_workers = cursor.fetchall()

    if not active_workers:
        bot.send_message(message.chat.id, "Hozirda do'konda ishlayotgan xodimlar yo'q (hamma ketgan).")
        return

    text = f"🔴 <b>HOZIR ISHDA BO'LGANLAR ({len(active_workers)} kishi):</b>\n"
    text += f"🕒 Vaqt: <b>{now.strftime('%H:%M')}</b> ({now.strftime('%d.%m.%Y')})\n"
    text += "━━━━━━━━━━━━━━━━━━━━\n\n"

    for idx, (name, in_time, status) in enumerate(active_workers, 1):
        name_esc = html.escape(name)
        try:
            in_dt = datetime.strptime(in_time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
            duration_mins = int((now - in_dt).total_seconds() // 60)
            duration_str = format_minutes(duration_mins)
        except Exception:
            duration_str = "Noma'lum"

        status_badge = "🟢 Ishlamoqda" if status == 'working' else "☕️ Tanaffusda"
        text += f"{idx}. <b>{name_esc}</b> — {status_badge}\n"
        text += f"   Keldi: {in_time[11:16]} ({in_time[:10]})\n"
        text += f"   Davomiylik: <b>{duration_str}</b>\n\n"

    bot.send_message(message.chat.id, text, parse_mode="HTML")

# --- ADMIN: ESLATMALAR VA XABARNOMALAR ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "🔔 Eslatmalar", "/eslatma", "/eslatmalar"))
def handle_admin_reminders(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        bot.send_message(message.chat.id, "Kechirasiz, ushbu bo'lim faqat do'kon ma'murlari uchun!")
        return

    now = get_uz_now()
    today_str = now.strftime("%Y-%m-%d")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT w.id, w.full_name, w.telegram_id, a.check_in_time
            FROM attendance a
            JOIN workers w ON a.worker_id = w.id
            WHERE a.status IN ('working', 'on_break')
        """)
        active_shifts = cursor.fetchall()

        overdue_workers = []
        for w_id, w_name, w_tg, in_time in active_shifts:
            try:
                in_dt = datetime.strptime(in_time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UZ_TZ)
                diff_hours = (now - in_dt).total_seconds() / 3600
                if diff_hours >= 10:
                    overdue_workers.append((w_name, in_time[11:16], int(diff_hours)))
            except Exception:
                pass

        cursor.execute("SELECT id, full_name FROM workers WHERE is_active = 1")
        all_workers = cursor.fetchall()

        cursor.execute("SELECT DISTINCT worker_id FROM attendance WHERE check_in_time LIKE ?", (f"{today_str}%",))
        checked_in_ids = {row[0] for row in cursor.fetchall()}
        not_checked_in = [w for w in all_workers if w[0] not in checked_in_ids]

    text = f"🔔 <b>{SHOP_NAME} — AQLLI ESLATMALAR</b>\n\n"

    if overdue_workers:
        text += f"⚠️ <b>Ketishni unutganlar (10+ soat ishda):</b>\n"
        for name, in_t, hours in overdue_workers:
            text += f"• <b>{html.escape(name)}</b> — {in_t} da kelgan ({hours} soatdan beri ishda)\n"
        text += "\n"
    else:
        text += "✅ <i>Ketishni unutgan xodimlar yo'q.</i>\n\n"

    if not_checked_in:
        text += f"☀️ <b>Bugun hali kelmaganlar ({len(not_checked_in)} kishi):</b>\n"
        for _, name in not_checked_in[:8]:
            text += f"• {html.escape(name)}\n"
        if len(not_checked_in) > 8:
            text += f"<i>...va yana {len(not_checked_in) - 8} ta xodim</i>\n"
    else:
        text += "✅ <i>Bugun barcha xodimlar ishga kelgan.</i>\n"

    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("📢 6 Soatlik Xulosani Guruhga Yuborish", callback_data="send_6h_now"))
    if WEBAPP_URL and WEBAPP_URL.startswith("http"):
        markup.add(types.InlineKeyboardButton("🔔 Eslatmalarni Boshqarish (Mini App)", web_app=types.WebAppInfo(url=WEBAPP_URL)))

    bot.send_message(message.chat.id, text, reply_markup=markup, parse_mode="HTML")

# --- HAR 6 SOATLIK MONITORING VA QAT'IY ESLATMA FUNKSIYASI ---
def generate_six_hour_summary_text():
    """Do'kondagi joriy davomat holati va qat'iy eslatma matnini tayyorlaydi"""
    now = get_uz_now()
    today_str = now.strftime("%Y-%m-%d")
    current_time_str = now.strftime("%H:%M")
    current_date_str = now.strftime("%d.%m.%Y")

    with get_db() as conn:
        cursor = conn.cursor()
        # 1. Hozir ishda bo'lganlar
        cursor.execute("""
            SELECT w.full_name, w.position, a.check_in_time, a.status
            FROM attendance a
            JOIN workers w ON a.worker_id = w.id
            WHERE a.status IN ('working', 'on_break')
            ORDER BY a.check_in_time ASC
        """)
        active_shifts = cursor.fetchall()

        # 2. Bugun ishga kelganlar
        cursor.execute("""
            SELECT DISTINCT worker_id 
            FROM attendance 
            WHERE check_in_time LIKE ?
        """, (f"{today_str}%",))
        checked_in_ids = {row[0] for row in cursor.fetchall()}

        # 3. Barcha faol ishchilar
        cursor.execute("""
            SELECT id, full_name, position 
            FROM workers 
            WHERE is_active = 1
            ORDER BY full_name ASC
        """)
        all_workers = cursor.fetchall()

    not_checked_in = [w for w in all_workers if w[0] not in checked_in_ids]

    text = f"📢 <b>{SHOP_NAME} — DAVOMAT VA ISH VAQTI MONITORINGI (6 SOATLIK XULOSA)</b>\n"
    text += f"⏰ Vaqt: <b>{current_time_str}</b> | Sana: <b>{current_date_str}</b>\n\n"

    # Hozir ishda bo'lganlar
    if active_shifts:
        text += f"🟢 <b>HOZIR ISHDA BO'LGANLAR ({len(active_shifts)} kishi):</b>\n"
        for i, (name, pos, in_time, st) in enumerate(active_shifts, 1):
            t_str = in_time[11:16] if len(in_time) >= 16 else in_time
            state_badge = " (☕️ tanaffusda)" if st == "on_break" else ""
            pos_badge = f" — {pos}" if pos else ""
            text += f"{i}. <b>{html.escape(name)}</b>{pos_badge} (kelgan: {t_str}{state_badge})\n"
    else:
        text += "🟢 <b>HOZIR ISHDA BO'LGANLAR:</b>\n<i>Hozircha smenada faol xodim yo'q</i>\n"

    text += "\n"

    # Bugun hali kelmaganlar
    if not_checked_in:
        text += f"🔴 <b>BUGUN HALI KELMAGANLAR / ISHDA BO'LMAGANLAR ({len(not_checked_in)} kishi):</b>\n"
        for i, (_, name, pos) in enumerate(not_checked_in, 1):
            pos_badge = f" — {pos}" if pos else ""
            text += f"{i}. {html.escape(name)}{pos_badge}\n"
    else:
        text += "🔴 <b>BUGUN KELMAGANLAR:</b>\n✅ <i>Barcha faol xodimlar bugun davomatdan o'tgan!</i>\n"

    text += "\n"
    text += "⚠️ <b>DIQQAT! ISH TARTIB-QOIDASI VA QAT'IY ESLATMA:</b>\n"
    text += "Hurmatli xodimlar!\n"
    text += "Do'konga kelganingizda darhol <b>«📍 ISHGA KELDIM»</b> va ishdan ketayotganingizda albatta <b>«🏃‍♂️ ISHDAN KETDIM»</b> tugmasini bosing!\n\n"
    text += "<i>Davomat avtomat tizimda daqiqama-daqiqa hisoblanadi. O'z vaqtida bosilmagan vaqt hisobga olinmasligi mumkin!</i>"

    return text

def send_six_hour_summary(force_manual=False):
    """6 soatlik xabarnomani guruhga va adminlarga yuboradi"""
    text = generate_six_hour_summary_text()

    recipients = set()
    for a in ADMIN_IDS:
        if a and a != "123456789" and re.match(r'^-?\d+$', str(a).strip()):
            recipients.add(str(a).strip())

    if GROUP_CHAT_ID and re.match(r'^-?\d+$', str(GROUP_CHAT_ID).strip()):
        recipients.add(str(GROUP_CHAT_ID).strip())

    sent_count = 0
    for chat_id in recipients:
        try:
            bot.send_message(chat_id, text, parse_mode="HTML")
            sent_count += 1
        except Exception as e:
            print(f"6 soatlik xabarni {chat_id} ga yuborishda xato: {e}")
    return sent_count

# --- CALLBACK QUERY HANDLER: 6 SOATLIK XULOSANI YUBORISH ---
@bot.callback_query_handler(func=lambda call: call.data == "send_6h_now")
def handle_callback_send_6h(call):
    tg_id = str(call.from_user.id)
    if not is_user_admin(tg_id):
        bot.answer_callback_query(call.id, "Faqat adminlar uchun!", show_alert=True)
        return

    bot.answer_callback_query(call.id, "Xabar yuborilmoqda...")
    sent = send_six_hour_summary(force_manual=True)
    bot.send_message(
        call.message.chat.id,
        f"✅ 6 soatlik davomat monitoringi va eslatma muvaffaqiyatli jo'natildi! ({sent} ta chatga)",
        parse_mode="HTML"
    )

# --- ADMIN BUYRUQ: /send6h yoki /monitoring ---
@bot.message_handler(commands=['send6h', 'monitoring', 'xulosa6h'])
def handle_manual_send_6h(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        bot.send_message(message.chat.id, "Kechirasiz, ushbu buyruq faqat Admin uchun!")
        return

    sent = send_six_hour_summary(force_manual=True)
    bot.send_message(
        message.chat.id,
        f"✅ <b>6 soatlik monitoring hisoboti guruh va botga yuborildi!</b>\nQabul qiluvchilar soni: {sent} ta",
        parse_mode="HTML"
    )

# --- ADMIN: KPI VA SAMARADORLIK REYTINGI ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "🏆 KPI Reyting", "/kpi", "/reyting"))
def handle_kpi_rating(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        bot.send_message(message.chat.id, "Kechirasiz, ushbu bo'lim faqat Admin uchun!")
        return

    now = get_uz_now()
    current_month_prefix = now.strftime("%Y-%m")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name, position FROM workers WHERE is_active = 1")
        workers = cursor.fetchall()

        cursor.execute("""
            SELECT worker_id, SUM(worked_minutes), COUNT(DISTINCT SUBSTR(check_in_time, 1, 10))
            FROM attendance
            WHERE status = 'completed' AND check_in_time LIKE ?
            GROUP BY worker_id
        """, (f"{current_month_prefix}%",))
        stats = {row[0]: (row[1] or 0, row[2] or 0) for row in cursor.fetchall()}

    leaderboard = []
    for w_id, name, pos in workers:
        mins, days = stats.get(w_id, (0, 0))
        hours = round(mins / 60, 1)
        leaderboard.append((name, pos or 'Xodim', hours, days, mins))

    leaderboard.sort(key=lambda x: x[4], reverse=True)

    text = f"🏆 <b>{SHOP_NAME} — ISHCHILARNING KPI VA ISH SOATI REYTINGI</b>\n"
    text += f"📅 Davr: <b>{current_month_prefix}</b>\n\n"

    if not leaderboard or leaderboard[0][4] == 0:
        text += "<i>Ushbu oyda hali ishlangan soatlar qayd etilmagan.</i>\n"
    else:
        for idx, (name, pos, hours, days, _) in enumerate(leaderboard[:10]):
            medal = "🥇" if idx == 0 else "🥈" if idx == 1 else "🥉" if idx == 2 else f"🔹 #{idx+1}"
            text += f"{medal} <b>{html.escape(name)}</b> ({html.escape(pos)})\n"
            text += f"   ⏱ <b>{hours} soat</b> ({days} kun ishlagan)\n\n"

    markup = types.InlineKeyboardMarkup()
    if WEBAPP_URL and WEBAPP_URL.startswith("http"):
        markup.add(types.InlineKeyboardButton("🏆 Batafsil KPI Portalini Ochish", web_app=types.WebAppInfo(url=WEBAPP_URL)))

    bot.send_message(message.chat.id, text, reply_markup=markup, parse_mode="HTML")

# --- FONDA HAR 6 SOATDA AVTOMATIK ISHLOVCHI TAYMER ---
last_daily_closing_key = ""

def check_and_trigger_daily_closing_report(today_str=None, force=False):
    global last_daily_closing_key
    now = get_uz_now()
    if not today_str:
        today_str = now.strftime("%Y-%m-%d")

    with get_db() as conn:
        cursor = conn.cursor()
        # 1. Hali ishlayotganlar bormi?
        cursor.execute("""
            SELECT COUNT(*) FROM attendance 
            WHERE check_in_time LIKE ? AND status IN ('working', 'on_break')
        """, (f"{today_str}%",))
        active_count = cursor.fetchone()[0] or 0
        if active_count > 0 and not force:
            return False

        # 2. Bugun tugatilgan smenalar
        cursor.execute("""
            SELECT a.worker_id, w.full_name, w.position, a.check_in_time, a.check_out_time, a.worked_minutes, a.total_break_minutes
            FROM attendance a
            JOIN workers w ON a.worker_id = w.id
            WHERE a.check_in_time LIKE ? AND a.status = 'completed'
            ORDER BY a.check_in_time ASC
        """, (f"{today_str}%",))
        completed_rows = cursor.fetchall()
        if not completed_rows:
            return False

        closing_key = f"{today_str}_{len(completed_rows)}"
        if not force and last_daily_closing_key == closing_key:
            return False

        cursor.execute("SELECT id, full_name, position FROM workers WHERE is_active = 1")
        all_workers = cursor.fetchall()

    worker_day_map = {}
    day_total_minutes = 0
    for w_id, w_name, w_pos, c_in, c_out, w_mins, t_break in completed_rows:
        day_total_minutes += (w_mins or 0)
        if w_id not in worker_day_map:
            worker_day_map[w_id] = {
                "name": w_name,
                "pos": w_pos or "Xodim",
                "first_in": c_in,
                "last_out": c_out or "",
                "total_mins": w_mins or 0,
                "total_break": t_break or 0
            }
        else:
            cur = worker_day_map[w_id]
            cur["total_mins"] += (w_mins or 0)
            cur["total_break"] += (t_break or 0)
            if c_out and c_out > cur["last_out"]:
                cur["last_out"] = c_out

    completed_ids = set(worker_day_map.keys())
    not_attended = [w for w in all_workers if w[0] not in completed_ids]

    day_total_hours = round(day_total_minutes / 60, 1)
    time_str = now.strftime("%H:%M")

    text = f"🏁 <b>{SHOP_NAME} — KUNLIK YAKUNIY DAVOMAT HISOBOTI</b>\n"
    text += f"✅ <b>BARCHA ISHCHILAR ISHINI TO'LIQ YAKUNLADI!</b>\n\n"
    text += f"📅 Sana: <b>{today_str}</b> | ⏰ Yopilgan vaqt: <b>{time_str}</b>\n"
    text += f"👥 Bugun ishlaganlar: <b>{len(worker_day_map)} nafar</b>\n"
    text += f"⏱ Bugungi jami mehnat: <b>{day_total_hours} soat</b> ({format_minutes(day_total_minutes)})\n\n"

    text += f"📋 <b>XODIMLARNING BUGUNGI ISH NATIJALARI:</b>\n"
    for idx, (w_id, data) in enumerate(worker_day_map.items(), 1):
        in_str = data["first_in"][11:16] if len(data["first_in"]) >= 16 else data["first_in"]
        out_str = data["last_out"][11:16] if len(data["last_out"]) >= 16 else (data["last_out"] or "Ketgan")
        worked_str = format_minutes(data["total_mins"])
        break_str = f" (☕️ {format_minutes(data['total_break'])} tanaffus)" if data["total_break"] > 0 else ""
        text += f"{idx}. 👤 <b>{html.escape(data['name'])}</b> ({html.escape(data['pos'])})\n"
        text += f"   🟢 Keldi: <b>{in_str}</b> | 🔴 Ketdi: <b>{out_str}</b>\n"
        text += f"   ⏱ Sof ishladi: <b>{worked_str}</b>{break_str} ✅\n\n"

    if not_attended:
        text += f"🔴 <b>BUGUN KELMAGANLAR ({len(not_attended)} kishi):</b>\n"
        for w in not_attended:
            text += f"• {html.escape(w[1])} ({html.escape(w[2] or 'Xodim')})\n"
        text += "\n"

    text += f"🔒 <i>Do'kondagi barcha smenalar to'liq yopildi. Hozirda faol ishchi yo'q. Bugungi ish kuni muvaffaqiyatli yakunlandi!</i>"

    last_daily_closing_key = closing_key
    notify_admin(text)
    return True

@bot.message_handler(func=lambda msg: is_cmd(msg, "🏁 Kunlik hisobot", "/kunyakun", "/bugunyakun", "/yopilish"))
def handle_closing_report_cmd(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        bot.send_message(message.chat.id, "Kechirasiz, ushbu buyruq faqat Admin uchun!")
        return

    now = get_uz_now()
    today_str = now.strftime("%Y-%m-%d")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT w.full_name, a.check_in_time FROM attendance a
            JOIN workers w ON a.worker_id = w.id
            WHERE a.check_in_time LIKE ? AND a.status IN ('working', 'on_break')
        """, (f"{today_str}%",))
        active_workers = cursor.fetchall()

    if active_workers:
        names = "\n".join([f"• <b>{html.escape(r[0])}</b> ({r[1][11:16]} da kelgan)" for r in active_workers])
        bot.send_message(
            message.chat.id,
            f"⚠️ <b>Kunlik yakuniy hisobot hali chiqarilmadi!</b>\n\n"
            f"Chunki do'konda hali smenasi davom etayotgan xodimlar bor ({len(active_workers)} kishi):\n"
            f"{names}\n\n"
            f"<i>Qoida: Kunlik yakuniy hisobot faqat BARCHA ishchilar ishni tugatib ketgandagina avtomatik guruhga yuboriladi.</i>",
            parse_mode="HTML"
        )
        return

    sent = check_and_trigger_daily_closing_report(today_str, force=True)
    if not sent:
        bot.send_message(message.chat.id, "Bugun hali tugallangan davomat yozuvlari qayd etilmagan.")

def six_hour_scheduler_loop():
    """
    O'zbekiston vaqti bilan har 6 soatda (soat 06:00, 12:00, 18:00, 00:00 da)
    avtomatik ravishda davomat monitoringi va eslatma yuboradi.
    Shuningdek, kechqurun barcha ishchilar ketgach kunlik yakuniy hisobotni tekshiradi.
    """
    last_triggered_slot = None
    print("[SCHEDULER] Har 6 soatlik avto-monitoring xizmati ishga tushdi...")
    while True:
        try:
            now = get_uz_now()
            # 6 soatlik belgilangan soatlar: 0, 6, 12, 18
            if now.hour in (0, 6, 12, 18) and now.minute == 0:
                slot_id = f"{now.strftime('%Y-%m-%d')}_{now.hour}"
                if last_triggered_slot != slot_id:
                    last_triggered_slot = slot_id
                    print(f"[{now.strftime('%H:%M:%S')}] 6 soatlik avtomatik xabar yuborilmoqda...")
                    send_six_hour_summary()

            # Kechki payt har 2 daqiqada barcha ishchilar ishni tugatganligini tekshirish
            if now.hour >= 18 and now.minute % 2 == 0:
                check_and_trigger_daily_closing_report()
        except Exception as e:
            print(f"[SCHEDULER ERROR] {e}")
        time.sleep(30) # Har 30 soniyada tekshiradi

# --- ADMIN: OYLIK HISOBOT ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "📊 Oylik umumiy hisobot", "/hisobot"))
def handle_admin_report(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        bot.send_message(message.chat.id, "Kechirasiz, ushbu bo'lim faqat Admin uchun!")
        return

    now = get_uz_now()
    current_month_prefix = now.strftime("%Y-%m")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name, phone FROM workers WHERE is_active = 1")
        workers = cursor.fetchall()

        if not workers:
            bot.send_message(message.chat.id, "Bazada hech qanday xodim mavjud emas.")
            return

        report_text = f"📋 <b>{SHOP_NAME} XODIMLARINING OYLIK HISOBOTI</b>\n"
        report_text += f"🗓 Oy: <b>{now.strftime('%m.%Y')}</b>\n"
        report_text += "━━━━━━━━━━━━━━━━━━━\n\n"

        total_store_minutes = 0

        for w in workers:
            w_id, name, phone = w
            name_esc = html.escape(name)
            cursor.execute("""
                SELECT worked_minutes, check_in_time FROM attendance
                WHERE worker_id = ? AND status = 'completed' AND check_in_time LIKE ?
            """, (w_id, f"{current_month_prefix}%"))
            shifts = cursor.fetchall()

            w_days = len(set(s[1][:10] for s in shifts))
            w_shifts_count = len(shifts)
            w_minutes = sum(s[0] for s in shifts)
            total_store_minutes += w_minutes
            w_hours_str = format_minutes(w_minutes)

            report_text += f"👤 <b>{name_esc}</b>\n"
            report_text += f"   • Kelgan kunlari: <b>{w_days} kun</b> ({w_shifts_count} ta smena)\n"
            report_text += f"   • Jami ishlagan vaqti: <b>{w_hours_str}</b> ({round(w_minutes/60, 1)} soat)\n\n"

        report_text += "━━━━━━━━━━━━━━━━━━━\n"
        report_text += f"🏪 <b>Do'kon bo'yicha jami:</b> <b>{format_minutes(total_store_minutes)}</b> ({round(total_store_minutes/60, 1)} soat)"

    bot.send_message(message.chat.id, report_text, parse_mode="HTML")

# --- ADMIN: ISHCHILAR RO'YXATI ---
@bot.message_handler(func=lambda msg: is_cmd(msg, "👥 Ishchilar ro'yxati", "/ishchilar"))
def handle_admin_workers(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        return

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, full_name, phone, telegram_id, position FROM workers ORDER BY id ASC")
        workers = cursor.fetchall()

    if not workers:
        bot.send_message(message.chat.id, "Bazada hech qanday ishchilar yo'q.")
        return

    text = f"👥 <b>Ro'yxatdan o'tgan ishchilar ({len(workers)} kishi):</b>\n\n"
    for w in workers:
        w_id, name, phone, tg_uid, pos = w
        name_esc = html.escape(name)
        status_tg = f"<code>{tg_uid}</code> (Ulangan)" if tg_uid else "<i>Ulanmagan</i>"
        text += f"🆔 {w_id}. <b>{name_esc}</b> ({pos or 'Xodim'})\n"
        text += f"   Tel: +{phone or 'Kiritilmagan'}\n"
        text += f"   Telegram: {status_tg}\n\n"

    bot.send_message(message.chat.id, text, parse_mode="HTML")

# --- ADMIN: YANGI ISHCHI QO'SHISH (/qoshish Ism Familiya 998901234567) ---
@bot.message_handler(commands=['qoshish'])
def handle_admin_add_worker(message):
    tg_id = str(message.from_user.id)
    if not is_user_admin(tg_id):
        return

    text_body = message.text.replace("/qoshish", "").strip()
    # Telefon raqamini matndan topish
    match = re.search(r'(\+?998[\d\s\-]{9,13}|\b9\d{8}\b)', text_body)

    if not match:
        bot.send_message(
            message.chat.id,
            "Noto'g'ri format! Quyidagicha yuboring:\n"
            "<code>/qoshish Ism Familiya 998901234567</code>\n\n"
            "Masalan:\n<code>/qoshish Alisher Valiyev 998901234567</code>",
            parse_mode="HTML"
        )
        return

    phone_raw = match.group(0)
    phone = clean_phone(phone_raw)
    name = text_body.replace(phone_raw, "").strip() or "Xodim"

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO workers (full_name, phone) VALUES (?, ?)", (name, phone))
        conn.commit()

    name_esc = html.escape(name)
    bot.send_message(
        message.chat.id,
        f"✅ <b>Yangi ishchi muvaffaqiyatli qo'shildi!</b>\n\n"
        f"👤 Ism: <b>{name_esc}</b>\n"
        f"📱 Telefon: +{phone}",
        parse_mode="HTML"
    )

# --- BUGUNGI DAVOMAT (/bugun) ---
@bot.message_handler(commands=['bugun'])
def handle_today_summary(message):
    tg_id = str(message.from_user.id)
    is_adm = is_user_admin(tg_id)
    now = get_uz_now()
    today_str = now.strftime("%Y-%m-%d")

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

            text = f"📅 <b>Bugungi kunlik davomat ({now.strftime('%d.%m.%Y')}):</b>\n\n"
            for r in rows:
                name, check_in, check_out, worked, status = r
                name_esc = html.escape(name)
                in_t = check_in[11:16] if check_in else "--:--"
                if status == 'on_break':
                    out_t = "☕️ Tanaffusda"
                elif status == 'working':
                    out_t = "🟢 Hozir ishda"
                else:
                    out_t = check_out[11:16] if check_out else "Ketgan"
                w_str = format_minutes(worked) if worked else "Davom etmoqda"
                text += f"👤 <b>{name_esc}</b>\n   Keldi: {in_t} | Ketdi: {out_t} ({w_str})\n\n"
            bot.send_message(message.chat.id, text, parse_mode="HTML")
        else:
            cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
            w = cursor.fetchone()
            if not w:
                bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting (/start).")
                return

            cursor.execute("""
                SELECT check_in_time, check_out_time, worked_minutes, status
                FROM attendance
                WHERE worker_id = ? AND check_in_time LIKE ?
                ORDER BY id ASC
            """, (w[0], f"{today_str}%"))
            rows = cursor.fetchall()

            if not rows:
                bot.send_message(message.chat.id, f"📅 Bugun ({now.strftime('%d.%m.%Y')}) hali ishga kelmadingiz.")
                return

            text = f"📅 <b>Sizning bugungi davomatingiz ({now.strftime('%d.%m.%Y')}):</b>\n\n"
            total_m = 0
            for r in rows:
                in_t = r[0][11:16] if r[0] else "--:--"
                if r[3] == 'on_break':
                    out_t = "☕️ Tanaffusda"
                elif r[3] == 'working':
                    out_t = "🟢 Hozir ishda"
                else:
                    out_t = r[1][11:16] if r[1] else "Ketgan"
                m = r[2] or 0
                total_m += m
                text += f"• {in_t} ➡️ {out_t} ({format_minutes(m) if m else 'davom etmoqda'})\n"

            text += f"\n📊 <b>Bugun jami:</b> <b>{format_minutes(total_m)}</b>"
            bot.send_message(message.chat.id, text, parse_mode="HTML")

# --- SANALAR ORALIG'I HISOBOTI (/oraliq 01.09.2026 15.10.2026) ---
@bot.message_handler(commands=['oraliq', 'davr', 'range'])
def handle_date_range_report(message):
    tg_id = str(message.from_user.id)
    text_body = message.text.replace("/oraliq", "").replace("/davr", "").replace("/range", "").strip()
    
    dates = re.findall(r'(\d{2}[./]\d{2}[./]\d{4}|\d{4}[./]\d{2}[./]\d{2})', text_body)
    now = get_uz_now()
    
    if len(dates) >= 2:
        start_str_raw, end_str_raw = dates[0], dates[1]
    elif len(dates) == 1:
        start_str_raw = dates[0]
        end_str_raw = now.strftime("%d.%m.%Y")
    else:
        # Default: o'tgan oyning 1-chi sanasidan bugungacha
        first_last_month = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
        start_str_raw = first_last_month.strftime("%d.%m.%Y")
        end_str_raw = now.strftime("%d.%m.%Y")
        
    def parse_to_iso(d_str):
        for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(d_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None

    start_iso = parse_to_iso(start_str_raw)
    end_iso = parse_to_iso(end_str_raw)
    
    if not start_iso or not end_iso:
        bot.reply_to(message, "❌ Sana formati noto'g'ri! Misol:\n<code>/oraliq 01.09.2026 15.10.2026</code>", parse_mode="HTML")
        return
        
    if start_iso > end_iso:
        start_iso, end_iso = end_iso, start_iso

    is_adm = is_user_admin(tg_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        if is_adm:
            cursor.execute("SELECT id, full_name, position FROM workers WHERE is_active = 1")
            workers = cursor.fetchall()
            
            cursor.execute("""
                SELECT worker_id, check_in_time, check_out_time, worked_minutes
                FROM attendance
                WHERE status = 'completed' AND SUBSTR(check_in_time, 1, 10) >= ? AND SUBSTR(check_in_time, 1, 10) <= ?
            """, (start_iso, end_iso))
            rows = cursor.fetchall()
            
            report = f"📊 <b>SANALAR ORALIG'I HISOBOTI</b>\n" \
                     f"📅 Davr: <b>{start_iso} dan {end_iso} gacha</b>\n" \
                     f"━━━━━━━━━━━━━━━━━━━\n\n"
            
            total_store_mins = 0
            worker_stats = {}
            for r in rows:
                w_id, c_in, c_out, w_mins = r
                if w_id not in worker_stats:
                    worker_stats[w_id] = {"mins": 0, "days": set(), "shifts": 0}
                worker_stats[w_id]["mins"] += (w_mins or 0)
                worker_stats[w_id]["shifts"] += 1
                worker_stats[w_id]["days"].add(c_in[:10])
                total_store_mins += (w_mins or 0)
                
            for w_id, name, pos in workers:
                st = worker_stats.get(w_id, {"mins": 0, "days": set(), "shifts": 0})
                mins = st["mins"]
                days = len(st["days"])
                shifts_count = st["shifts"]
                report += f"👤 <b>{html.escape(name)}</b> ({html.escape(pos or 'Xodim')})\n" \
                          f"   • Ishlagan kunlari: <b>{days} kun</b> ({shifts_count} ta smena)\n" \
                          f"   • Jami ishlagan vaqti: <b>{format_minutes(mins)}</b> ({round(mins/60, 1)} soat)\n\n"
                          
            report += f"━━━━━━━━━━━━━━━━━━━\n" \
                      f"🏪 <b>Jami do'kon bo'yicha:</b> <b>{format_minutes(total_store_mins)}</b> ({round(total_store_mins/60, 1)} soat)"
            bot.send_message(message.chat.id, report, parse_mode="HTML")
        else:
            cursor.execute("SELECT id, full_name FROM workers WHERE telegram_id = ?", (tg_id,))
            w = cursor.fetchone()
            if not w:
                bot.send_message(message.chat.id, "Iltimos, avval ro'yxatdan o'ting (/start).")
                return
            w_id, w_name = w[0], w[1]
            cursor.execute("""
                SELECT check_in_time, check_out_time, worked_minutes
                FROM attendance
                WHERE worker_id = ? AND status = 'completed' AND SUBSTR(check_in_time, 1, 10) >= ? AND SUBSTR(check_in_time, 1, 10) <= ?
                ORDER BY id DESC
            """, (w_id, start_iso, end_iso))
            rows = cursor.fetchall()
            total_mins = sum(r[2] for r in rows) if rows else 0
            unique_days = len(set(r[0][:10] for r in rows)) if rows else 0
            
            report = f"📊 <b>{html.escape(w_name)} ning hisoboti:</b>\n" \
                     f"📅 Davr: <b>{start_iso} — {end_iso}</b>\n\n" \
                     f"📅 Kelgan kunlar: <b>{unique_days} kun</b> ({len(rows)} ta smena)\n" \
                     f"⏱ <b>JAMI ISHLANGAN VAQT:</b> <b>{format_minutes(total_mins)}</b> ({round(total_mins/60, 1)} soat)\n\n"
            if rows:
                report += "Smenalar:\n"
                for r in rows[:10]:
                    report += f"• {r[0][5:16]} ➡️ {r[1][5:16] if r[1] else '---'} ({format_minutes(r[2])})\n"
            bot.send_message(message.chat.id, report, parse_mode="HTML")

# --- MINI APP BUYRUG'I (/app, /webapp) ---
@bot.message_handler(commands=['app', 'webapp', 'portal'])
def handle_app_command(message):
    if WEBAPP_URL and WEBAPP_URL.startswith("http"):
        markup = types.InlineKeyboardMarkup()
        btn = types.InlineKeyboardButton("📱 Navo Market Portali", web_app=types.WebAppInfo(url=WEBAPP_URL))
        markup.add(btn)
        bot.send_message(
            message.chat.id,
            f"🏪 <b>{SHOP_NAME}</b> ishchi va davomat portalini ochish uchun quyidagi tugmani bosing:",
            reply_markup=markup,
            parse_mode="HTML"
        )
    else:
        bot.send_message(message.chat.id, "Mini App manzili hali o'rnatilmagan.")

# --- YORDAM (/help, /yordam) ---
@bot.message_handler(commands=['help', 'yordam'])
def handle_help(message):
    tg_id = str(message.from_user.id)
    is_adm = is_user_admin(tg_id)

    text = f"ℹ️ <b>{SHOP_NAME} Boti Buyruqlari:</b>\n\n"
    text += "📍 <b>Ishga keldim</b> — Ish boshlanganini qayd etadi\n"
    text += "🏃‍♂️ <b>Ishdan ketdim</b> — Ishni yakunlaydi va vaqtni hisoblaydi\n"
    text += "☕️ <b>Tanaffusga chiqish</b> — Tanaffus vaqtini boshlaydi\n"
    text += "▶️ <b>Tanaffusdan qaytish</b> — Tanaffusni yakunlaydi\n"
    text += "⏱ <b>Mening soatlarim</b> — Oylik ishlangan soatlaringiz hisoboti\n"
    text += "📅 <b>/oraliq 01.09.2026 15.10.2026</b> — Sanalar oralig'ida ishlangan vaqt hisoboti\n"
    text += "📅 <b>/bugun</b> — Bugungi smenalaringiz\n"
    text += "📱 <b>/app</b> — Veb Mini Appni ochish\n"

    if is_adm:
        text += "\n👑 <b>Admin buyruqlari:</b>\n"
        text += "🔴 <b>/live</b> — Hozir ishda kim borligini ko'rish\n"
        text += "🔔 <b>/eslatma</b> — Ketishni unutganlar va eslatmalar\n"
        text += "📢 <b>/send6h</b> — 6 soatlik davomat monitoringini guruhga yuborish\n"
        text += "📊 <b>/hisobot</b> — Barcha xodimlarning oylik hisoboti\n"
        text += "👥 <b>/ishchilar</b> — Ro'yxatdan o'tgan barcha ishchilar\n"
        text += "➕ <b>/qoshish Ism Telefon</b> — Yangi ishchi qo'shish\n"

    bot.send_message(message.chat.id, text, parse_mode="HTML")

if __name__ == "__main__":
    print("==================================================")
    print(f"{SHOP_NAME} Ishchilar Boti ishga tushirildi...")
    print(f"O'zbekiston vaqti: {get_uz_now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("==================================================")
    # 6 soatlik fon monitoringini alohida potokda ishga tushirish
    threading.Thread(target=six_hour_scheduler_loop, daemon=True).start()
    bot.infinity_polling()

