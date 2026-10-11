import React, { useState } from 'react';
import { User } from '../types';
import {
  UserPlus,
  Edit2,
  Trash2,
  Phone,
  Clock,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  KeyRound,
} from 'lucide-react';

interface WorkersManagerProps {
  users: User[];
  onAddUser: (user: Omit<User, 'id'>) => void;
  onUpdateUser: (user: User) => void;
  onDeleteUser: (userId: number) => void;
}

export function WorkersManager({
  users,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
}: WorkersManagerProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Yangi ishchi formasi
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '+998',
    position: 'Sotuvchi',
    work_start_time: '08:00',
    work_end_time: '20:00',
    telegram_id: '',
    pin: '',
  });

  const workers = users.filter((u) => u.role === 'worker');

  const handleOpenAdd = () => {
    setFormData({
      full_name: '',
      phone: '+998',
      position: 'Sotuvchi',
      work_start_time: '08:00',
      work_end_time: '20:00',
      telegram_id: '',
      pin: '',
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      full_name: user.full_name,
      phone: user.phone || '+998',
      position: user.position || 'Ishchi',
      work_start_time: user.work_start_time || '08:00',
      work_end_time: user.work_end_time || '20:00',
      telegram_id: user.telegram_id ? String(user.telegram_id) : '',
      pin: user.pin || '',
    });
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name.trim()) return;

    onAddUser({
      full_name: formData.full_name.trim(),
      phone: formData.phone.trim(),
      role: 'worker',
      position: formData.position.trim(),
      work_start_time: formData.work_start_time,
      work_end_time: formData.work_end_time,
      telegram_id: formData.telegram_id.trim() || undefined,
      pin: formData.pin.trim() || undefined,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    setIsAddModalOpen(false);
  };

  const handleSubmitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !formData.full_name.trim()) return;

    onUpdateUser({
      ...editingUser,
      full_name: formData.full_name.trim(),
      phone: formData.phone.trim(),
      position: formData.position.trim(),
      work_start_time: formData.work_start_time,
      work_end_time: formData.work_end_time,
      telegram_id: formData.telegram_id.trim() || undefined,
      pin: formData.pin.trim() || undefined,
    });

    setEditingUser(null);
  };

  return (
    <div className="space-y-6">
      {/* Yuqori qism: Sarlavha va Qo'shish tugmasi */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Ishchilar Ro'yxati</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Do'kon ishchilarini qo'shish, ma'lumotlarini tahrirlash va o'chirish
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition shadow-xs"
        >
          <UserPlus className="w-4 h-4" />
          <span>Yangi ishchi qo'shish</span>
        </button>
      </div>

      {/* Ishchilar jadvali / Ro'yxati */}
      {workers.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserPlus className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">
            Hozircha ishchilar qo'shilmagan
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            Barcha soxta sinov ishchilari o'chirib tashlangan. O'zingizning haqiqiy ishchilaringizni qo'shish uchun quyidagi tugmani bosing.
          </p>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>Birinchi ishchini qo'shish</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map((worker) => (
            <div
              key={worker.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">
                      {worker.full_name}
                    </h3>
                    <span className="inline-block text-xs font-medium px-2 py-0.5 mt-1 rounded-md bg-slate-100 text-slate-700">
                      {worker.position || 'Ishchi'}
                    </span>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      worker.is_active
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {worker.is_active ? 'Faol' : 'Nofaol'}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{worker.phone || 'Telefon kiritilmagan'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Standart smena: {worker.work_start_time} — {worker.work_end_time}
                    </span>
                  </div>
                  {worker.telegram_id && (
                    <div className="flex items-center gap-2">
                      <Send className="w-3.5 h-3.5 text-sky-500" />
                      <span>TG ID: {worker.telegram_id}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-100 text-slate-500">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      PIN: <span className="font-mono text-slate-400 tracking-widest">••••</span> (Maxfiy)
                    </span>
                  </div>
                </div>
              </div>

              {/* Boshqaruv tugmalari */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => handleOpenEdit(worker)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition"
                >
                  <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Tahrirlash</span>
                </button>

                {deleteConfirmId === worker.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        onDeleteUser(worker.id);
                        setDeleteConfirmId(null);
                      }}
                      className="px-2.5 py-1 text-xs font-semibold bg-rose-600 text-white rounded-md hover:bg-rose-700 transition"
                    >
                      Ha, o'chirish
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-md"
                    >
                      Bekor
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(worker.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>O'chirish</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ishchi Qo'shish Modali */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-4">
              Yangi ishchi qo'shish
            </h2>
            <form onSubmit={handleSubmitAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ism va Familiya *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Sardor Aliyev"
                  value={formData.full_name}
                  onChange={(e) =>
                    setFormData({ ...formData, full_name: e.target.value })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefon raqam
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lavozimi
                  </label>
                  <input
                    type="text"
                    value={formData.position}
                    onChange={(e) =>
                      setFormData({ ...formData, position: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ish boshlash vaqti
                  </label>
                  <input
                    type="time"
                    value={formData.work_start_time}
                    onChange={(e) =>
                      setFormData({ ...formData, work_start_time: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ish tugash vaqti
                  </label>
                  <input
                    type="time"
                    value={formData.work_end_time}
                    onChange={(e) =>
                      setFormData({ ...formData, work_end_time: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Telegram Username yoki ID (ixtiyoriy)
                </label>
                <input
                  type="text"
                  placeholder="@foydalanuvchi yoki 12345678"
                  value={formData.telegram_id}
                  onChange={(e) =>
                    setFormData({ ...formData, telegram_id: e.target.value })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Shaxsiy 4 xonali PIN-kod (ixtiyoriy)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="4 xonali maxfiy kod"
                  value={formData.pin}
                  onChange={(e) =>
                    setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Ishchi o'z profiliga kirishi uchun foydalaniladi.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition font-medium"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition"
                >
                  Qo'shish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ishchini Tahrirlash Modali */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-4">
              Ishchi ma'lumotlarini tahrirlash
            </h2>
            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ism va Familiya *
                </label>
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={(e) =>
                    setFormData({ ...formData, full_name: e.target.value })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefon raqam
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lavozimi
                  </label>
                  <input
                    type="text"
                    value={formData.position}
                    onChange={(e) =>
                      setFormData({ ...formData, position: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ish boshlash vaqti
                  </label>
                  <input
                    type="time"
                    value={formData.work_start_time}
                    onChange={(e) =>
                      setFormData({ ...formData, work_start_time: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ish tugash vaqti
                  </label>
                  <input
                    type="time"
                    value={formData.work_end_time}
                    onChange={(e) =>
                      setFormData({ ...formData, work_end_time: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Telegram Username yoki ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="@username yoki ID"
                    value={formData.telegram_id}
                    onChange={(e) =>
                      setFormData({ ...formData, telegram_id: e.target.value })
                    }
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  {formData.telegram_id && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, telegram_id: '' })}
                      className="px-3 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 transition shrink-0"
                      title="Telegram ID ni o'chirish"
                    >
                      Uzish
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Shaxsiy 4 xonali PIN-kod
                </label>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Yangi maxfiy PIN-kod"
                  value={formData.pin}
                  onChange={(e) =>
                    setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Ishchi o'z profiliga kirishi uchun PIN-kod.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition font-medium"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition"
                >
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
