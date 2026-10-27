import ka from './ka.json';
import tr from './tr.json';

export type Lang = 'en' | 'ru' | 'ka' | 'tr';
/** Every text is written as a Russian/English pair; Georgian and Turkish are looked up by the English text. */
export type T = (ru: string, en: string) => string;

export const LANGS: {code: Lang; label: string}[] = [
  {code: 'en', label: 'EN'}, {code: 'ru', label: 'RU'}, {code: 'ka', label: 'KA'}, {code: 'tr', label: 'TR'},
];
const dictionaries: Record<'ka' | 'tr', Record<string, string>> = {ka, tr};
const isLang = (value: string | null | undefined): value is Lang => LANGS.some((item) => item.code === value);

export function translator(lang: Lang): T {
  return (ru, en) => lang === 'ru' ? ru : lang === 'en' ? en : dictionaries[lang][en] ?? en;
}

/** `?lang=` wins, then the browser languages, then English. */
export function detectLang(): Lang {
  const param = new URLSearchParams(location.search).get('lang');
  if (isLang(param)) return param;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag?.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return 'en';
}
