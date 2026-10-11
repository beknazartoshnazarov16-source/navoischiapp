import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { WorkerKpiMetric } from '../components/KpiRatingManager';

interface PdfSummaryData {
  totalHours: number;
  averageKpi: number;
  punctualityRate: number;
  totalWorkers: number;
}

/**
 * Xodimlarning oylik ishlagan soatlari va KPI natijalari bo'yicha
 * chop etishga tayyor, rasmiy va yuqori sifatli PDF hisobotini shakllantirish
 */
export function exportKpiRatingToPdf(
  items: WorkerKpiMetric[],
  periodTitle: string,
  shopName: string,
  summary: PdfSummaryData
) {
  // A4 Landscape (297mm x 210mm) - jadval va ustunlar keng, qulay joylashishi uchun
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. Yuqori zamonaviy korporativ Header (To'q zumrad va oltin uslubida)
  doc.setFillColor(6, 78, 59); // emerald-900
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setFillColor(245, 158, 11); // amber-500 yupqa chiziq
  doc.rect(0, 25, pageWidth, 1.5, 'F');

  // Sarlavha matnlari
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(
    `${(shopName || 'NAVO MARKET').toUpperCase()} - XODIMLARNING ISH VAQTI VA KPI SAMARADORLIK RASMIY HISOBOTI`,
    14,
    11
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(209, 250, 229); // emerald-100
  doc.text(
    "Ishlangan soatlar, davomat intizomi va KPI reytingi bo'yicha umumlashtirilgan oylik ma'lumotnoma",
    14,
    18
  );

  // O'ng tarafdagi sana va vaqt
  const generatedAt = new Date().toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.setFontSize(8.5);
  doc.text(`Sana: ${generatedAt}`, pageWidth - 14, 11, { align: 'right' });
  doc.text(`Davr: ${periodTitle}`, pageWidth - 14, 18, { align: 'right' });

  // 2. Asosiy ko'rsatkichlar bloklari (Summary Badges)
  const startY = 32;
  const boxWidth = (pageWidth - 28 - 9) / 4; // 4 ta blok
  const boxHeight = 15;

  const summaryBoxes = [
    {
      title: "JAMI ISH SOATLARI",
      value: `${summary.totalHours} soat`,
      sub: "Barcha xodimlar mehnati",
      bg: [254, 243, 199], // amber-100
      border: [245, 158, 11], // amber-500
      textColor: [146, 64, 14],
    },
    {
      title: "O'RTACHA JAMOA KPI",
      value: `${summary.averageKpi} / 100 ball`,
      sub: "Umumiy samaradorlik",
      bg: [209, 250, 229], // emerald-100
      border: [16, 185, 129], // emerald-500
      textColor: [6, 95, 70],
    },
    {
      title: "INTIZOM VA VAQTIDA KELISH",
      value: `${summary.punctualityRate}%`,
      sub: "Kechikmasdan kelish me'yori",
      bg: [224, 242, 254], // sky-100
      border: [14, 165, 233], // sky-500
      textColor: [3, 105, 161],
    },
    {
      title: "FAOL ISHCHILAR SONI",
      value: `${summary.totalWorkers} nafar`,
      sub: "Do'konda faol xodimlar",
      bg: [243, 232, 255], // purple-100
      border: [168, 85, 247], // purple-500
      textColor: [107, 33, 168],
    },
  ];

  summaryBoxes.forEach((box, i) => {
    const x = 14 + i * (boxWidth + 3);
    doc.setFillColor(box.bg[0], box.bg[1], box.bg[2]);
    doc.setDrawColor(box.border[0], box.border[1], box.border[2]);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, startY, boxWidth, boxHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(box.title, x + 3.5, startY + 4.5);

    doc.setFontSize(11);
    doc.setTextColor(box.textColor[0], box.textColor[1], box.textColor[2]);
    doc.text(box.value, x + 3.5, startY + 9.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(box.sub, x + 3.5, startY + 13);
  });

  // 3. Xodimlar KPI Jadvali (autoTable)
  const tableData = items.map((item) => {
    const rankPrefix =
      item.rank === 1
        ? '1 (Top 1)'
        : item.rank === 2
        ? '2 (Top 2)'
        : item.rank === 3
        ? '3 (Top 3)'
        : String(item.rank);

    return [
      rankPrefix,
      item.user.full_name,
      item.user.position || 'Xodim',
      item.user.phone || '-',
      `${item.totalWorkedHours} soat`,
      `${item.workedDaysCount} kun`,
      `${item.averageDailyHours} s/kun`,
      `${item.punctualityRate}%`,
      item.lateCount > 0 ? `${item.lateCount} marta` : "Kechikmagan",
      `${item.totalKpiScore} / 100`,
      item.badgeTitle.replace(/[^\x00-\x7F]/g, '').trim() || item.badgeTitle,
      item.rewardRecommendation.replace(/[^\x00-\x7F]/g, '').trim() || item.rewardRecommendation,
    ];
  });

  autoTable(doc, {
    startY: 51,
    margin: { left: 14, right: 14, bottom: 26 },
    head: [
      [
        'O\'rin',
        'Xodim F.I.Sh.',
        'Lavozimi',
        'Telefon',
        'Ish Soati',
        'Kunlar',
        'Kunlik',
        'Intizom',
        'Kechikish',
        'KPI Bali',
        'Daraja',
        'Rag\'batlantirish Tavsiyasi',
      ],
    ],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42], // slate-900
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      valign: 'middle',
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2,
      valign: 'middle',
      lineColor: [226, 232, 240], // slate-200
      lineWidth: 0.2,
      textColor: [30, 41, 59], // slate-800
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 15 },
      1: { fontStyle: 'bold', cellWidth: 42 },
      2: { cellWidth: 24 },
      3: { cellWidth: 26, fontSize: 7 },
      4: { halign: 'center', fontStyle: 'bold', cellWidth: 20 },
      5: { halign: 'center', cellWidth: 15 },
      6: { halign: 'center', cellWidth: 15 },
      7: { halign: 'center', cellWidth: 16 },
      8: { halign: 'center', cellWidth: 18 },
      9: { halign: 'center', fontStyle: 'bold', cellWidth: 18 },
      10: { halign: 'center', fontStyle: 'bold', cellWidth: 22 },
      11: { fontSize: 7 },
    },
    didParseCell: (data) => {
      // Top 3 xodim qatorini alohida fon bilan ajratish
      if (data.section === 'body') {
        const rowIndex = data.row.index;
        if (rowIndex === 0) {
          data.cell.styles.fillColor = [254, 243, 199]; // oltin fon
        } else if (rowIndex === 1) {
          data.cell.styles.fillColor = [241, 245, 249]; // kumush fon
        } else if (rowIndex === 2) {
          data.cell.styles.fillColor = [254, 237, 222]; // bronza fon
        }

        // KPI Bali ustuniga rang berish
        if (data.column.index === 9) {
          data.cell.styles.textColor = [5, 150, 105]; // emerald-600
        }
      }
    },
  });

  // 4. Pastki qism: Rasmiy imzolar va KPI hisoblash qoidalari izohi
  const finalY = (doc as any).lastAutoTable?.finalY || 160;

  // Agar sahifa oxiriga sig'masa yangi sahifa qo'shish
  if (finalY > pageHeight - 30) {
    doc.addPage();
  }

  const signY = Math.min(finalY + 8, pageHeight - 20);

  // Izoh satri
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "* KPI ballari 4 ta mezon asosida hisoblanadi: Ish soati hajmi (50 ball) + Intizom va o'z vaqtida kelish (30 ball) + Barqarorlik (15 ball) + Tanaffus me'yori (5 ball).",
    14,
    signY
  );

  // Rasmiy imzolar bloki
  const sigLineY = signY + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);

  doc.text("Do'kon Rahbari: ___________________________", 14, sigLineY);
  doc.text("Bosh Administrator: ___________________________", 110, sigLineY);
  doc.text("Muhr o'rni (M.O'): _______________", pageWidth - 14, sigLineY, { align: 'right' });

  // 5. Har bir sahifaga raqam va maxfiylik yozuvi qo'yish
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      `Navo Market Tizimi - Rasmiy Ichki Hujjat | Sahifa ${i} / ${pageCount}`,
      14,
      pageHeight - 5
    );
    doc.text(
      `Avtomat shakllantirildi: ${generatedAt}`,
      pageWidth - 14,
      pageHeight - 5,
      { align: 'right' }
    );
  }

  // Faylni yuklab olish
  const cleanShopName = (shopName || 'Navo_Market').replace(/\s+/g, '_');
  const cleanPeriod = periodTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanShopName}_KPI_Hisoboti_${cleanPeriod}.pdf`;

  doc.save(filename);
}
