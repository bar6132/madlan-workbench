// Hebrew strings written by us. Facts only; no causes, no promises.
export const he = {
  dealNotFound: 'לא נמצאה עסקה כזו בקובץ הנתונים.',
  statedNotInData: 'הערך שצוין אינו מופיע בנתונים.',
  statedMatchesPrimary: 'הערך שצוין תואם לרשומה שהמערכת מציגה.',
  noTaxRow: (a: string, b: string) =>
    `אין בקובץ רשומה של רשות המסים לעסקה זו; שני הדיווחים הם מ${a} ומ${b}.`,
  conflictReasonPpsm: 'המחיר למ"ר שנרשם בקובץ תואם לרשומה זו',
  conflictReasonOrder: 'נבחרה לפי סדר עדיפות מקורות (הנחה של המערכת, לא נתון מהקובץ)',
  statedMatchesFile: 'הערך שצוין תואם לנתון שבקובץ.',
  statedMatchesOther: (src: string, price: number) =>
    `הערך שצוין תואם לדיווח של ${src} (₪${price.toLocaleString('en-US')}) ולא לרשומה שהמערכת מציגה.`,
  priceSizeDisagree:
    'המחיר, השטח והמחיר למ"ר שנרשמו בקובץ אינם מתאימים זה לזה, והנתונים אינם מאפשרים לקבוע איזה מהערכים (מחיר, שטח או מחיר למ"ר) שגוי.',
  priceNoSize: 'המחיר נרשם בקובץ, אך שטח הדירה חסר ולכן לא ניתן לבדוק את עקביות המחיר.',
  priceOk: 'המחיר בקובץ עקבי עם שאר נתוני העסקה. הנתונים אינם מאפשרים לקבוע אם המחיר סביר.',
  singleReport: 'בקובץ קיימת רשומה אחת בלבד לעסקה זו, ולכן אין שני מחירים סותרים.',
  exactDup: 'הרשומה הופיעה בקובץ פעמיים באותם נתונים בדיוק, ולכן קיים מחיר אחד.',
  ppsmOk: (calc: number) => `המחיר למ"ר בקובץ תואם למחיר חלקי שטח (₪${calc.toLocaleString('en-US')}).`,
  ppsmNoSize: 'שטח הדירה חסר בקובץ, ולכן לא ניתן לבדוק את המחיר למ"ר.',
  sizeOk: (n: number) => `השטח בקובץ הוא ${n} מ"ר. בקובץ אין פירוט של שטח מרפסת או גינה.`,
  sizeMissing: 'שטח הדירה חסר בקובץ.',
  dateMonthOnly: (raw: string) => `בקובץ מצוין חודש ושנה בלבד (${raw}); היום המדויק אינו ידוע.`,
  dateMissing: 'תאריך העסקה חסר בקובץ.',
  dateOk: (d: string) => `תאריך העסקה בקובץ: ${d}.`,
  roomsOk: (n: number) => `מספר החדרים בקובץ: ${n}.`,
  roomsMissing: 'מספר החדרים חסר בקובץ.',
  detailsConflict: 'שני הנתונים אינם מתיישבים זה עם זה, והנתונים אינם מאפשרים לקבוע איזה מהם שגוי.',
  detailsOk: 'לא נמצאה בקובץ סתירה בין פרטי הנכס. הנתונים אינם מאפשרים לבדוק אותם מול המציאות.',
  detailsLine: (d: {
    condition: string | null; year_built: number | null; floor: number | null; total_floors: number | null;
    elevator: boolean | null; parking: boolean | null; balcony: boolean | null; safe_room: boolean | null; property_type: string;
  }) => {
    const v = (x: unknown) => (x === null || x === undefined ? 'לא ידוע' : String(x));
    const yn = (x: boolean | null) => (x === null ? 'לא ידוע' : x ? 'כן' : 'לא');
    const floor = d.floor === null ? 'לא ידוע' : d.total_floors === null ? String(d.floor) : `${d.floor} מתוך ${d.total_floors}`;
    return `פרטי הנכס שנרשמו בקובץ: סוג נכס — ${d.property_type}; מצב — ${v(d.condition)}; שנת בנייה — ${v(d.year_built)}; קומה — ${floor}; מעלית — ${yn(d.elevator)}; חניה — ${yn(d.parking)}; מרפסת — ${yn(d.balcony)}; ממ"ד — ${yn(d.safe_room)}.`;
  },
  other: 'הנושא שצוין אינו חלק מהנתונים שבקובץ (למשל מספר בית, שטח מרפסת או גינה, תמ"א 38).',
} as const;

export const fieldLabel: Record<string, string> = {
  price: 'מחיר העסקה',
  price_per_sqm: 'מחיר למ"ר',
  size: 'שטח',
  date: 'תאריך',
  rooms: 'מספר חדרים',
  property_details: 'פרטי הנכס (מצב, שנת בנייה, קומה, מעלית…)',
  two_prices: 'שני מחירים שונים',
  other: 'נושא אחר',
};

export const examples = [
  'אני רואה שני מחירים שונים לעסקה D100124 באתר. איזה מהם נכון?',
  'המחיר למ"ר בעסקה D100313 לא מסתדר עם המחיר והשטח.',
  'ראיתי עסקה D100317 במחיר 18,000 ש"ח. זו בטח טעות.',
  'המחיר של הדירה ברחוב בן גוריון בחולון נראה לי לא הגיוני.',
  'כמה גדולה המרפסת בעסקה D100313?',
  'יש לי בעיה עם 100365: כתוב חדש מקבלן אבל הדירה ממש ישנה, איך זה יתכן?',
];

export const statusLabel: Record<string, string> = {
  VALID: 'תקין',
  CONFLICT: 'סתירה בין מקורות',
  EXCLUDED: 'מוחרג מהסטטיסטיקה',
};

export const flagLabel: Record<string, string> = {
  EXACT_DUPLICATE: 'רשומה כפולה',
  SOURCE_CONFLICT: 'סתירה בין מקורות',
  PPSM_MISMATCH: 'מחיר למ"ר לא תואם',
  PRICE_INVALID: 'מחיר לא תקין',
  PRICE_BELOW_THRESHOLD: 'מחיר נמוך מהסף',
  TIMELINE_CONTRADICTION: 'סתירה בשנת הבנייה',
  NEW_BUILD_OLD_YEAR: '"חדש מקבלן" עם שנת בנייה ישנה',
  PPSM_OUTLIER: 'מחיר למ"ר חריג',
  CITY_NORMALIZED: 'שם העיר אוחד',
  MONTH_ONLY_DATE: 'תאריך ברמת חודש',
  MISSING_SIZE: 'שטח חסר',
};

export const sortLabel: Record<string, string> = {
  date_desc: 'חדש לישן',
  price_asc: 'מחיר: מהנמוך לגבוה',
  price_desc: 'מחיר: מהגבוה לנמוך',
  ppsm_desc: 'מחיר למ"ר: מהגבוה לנמוך',
  id_asc: 'מזהה עסקה',
};
