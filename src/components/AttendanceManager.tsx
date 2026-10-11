import React, { useState } from 'react';
import { Attendance, User } from '../types';
import {
  calculateShiftWorkedMinutes,
  calculateLateMinutes,
  getAccurateAttendanceMinutes,
  formatMinutesToHours,
  formatUzDate,
  getLocalDateString,
} from '../utils/calculations';
import {
  Clock,
  PlusCircle,
  Edit2,
  Trash2,
  Calendar,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface AttendanceManagerProps {
  users: User[];
  attendances: Attendance[];
  onAddAttendance: (att: Omit<Attendance, 'id'>) => void;
  onUpdateAttendance: (att: Attendance) => void;
  onDeleteAttendance: (id: number) => void;
}

export function AttendanceManager({
  users,
  attendances,
  onAddAttendance,
  onUpdateAttendance,
  onDeleteAttendance,
}: AttendanceManagerProps) {
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [statusTab, setStatusTab] = useState<'all' | 'today' | 'open'>('all');
  
  // Qo'lda kiritish modali
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Attendance | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const todayStr = getLocalDateString(new Date());

  const workers = users.filter((u) => u.role === 'worker');
  const selectableUsers = workers.length > 0 ? workers : users;

  // Eski yopilmagan smenalar (xodim ketishni bosishni unutgan)
  const unclosedOldShifts = attendances.filter(
    (a) => (a.status === 'working' || a.status === 'on_break') && a.date < todayStr
  );

  // Forma ma'lumotlari
  const [formState, setFormState] = useState({
    user_id: selectableUsers[0]?.id || 0,
    check_in_date: todayStr,
    check_in_time: '08:00',
    check_out_date: todayStr,
    check_out_time: '20:00',
    total_break_minutes: 0,
    note: '',
  });

  const handleOpenAdd = () => {
    setFormState({
      user_id: selectableUsers[0]?.id || 0,
      check_in_date: todayStr,
      check_in_time: '08:00',
      check_out_date: todayStr,
      check_out_time: '20:00',
      total_break_minutes: 0,
      note: 'Admin tomonidan kiritildi',
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (item: Attendance) => {
    setEditingItem(item);
    setFormState({
      user_id: item.user_id,
      check_in_date: item.date,
      check_in_time: item.check_in_time ? item.check_in_time.slice(0, 5) : '08:00',
      check_out_date: item.check_out_date || item.date,
      check_out_time: item.check_out_time ? item.check_out_time.slice(0, 5) : '20:00',
      total_break_minutes: item.total_break_minutes || 0,
      note: item.note || '',
    });
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.user_id) return;

    let cleanOutDate = formState.check_out_date || formState.check_in_date;
    if (cleanOutDate < formState.check_in_date) {
      cleanOutDate = formState.check_in_date;
    }

    const workedMins = calculateShiftWorkedMinutes(
      formState.check_in_date,
      formState.check_in_time,
      cleanOutDate,
      formState.check_out_time,
      formState.total_break_minutes
    );

    onAddAttendance({
      user_id: Number(formState.user_id),
      date: formState.check_in_date,
      check_in_time: formState.check_in_time,
      check_out_date: cleanOutDate,
      check_out_time: formState.check_out_time,
      total_break_minutes: Number(formState.total_break_minutes) || 0,
      worked_minutes: workedMins,
      status: 'completed',
      note: formState.note || undefined,
      created_at: new Date().toISOString(),
    });

    setIsAddModalOpen(false);
  };

  const handleSubmitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    let cleanOutDate = formState.check_out_date || formState.check_in_date;
    if (cleanOutDate < formState.check_in_date) {
      cleanOutDate = formState.check_in_date;
    }

    const workedMins = calculateShiftWorkedMinutes(
      formState.check_in_date,
      formState.check_in_time,
      cleanOutDate,
      formState.check_out_time,
      formState.total_break_minutes
    );

    onUpdateAttendance({
      ...editingItem,
      user_id: Number(formState.user_id),
      date: formState.check_in_date,
      check_in_time: formState.check_in_time,
      check_out_date: cleanOutDate,
      check_out_time: formState.check_out_time,
      total_break_minutes: Number(formState.total_break_minutes) || 0,
      worked_minutes: workedMins,
      status: 'completed',
      note: formState.note || undefined,
    });

    setEditingItem(null);
  };

  // Bugungi yozuvlar soni
  const todayAttendancesCount = attendances.filter(
    (a) =>
      a.date === todayStr ||
      a.check_out_date === todayStr ||
      a.status === 'working' ||
      a.status === 'on_break'
  ).length;

  const currentlyWorkingCount = attendances.filter(
    (a) => a.status === 'working' || a.status === 'on_break'
  ).length;

  // Filtrlar
  const filteredAttendances = attendances.filter((att) => {
    if (selectedWorkerId !== 'all' && att.user_id !== Number(selectedWorkerId)) {
      return false;
    }
    if (
      selectedDate &&
      att.date !== selectedDate &&
      att.check_out_date !== selectedDate
    ) {
      return false;
    }
    if (statusTab === 'today') {
      const isTodayRecord =
        att.date === todayStr ||
        att.check_out_date === todayStr ||
        att.status === 'working' ||
        att.status === 'on_break';
      if (!isTodayRecord) return false;
    }
    if (statusTab === 'open' && att.status !== 'working' && att.status !== 'on_break') {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Sarlavha va Yangi qo'shish */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Davomat va Vaqtlar Jurnali
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Barcha keldi-ketdi vaqtlari, tahrirlash va qo'lda kiritish
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          disabled={workers.length === 0}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition shadow-xs"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Yangi yozuv kiritish</span>
        </button>
      </div>

      {/* Unutilgan / Yopilmagan smenalar eslatmasi */}
      {unclosedOldShifts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-amber-800">
            <span className="font-bold">Eslatma:</span> {unclosedOldShifts.length} ta yopilmagan eski smena mavjud (Ishchi o'tgan kunlarda ketishni bosishni unutgan bo'lishi mumkin).
            Ularni jadvalda «Smenani yopish» orqali to'g'rilab qo'yishingiz mumkin.
            <button
              onClick={() => setStatusTab('open')}
              className="ml-2 underline font-semibold text-amber-900 hover:text-amber-950"
            >
              Yopilmagan smenalarni ko'rish &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Filtrlash paneli va Tablar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Holat tablari */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setStatusTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusTab === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Barchasi ({attendances.length})
            </button>
            <button
              onClick={() => setStatusTab('today')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusTab === 'today'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bugun ({todayAttendancesCount})
            </button>
            <button
              onClick={() => setStatusTab('open')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusTab === 'open'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hozir ishda ({currentlyWorkingCount})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 min-w-[200px]">
              <UserCheck className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                aria-label="Ishchini tanlash"
                value={selectedWorkerId}
                onChange={(e) => setSelectedWorkerId(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">Barcha ishchilar</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 min-w-[150px]">
              <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="date"
                aria-label="Sanani tanlash"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate('')}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Tozalash
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ro'yxat / Jadval */}
      {filteredAttendances.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center shadow-xs">
          <Clock className="w-10 h-10 sm:w-12 sm:h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800 mb-1">
            Davomat yozuvlari topilmadi
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            Ishchi Telegram bot orqali yoki «Ishchi ekrani» orqali «📍 Ishga keldim» tugmasini bosganda yoki Admin qo'lda kiritganda bu yerda paydo bo'ladi.
          </p>
          {workers.length > 0 && (
            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Qo'lda davomat yozuvi kiritish</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Mobil telefonlar uchun qulay kartalar (md:hidden) */}
          <div className="md:hidden space-y-2.5">
            {filteredAttendances.map((item) => {
              const worker = users.find((u) => u.id === item.user_id);
              const isNightShift =
                item.check_out_date &&
                item.check_out_date !== item.date;

              const sameDayShifts = attendances
                .filter((a) => a.user_id === item.user_id && a.date === item.date)
                .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
              const shiftIdx = sameDayShifts.findIndex((a) => a.id === item.id) + 1;
              const hasMultiple = sameDayShifts.length > 1;

              return (
                <div
                  key={`mobile-${item.id}`}
                  className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 text-sm truncate">
                        {worker?.full_name || `Xodim #${item.user_id}`}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {worker?.position || 'Xodim'} • {formatUzDate(item.date)}
                      </div>
                    </div>
                    {item.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        Yakunlangan
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
                        <Clock className="w-3 h-3" />
                        Ishda
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Kelgan:</span>
                      <span className="font-semibold text-emerald-700 flex items-center gap-1 flex-wrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                        <span>{item.check_in_time || '---'}</span>
                        {hasMultiple && (
                          <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded">
                            {shiftIdx}-smena
                          </span>
                        )}
                        {(() => {
                          if (shiftIdx > 1) {
                            return null;
                          }
                          const lateMins = calculateLateMinutes(
                            item.check_in_time ? item.check_in_time.slice(0, 5) : '',
                            worker?.work_start_time || '08:00'
                          );
                          if (lateMins > 0) {
                            return (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-100/80 px-1 py-0.5 rounded">
                                +{lateMins}m
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Ketgan:</span>
                      {item.status === 'working' ? (
                        <span className="text-amber-600 font-semibold text-[11px] animate-pulse">
                          Hozir ishda
                        </span>
                      ) : (
                        <span className="font-semibold text-rose-700 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          {item.check_out_time || '---'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs">
                    <div className="font-extrabold text-[#008f45]">
                      {item.status === 'completed' ? (
                        <span>Vaqt: {formatMinutesToHours(getAccurateAttendanceMinutes(item))}</span>
                      ) : (
                        <span className="text-slate-400 font-normal italic">Hisoblanmoqda...</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEdit(item)}
                        className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                        title="Tahrirlash"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {deleteConfirmId === item.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              onDeleteAttendance(item.id);
                              setDeleteConfirmId(null);
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold bg-rose-600 text-white rounded hover:bg-rose-700 transition cursor-pointer"
                          >
                            Ha
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                          >
                            Yo'q
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(item.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          title="O'chirish"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop va Planshetlar uchun to'liq jadval (hidden md:block) */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Ishchi</th>
                    <th className="py-3 px-4">Kelgan vaqti</th>
                    <th className="py-3 px-4">Ketgan vaqti</th>
                    <th className="py-3 px-4">Ishlagan vaqti</th>
                    <th className="py-3 px-4">Holati</th>
                    <th className="py-3 px-4 text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {filteredAttendances.map((item) => {
                    const worker = users.find((u) => u.id === item.user_id);
                    const isNightShift =
                      item.check_out_date &&
                      item.check_out_date !== item.date;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <div>{worker?.full_name || `Xodim #${item.user_id}`}</div>
                          <div className="text-[11px] text-slate-400 font-normal">
                            {worker?.position}
                          </div>
                        </td>

                        {/* Kelgan vaqti */}
                        <td className="py-3 px-4">
                          {(() => {
                            const sameDayShifts = attendances
                              .filter((a) => a.user_id === item.user_id && a.date === item.date)
                              .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
                            const shiftIdx = sameDayShifts.findIndex((a) => a.id === item.id) + 1;
                            const hasMultiple = sameDayShifts.length > 1;

                            return (
                              <div>
                                <div className="font-semibold text-emerald-700 flex items-center gap-1.5 flex-wrap">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                                  <span>{item.check_in_time || '---'}</span>
                                  {hasMultiple && (
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                                      {shiftIdx}-smena
                                    </span>
                                  )}
                                  {(() => {
                                    if (shiftIdx > 1) {
                                      return null;
                                    }
                                    const lateMins = calculateLateMinutes(
                                      item.check_in_time ? item.check_in_time.slice(0, 5) : '',
                                      worker?.work_start_time || '08:00'
                                    );
                                    if (lateMins > 0) {
                                      return (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold text-[10px] border border-amber-200">
                                          +{lateMins} daq kechikkan
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {formatUzDate(item.date)}
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Ketgan vaqti */}
                        <td className="py-3 px-4">
                          {item.status === 'working' ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                              Hozir ishlamoqda
                            </span>
                          ) : (
                            <>
                              <div className="font-semibold text-rose-700 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                {item.check_out_time || '---'}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatUzDate(item.check_out_date || item.date)}
                                {isNightShift && (
                                  <span className="ml-1 px-1.5 py-0.2 rounded-sm bg-indigo-50 text-indigo-700 font-medium">
                                    Tungi (00:00 dan keyin)
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </td>

                        {/* Ishlagan vaqti */}
                        <td className="py-3 px-4">
                          {item.status === 'completed' ? (
                            (() => {
                              const accMins = getAccurateAttendanceMinutes(item);
                              return (
                                <div className="font-bold text-slate-900 text-sm">
                                  {formatMinutesToHours(accMins)}
                                  <span className="text-[11px] font-normal text-slate-500 block">
                                    ({Math.round((accMins / 60) * 10) / 10} soat)
                                  </span>
                                </div>
                              );
                            })()
                          ) : (
                            <span className="text-slate-400 italic">Hisoblanmoqda...</span>
                          )}
                        </td>

                        {/* Holati */}
                        <td className="py-3 px-4">
                          {item.status === 'completed' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3" />
                              Yakunlangan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
                              <Clock className="w-3 h-3" />
                              Ishda
                            </span>
                          )}
                        </td>

                        {/* Tahrirlash / O'chirish */}
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => handleOpenEdit(item)}
                              className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                              title="Tahrirlash"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {deleteConfirmId === item.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    onDeleteAttendance(item.id);
                                    setDeleteConfirmId(null);
                                  }}
                                  className="px-2 py-0.5 text-xs font-bold bg-rose-600 text-white rounded hover:bg-rose-700 transition cursor-pointer"
                                >
                                  Ha, o'chirish
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                                >
                                  Bekor
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(item.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                title="O'chirish"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Yozuv qo'shish yoki tahrirlash Modali */}
      {(isAddModalOpen || editingItem) && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              {editingItem ? 'Davomat yozuvini tahrirlash' : 'Qo\'lda davomat kiritish'}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Agar ishchi 08:00 da kelib 00:00 dan keyin (tunda) ketsa, sana va soat to'g'ri ko'rsatilsa tizim avtomatik uzluksiz hisoblaydi.
            </p>

            <form
              onSubmit={editingItem ? handleSubmitEdit : handleSubmitAdd}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ishchini tanlang *
                </label>
                <select
                  value={formState.user_id}
                  onChange={(e) =>
                    setFormState({ ...formState, user_id: Number(e.target.value) })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {selectableUsers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name} ({w.position || (w.role === 'admin' ? 'Admin' : 'Xodim')})
                    </option>
                  ))}
                </select>
              </div>

              {/* Kelgan sana va vaqt */}
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="text-xs font-bold text-emerald-900 block mb-2">
                  🟢 Kelgan vaqti:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Sana</label>
                    <input
                      type="date"
                      required
                      value={formState.check_in_date}
                      onChange={(e) => {
                        const newIn = e.target.value;
                        const outDate = formState.check_out_date < newIn ? newIn : formState.check_out_date;
                        setFormState({ ...formState, check_in_date: newIn, check_out_date: outDate });
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Soat</label>
                    <input
                      type="time"
                      required
                      value={formState.check_in_time}
                      onChange={(e) =>
                        setFormState({ ...formState, check_in_time: e.target.value })
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Ketgan sana va vaqt */}
              <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-100">
                <span className="text-xs font-bold text-rose-900 block mb-2">
                  🔴 Ketgan vaqti (Erta yoki 00:00 dan keyin):
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Sana</label>
                    <input
                      type="date"
                      required
                      min={formState.check_in_date}
                      value={formState.check_out_date}
                      onChange={(e) =>
                        setFormState({ ...formState, check_out_date: e.target.value })
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Soat</label>
                    <input
                      type="time"
                      required
                      value={formState.check_out_time}
                      onChange={(e) =>
                        setFormState({ ...formState, check_out_time: e.target.value })
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Hisoblangan vaqtni oldindan ko'rsatish */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">Jami hisoblanadigan vaqt:</span>
                <span className="font-bold text-emerald-700 text-sm">
                  {formatMinutesToHours(
                    calculateShiftWorkedMinutes(
                      formState.check_in_date,
                      formState.check_in_time,
                      formState.check_out_date,
                      formState.check_out_time,
                      formState.total_break_minutes
                    )
                  )}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Izoh (ixtiyoriy)
                </label>
                <input
                  type="text"
                  placeholder="Masalan: Tungi smena yoki ertaroq ruxsat berildi"
                  value={formState.note}
                  onChange={(e) =>
                    setFormState({ ...formState, note: e.target.value })
                  }
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingItem(null);
                  }}
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
