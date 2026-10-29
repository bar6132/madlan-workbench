// Messages that are not a complaint about deal data. They get a fixed, safe reply and no verdict.
export const OUT_OF_SCOPE_REPLY = 'שלום, לא מצאתי את המידע שחיפשת. לפרטים נוספים יש לפנות לשירות הלקוחות.';

// Obvious attempts to steer the tool. This runs BEFORE any model call, so these messages cost no quota and
// cannot influence a model. The model's own `intent` label catches the phrasings this list does not.
// SQL text is deliberately not here: it is inert in this app and the deal in the message can still be checked.
const MANIPULATION: RegExp[] = [
  /api[\s_-]*key/i,
  /מפתח\s*(ה?-?api|גישה|סודי)/i,
  /משתני\s*(ה)?סביבה/,
  /environment\s*variables?/i,
  /system\s*prompt/i,
  /פרומפט|הנחיות\s*המערכת/,
  /התעלם\s*מ(כל\s*)?ה?(הוראות|הנחיות)/,
  /ignore\s+(all\s+|any\s+|your\s+|the\s+|previous\s+|prior\s+)*(instructions|rules|prompts?)/i,
  // The system must be named: "אני מנהל נכסים" or "אני בעלים של הדירה" are ordinary customers.
  /אני\s+(ה)?מנהל\s+(של\s+)?(ה)?(מערכת|אתר|מדלן)/,
  /אני\s+(ה)?(אדמין|אדמינסטרטור)(?![֐-׿])/,
  /\bi\s*(am|'m|’m)\s+(your\s+|the\s+)?(admin|administrator|developer|owner|root)\b/i,
  /\b(admin|developer|root|debug|jailbreak)\s*mode\b/i,
  /\bDAN\b.*\bmode\b/i,
  /מחק\s*(הכל|הכול|את\s*כל|את\s*ה)/,
  /\bdelete\s+(all|everything|the\s+(database|data|deals))\b/i,
  /\b(reveal|show|print|leak)\b.*\b(prompt|key|secret|password|token)\b/i,
  /(סיסמ[הת]|טוקן|סוד(ות)?)(?![֐-׿]).*(שלך|המערכת)/,
];

export function looksLikeManipulation(text: string): boolean {
  return MANIPULATION.some((re) => re.test(text));
}
