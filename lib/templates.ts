import type { VerifiedFacts, Verdict } from './verifier';

export const verdictLabel: Record<Verdict, string> = {
  RAW_VALUE_WRONG: 'הנתון בקובץ אינו עקבי',
  RAW_VALUE_OK: 'הנתון בקובץ עקבי',
  SOURCES_CONFLICT: 'סתירה בין מקורות דיווח',
  CANNOT_DETERMINE: 'לא ניתן לקבוע לפי הנתונים',
  DEAL_NOT_FOUND: 'העסקה לא נמצאה',
};

const shekel = (n: number) => `₪${n.toLocaleString('en-US')}`;

export function templateReply(facts: VerifiedFacts): string {
  const id = facts.deal_id;
  const body = facts.facts_he.join(' ');
  switch (facts.verdict) {
    case 'SOURCES_CONFLICT': {
      const c = facts.conflict!;
      return [
        'שלום,',
        `בדקנו את עסקה ${id}. בקובץ הנתונים נמצאו לעסקה זו שתי רשומות עם מחירים שונים: ${c.primary.source} ${shekel(c.primary.price)} ו${c.other.source} ${shekel(c.other.price)}.`,
        `המערכת מציגה את הרשומה של ${c.primary.source}. ${c.reason_he}.`,
        ...(facts.facts_he.filter((f) => f.startsWith('אין בקובץ רשומה')).slice(0, 1)),
        'תודה שהפנית את תשומת ליבנו.',
      ].join('\n');
    }
    case 'RAW_VALUE_WRONG':
      return ['שלום,', `בדקנו את עסקה ${id}. ${body}`, 'הנתון בקובץ המקור אכן אינו עקבי, ותודה שהפנית את תשומת ליבנו.'].join('\n');
    case 'RAW_VALUE_OK':
      return ['שלום,', `בדקנו את עסקה ${id}. ${body}`, 'לא מצאנו בנתונים סתירה בנתון שציינת. אם יש לך מידע נוסף נשמח לבדוק שוב.'].join('\n');
    case 'CANNOT_DETERMINE':
      return ['שלום,', `בדקנו את עסקה ${id}. ${body}`, 'הנתונים שברשותנו אינם מאפשרים לקבוע זאת, והפנייה הועברה לבדיקה נוספת.'].join('\n');
    default:
      return 'שלום,\nלא מצאנו בקובץ הנתונים עסקה התואמת לפרטים שציינת. נשמח לקבל מזהה עסקה או כתובת מדויקת יותר כדי לבדוק שוב.';
  }
}

const UNKNOWN: Record<Verdict, string> = {
  RAW_VALUE_WRONG: 'לא ידוע מה הוצג ללקוח בפועל באתר; הבדיקה מתבססת על הערכים בקובץ בלבד.',
  RAW_VALUE_OK: 'לא ידוע מה הוצג ללקוח בפועל באתר; הבדיקה מתבססת על הערכים בקובץ בלבד.',
  SOURCES_CONFLICT: 'לא ידוע איזו מהרשומות הוצגה ללקוח, ולא ידוע מדוע קיימות שתי רשומות.',
  CANNOT_DETERMINE: 'הנתונים בקובץ אינם מכילים מידע שמאפשר להכריע בנושא שנשאל.',
  DEAL_NOT_FOUND: 'לא זוהתה עסקה בקובץ; ייתכן שהפרטים שנמסרו חלקיים.',
};

export function escalationNote(facts: VerifiedFacts, trace_id: string): string {
  const rows = facts.rows
    .map((r) => `  - שורה ${r.row_index + 2} בקובץ: ${r.source}, מחיר ${r.price_nis_raw}, מחיר למ"ר בקובץ ${r.csv_price_per_sqm ?? 'חסר'}`)
    .join('\n');
  return [
    'הפניה לצוות הפיתוח',
    `מזהה מעקב: ${trace_id}`,
    `עסקה: ${facts.deal_id ?? 'לא זוהתה'}`,
    `נושא התלונה: ${facts.field}`,
    `תוצאת הבדיקה: ${verdictLabel[facts.verdict]}`,
    `כללים שהופעלו: ${facts.rule_ids.join(', ')}`,
    ...(rows ? ['רשומות מקור:', rows] : []),
    `מה לא ידוע: ${UNKNOWN[facts.verdict]}`,
  ].join('\n');
}
