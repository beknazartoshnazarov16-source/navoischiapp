# 🏪 Navo Market Ishchilar Boshqaruv Tizimi (Web App)

Navo Market xodimlarini boshqarish, kunlik davomatni qayd etish, GPS orqali do'konda ekanligini tekshirish, kechikishlar va jarimalarni hisoblash, oylik/kunlik/soatbay maoshlarni avtomatlashtirish, tanaffuslarni nazorat qilish hamda professional **Excel (CSV) hisobotlar** shakllantirish uchun mo'ljallangan zamonaviy veb-platforma.

---

## 🌟 Asosiy Imkoniyatlar

### 👷‍♂️ 1. Ishchi Portali (Worker Portal)
- **📍 Ishga keldim (Check-in)**:
  - Do'kon geolokatsiyasi (GPS / Haversine) orqali masofani tekshirish (50m radius).
  - Kelgan vaqtni qayd etish, ish vaqtidan (08:00) kech qolsa, daqiqalarini va jarimani hisoblash.
- **🏃‍♂️ Ishdan ketdim (Check-out)**:
  - Ishdan ketish vaqtini belgilash, sof ishlangan soatlar va qo'shimcha ish vaqtini (overtime) hisoblash.
- **☕️ Tanaffus nazorati**:
  - Tanaffusga chiqish va qaytish vaqtini avtomatik hisoblash.
- **📅 Davomatim**:
  - Bugungi, joriy oy va o'tgan oylik davomat tarixi va qatnashgan kunlar statistikasi.
- **💰 Oylik hisob-kitob (Ish haqi)**:
  - Asosiy hisoblangan maosh, overtime mukofotlari, bonuslar, jarimalar va olingan avanslar bo'yicha sof kutilayotgan oylik maoshni ko'rish.
- **📝 Arizalar**:
  - Ta'til / javob so'rash, avans so'rovi yoki kechikish sababi bo'yicha tushuntirish xatini yuborish.
- **👤 Shaxsiy Profil**:
  - Lavozim, stavka turi, telefon raqam va shaxsiy ma'lumotlar.

---

### 👑 2. Admin & Direktor Paneli (Admin Portal)
- **👥 Ishchilarni Boshqarish (CRUD)**:
  - Yangi ishchi qo'shish (Ism-familiya, Telefon, Lavozim, Oylik/Kunlik/Soatbay stavka).
  - Ishchilarni ko'rish, tahrirlash, o'chirish yoki bloklash.
  - Ishchiga to'g'ridan-to'g'ri **Bonus**, **Jarima** yoki **Avans** biriktirish.
- **📊 Jonli Davomat (Live Monitoring)**:
  - Bugun kim ishda (kelgan vaqti bilan).
  - Kim tanaffusda.
  - Kim ishni yakunladi.
  - Kimlar hali kelmadi (telefon raqami bilan).
  - Kechikkanlar ro'yxati va daqiqalari.
- **💵 Ish Haqi Hisob-kitobi (Payroll)**:
  - Barcha ishchilarning ishlagan kun/soatlari, bonus va jarimalari asosida umumiy oylik xarajatini avtomatik hisoblash.
- **🔔 Arizalar Boshqaruvi**:
  - Xodimlardan kelgan avans va ta'til so'rovlarini ko'rib chiqish, 1 ta tugma orqali tasdiqlash yoki rad etish.
- **📑 Excel / CSV Hisobotlar**:
  - 📅 **Bugungi kunlik davomat jadvali**: barcha xodimlarning kelgan-ketgan vaqti va holatlari.
  - 📈 **Oylik to'liq hisobot**: Har bir xodimning ishlagan kunlari, soatlari, kechikishlari, asosiy oyligi, bonus/jarimalari va to'lanadigan sof summasi.
- **📢 Ommaviy E'lon (Broadcast)**:
  - Barcha faol xodimlarga muhim e'lon va yangiliklarni yuborish.
- **⚙️ Tizim Sozlamalari**:
  - Ish boshlanish va tugash vaqtlari (masalan: 08:00 - 18:00).
  - Ruxsat etilgan kechikish daqiqasi (Grace period, masalan: 10 daqiqa).
  - Kechikish jarima stavkasi va Overtime soatlik bonus stavkasi.
  - Do'kon geolokatsiyasi va ruxsat etilgan GPS radius (metrlarda).
  - GPS tekshiruvini yoqish / o'chirish.

---

## 🛠 Texnologiyalar
- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide React icons, Motion animations.
- **Build Tool**: Vite.
- **Port**: 3000 (0.0.0.0).
