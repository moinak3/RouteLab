import type { Model } from "../types";

export function FamilyLogo({family}:{family:Model["family"]}) {
  if(family==="OpenAI")return <img src="/openai-logo.png" alt="OpenAI logo" />;
  if(family==="Claude")return <svg viewBox="0 0 64 64" role="img" aria-label="Claude logo"><path d="M32 8 53 56H42l-4-10H25l-4 10H11L32 8Zm-4 29h7l-3-9-4 9Z" fill="currentColor"/></svg>;
  if(family==="Gemini")return <svg viewBox="0 0 64 64" role="img" aria-label="Gemini logo"><path d="M32 6c3 15 11 23 26 26-15 3-23 11-26 26-3-15-11-23-26-26 15-3 23-11 26-26Z" fill="currentColor"/></svg>;
  if(family==="Mistral")return <svg viewBox="0 0 64 64" role="img" aria-label="Mistral logo"><path d="M10 16h9v9h8v-9h10v9h8v-9h9v32h-9V32h-8v16H27V32h-8v16h-9V16Z" fill="currentColor"/></svg>;
  if(family==="DeepSeek")return <svg viewBox="0 0 64 64" role="img" aria-label="DeepSeek logo"><path d="M11 36c0-14 11-25 25-25 9 0 16 4 21 11-5-2-10-2-14 1-5 3-6 9-3 14 2 4 6 6 11 6-5 6-12 10-21 10-11 0-19-7-19-17Z" fill="currentColor"/><circle cx="38" cy="30" r="4" fill="#fff"/></svg>;
  return <svg viewBox="0 0 64 64" role="img" aria-label="Local model logo"><path d="M14 16h36v26H14V16Zm9 34h18M28 42v8m8-8v8" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
