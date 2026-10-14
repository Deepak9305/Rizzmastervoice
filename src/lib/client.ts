import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import type { Profile } from '../types';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const configured = Boolean(supabase);
export const defaultProfile: Profile = { display_name: '', coach: 'wingman', save_transcripts: false, spoken_replies: true, age_confirmed: false, terms_version: null, voice_consent: false };
const previewProfileKey = 'rv.preview.profile.v1';
export function readPreviewProfile(): Profile {
  try {
    const value = JSON.parse(localStorage.getItem(previewProfileKey) || 'null');
    if (!value || typeof value !== 'object') return { ...defaultProfile };
    return {
      display_name: typeof value.display_name === 'string' ? value.display_name.slice(0, 60) : defaultProfile.display_name,
      coach: ['wingman', 'bestie', 'straight'].includes(value.coach) ? value.coach : defaultProfile.coach,
      save_transcripts: value.save_transcripts === true,
      spoken_replies: value.spoken_replies !== false,
      age_confirmed: value.age_confirmed === true,
      terms_version: typeof value.terms_version === 'string' ? value.terms_version : null,
      voice_consent: value.voice_consent === true,
    };
  } catch { return { ...defaultProfile }; }
}
export function writePreviewProfile(profile: Profile) {
  try { localStorage.setItem(previewProfileKey, JSON.stringify(profile)); } catch { /* Storage may be unavailable in private browsing. */ }
}
export function clearPreviewProfile() {
  try { localStorage.removeItem(previewProfileKey); } catch { /* Storage may be unavailable in private browsing. */ }
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const response = await fetch(`${base}/api/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000),
  });
  const result = await response.json().catch(() => ({ error: 'The service is temporarily unavailable. Please try again.' }));
  if (!response.ok) throw new ApiError(result.error || 'Something went wrong. Please try again.', response.status);
  return result as T;
}
export function publicUrl(path: string) { return `${(import.meta.env.VITE_PUBLIC_APP_URL || location.origin).replace(/\/$/, '')}${path}`; }
export async function downloadJson(value: unknown) {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const path = 'rizzmaster-voice-data.json';
    const file = await Filesystem.writeFile({ path, data: JSON.stringify(value, null, 2), directory: Directory.Cache, encoding: Encoding.UTF8 });
    try { await Share.share({ title: 'Your Rizzmaster Voice data', files: [file.uri], dialogTitle: 'Save your data export' }); }
    finally { setTimeout(() => { void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {}); }, 60000); }
    return;
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'rizzmaster-voice-data.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
