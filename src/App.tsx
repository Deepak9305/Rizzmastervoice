import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import type { User } from '@supabase/supabase-js';
import { ArrowLeft, ArrowRight, Crown, History, Mic, Settings2, ShieldCheck, Sparkles, Target, UserRound, WifiOff, X } from 'lucide-react';
import { AuthScreens, type AuthScreen } from './components/AuthScreens';
import { ConsentScreen, ChooseCoachScreen, ConversationScreen, HomeScreen, PracticeScreen, RecapScreen } from './components/CoachScreens';
import { PremiumScreen, PrivacyAccountScreen, ProfileScreen, ReportScreen, SessionsScreen, SubscriptionScreen } from './components/AccountScreens';
import { DeleteAccountScreen, HelpScreen, LegalScreen } from './components/LegalScreens';
import { Brand, Button, Empty, Header } from './components/UI';
import { api, ApiError, configured, defaultProfile, downloadJson, supabase } from './lib/client';
import { clearBillingAccount, initializeBilling, restorePurchases, setBillingCallbacks, subscribe } from './lib/billing';
import { previewReply } from './lib/preview';
import { VoiceRecorder, type Recording } from './lib/recorder';
import { GeminiLiveSession, liveCoachInstruction } from './lib/live';
import { SCENARIOS, type Coach, type Entitlement, type Message, type Mode, type Plan, type Profile, type SavedSession } from './types';
const INITIAL_ACCESS: Entitlement = { active: false, plan: null, expires_at: null, state: 'FREE', used: 0, limit: 5 };
const AUTH_SCREENS = ['welcome', 'age', 'login', 'signup', 'forgot', 'reset-password'];
const MAIN_SCREENS = ['home', 'practice', 'sessions', 'profile'];
const ALL_SCREENS = [...AUTH_SCREENS, ...MAIN_SCREENS, 'choose-coach', 'conversation', 'consent', 'recap', 'premium', 'subscription', 'account', 'privacy', 'terms', 'help', 'delete-account', 'report', 'voice-settings'];
function screenFromUrl() {
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  return ALL_SCREENS.includes(path) ? path : 'welcome';
}
function readPreviewSessions(): SavedSession[] {
  try { const value = JSON.parse(localStorage.getItem('rv.preview.sessions.v1') || '[]'); return Array.isArray(value) ? value.filter(item => typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.messages)) : []; }
  catch { return []; }
}
export function App() {
  const [screen, setScreen] = useState(screenFromUrl);
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef(user); userRef.current = user;
  const [preview, setPreview] = useState(!configured);
  const [profile, setProfile] = useState<Profile>({ ...defaultProfile });
  const [access, setAccess] = useState<Entitlement>(INITIAL_ACCESS);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [messages, setMessages] = useState<Message[]>([]);
  const [title, setTitle] = useState('Let’s talk');
  const [mode, setMode] = useState<Mode>('advice');
  const [scenario, setScenario] = useState('intro');
  const [sessionCoach, setSessionCoach] = useState<Coach>('wingman');
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speechMessageId, setSpeechMessageId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [reportMessage, setReportMessage] = useState<Message | null>(null);
  const [profileError, setProfileError] = useState('');
  const screenRef = useRef(screen); screenRef.current = screen;
  const recorder = useRef(new VoiceRecorder());
  const sessionId = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  const sessionGeneration = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const previousScreen = useRef('home');
  const legalReturn = useRef('welcome');
  const deletionReturn = useRef(screen === 'delete-account');
  const profileRef = useRef(profile); profileRef.current = profile;
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const liveReply = useRef<{ userId: string; assistantId: string; input: string; output: string }>({ userId: '', assistantId: '', input: '', output: '' });
  const liveReady = useRef(false);
  const liveRecordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSessionRef = useRef<(items: Message[], silent?: boolean) => Promise<void>>();
  const startVoiceWhenReady = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6500);
  }, []);
  const live = useRef<GeminiLiveSession | null>(null);
  if (!live.current) live.current = new GeminiLiveSession({
    onState: state => {
      if (state === 'recording') { setRecording(true); setLiveBusy(true); }
      if (state === 'speaking') setSpeaking(true);
      if (state === 'connected') { setRecording(false); setSpeaking(false); }
      if (state === 'closed') { setRecording(false); setSpeaking(false); setLiveBusy(false); liveReady.current = false; }
    },
    onInputTranscript: text => {
      const current = liveReply.current;
      current.input += text;
      if (!current.userId) current.userId = crypto.randomUUID();
      setMessages(items => {
        const existing = items.some(item => item.id === current.userId);
        return existing ? items.map(item => item.id === current.userId ? { ...item, content: current.input } : item) : [...items, { id: current.userId, role: 'user', content: current.input }];
      });
    },
    onOutputTranscript: text => {
      const current = liveReply.current;
      current.output += text;
      if (!current.assistantId) current.assistantId = crypto.randomUUID();
      setSpeechMessageId(current.assistantId);
      setMessages(items => {
        const existing = items.some(item => item.id === current.assistantId);
        return existing ? items.map(item => item.id === current.assistantId ? { ...item, content: current.output } : item) : [...items, { id: current.assistantId, role: 'assistant', content: current.output }];
      });
    },
    onTurnComplete: () => {
      const current = liveReply.current;
      setLiveBusy(false); setRecording(false);
      const items = messagesRef.current;
      if (profileRef.current.save_transcripts && items.length > 1) void saveSessionRef.current?.(items, true);
      liveReply.current = { userId: '', assistantId: '', input: '', output: '' };
    },
    onError: error => { setLiveBusy(false); setRecording(false); notify(error.message); },
  });
  const stopAudio = useCallback(() => { audio.current?.pause(); live.current?.stopPlayback(); setSpeaking(false); }, []);
  function clearSpeech() { stopAudio(); audio.current = null; if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); audioUrl.current = null; }
  function navigate(next: string) {
    if (!ALL_SCREENS.includes(next)) return;
    if (next === 'privacy' || next === 'terms') legalReturn.current = screenRef.current;
    if (next === 'premium' || next === 'choose-coach') previousScreen.current = screenRef.current;
    if (next !== 'conversation') { startVoiceWhenReady.current = false; recorder.current.cancel(); live.current?.close(); if (liveRecordingTimer.current) clearTimeout(liveRecordingTimer.current); setRecording(false); setLiveBusy(false); stopAudio(); }
    setScreen(next); history.pushState({}, '', next === 'welcome' ? '/' : `/${next}`);
    window.scrollTo({ top: 0 });
  }
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  async function task(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await fn(); } catch (error) { notify(error instanceof Error ? error.message : 'Something went wrong. Please try again.'); if (error instanceof ApiError && error.status === 401) navigate('login'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  useEffect(() => {
    const pop = () => { recorder.current.cancel(); setRecording(false); stopAudio(); setScreen(screenFromUrl()); };
    const connect = () => setOnline(navigator.onLine);
    const visibility = () => { if (document.hidden) { recorder.current.cancel(); live.current?.close(); setRecording(false); setLiveBusy(false); stopAudio(); } };
    addEventListener('popstate', pop); addEventListener('online', connect); addEventListener('offline', connect); document.addEventListener('visibilitychange', visibility);
    return () => { removeEventListener('popstate', pop); removeEventListener('online', connect); removeEventListener('offline', connect); document.removeEventListener('visibilitychange', visibility); if (toastTimer.current) clearTimeout(toastTimer.current); if (liveRecordingTimer.current) clearTimeout(liveRecordingTimer.current); recorder.current.cancel(); live.current?.close(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); };
  }, [stopAudio]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const back = NativeApp.addListener('backButton', () => {
      if (MAIN_SCREENS.includes(screenRef.current) || screenRef.current === 'welcome') { if (screenRef.current !== 'home' && screenRef.current !== 'welcome') navigateRef.current('home'); else void NativeApp.minimizeApp(); }
      else history.back();
    });
    const state = NativeApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) { recorder.current.cancel(); live.current?.close(); setRecording(false); setLiveBusy(false); stopAudio(); } });
    return () => { void back.then(handle => handle.remove()); void state.then(handle => handle.remove()); };
  }, [stopAudio]);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (event === 'PASSWORD_RECOVERY') navigateRef.current('reset-password');
      if (event === 'SIGNED_OUT') { sessionGeneration.current++; clearSpeech(); recorder.current.cancel(); setRecording(false); setProfile({ ...defaultProfile }); setAccess(INITIAL_ACCESS); setMessages([]); setSessions([]); clearBillingAccount(); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  const loadProfile = useCallback(async () => {
    const requester = userRef.current?.id;
    const result = await api<{ profile: Profile; entitlement: Entitlement }>('profile');
    if (userRef.current?.id !== requester) throw new Error('Your account changed. Please reload your space.');
    setProfile(result.profile); setAccess(result.entitlement); setMuted(false);
    return result.profile;
  }, []);
  useEffect(() => {
    if (!user) return;
    setPreview(false); setLoadingProfile(true); setProfileError(''); setBillingCallbacks(setAccess, notify);
    let cancelled = false;
    void loadProfile().then(data => {
      if (cancelled) return;
      if (screenRef.current === 'reset-password') return;
      if (deletionReturn.current) { navigateRef.current('delete-account'); return; }
      if (!data.age_confirmed) navigateRef.current('age');
      else if (AUTH_SCREENS.includes(screenRef.current)) navigateRef.current('home');
      void initializeBilling(user.id).catch(error => notify(error.message));
    }).catch(error => { if (!cancelled) setProfileError(error.message); }).finally(() => { if (!cancelled) setLoadingProfile(false); });
    return () => { cancelled = true; };
  }, [user?.id, loadProfile, notify]);
  async function patchProfile(update: Partial<Profile> & { accept_terms?: boolean }) {
    if (preview) { setProfile(current => ({ ...current, ...update })); return; }
    const result = await api<{ profile: Profile }>('profile', update, 'PATCH'); setProfile(result.profile);
  }
  function patch(update: Partial<Profile>) { void task(async () => { await patchProfile(update); notify('Your settings are saved.'); }); }
  async function acceptOnboarding() {
    await task(async () => {
      if (preview) { setProfile(current => ({ ...current, age_confirmed: true, terms_version: '2026-10-10', display_name: current.display_name || 'Alex' })); navigate('choose-coach'); }
      else if (!user) navigate('login');
      else { await patchProfile({ age_confirmed: true, accept_terms: true }); navigate('choose-coach'); }
    });
  }
  function enterPreview() { setPreview(true); setProfile({ ...defaultProfile, display_name: 'Alex' }); setAccess(INITIAL_ACCESS); navigate('age'); }
  function startConversation(nextTitle: string, nextMode: Mode = 'advice', nextScenario?: string, voice = false) {
    if (!preview && !user) { navigate('login'); return; }
    if (!profile.age_confirmed) { navigate('age'); return; }
    clearSpeech(); setSpeechMessageId(null); sessionGeneration.current++; sessionId.current = crypto.randomUUID(); setSaved(false);
    setTitle(nextTitle); setMode(nextMode); setScenario(nextScenario || 'intro'); setSessionCoach(profile.coach);
    const opening = nextMode === 'practice' ? SCENARIOS.find(item => item.id === nextScenario)?.opening || SCENARIOS[0].opening : nextTitle === 'First date nerves' ? 'A first date on your mind? Tell me what you’re feeling. We’ll take it one thought at a time.' : nextTitle === 'Decode a text' ? 'Tell me what they said and a little about the situation. Leave out names or private details.' : nextTitle === 'Ask them out' ? 'You’re thinking of making a move. Tell me how you know them and what you’d like to suggest.' : 'Hey, I’m your AI wingman. What’s happening in your dating life? Let’s talk it through.';
    setMessages([{ id: crypto.randomUUID(), role: 'assistant', content: opening }]); setVoiceMode(voice);
    navigate(voice && !profile.voice_consent ? 'consent' : 'conversation');
  }
  async function saveSession(items = messages, silent = false) {
    const id = sessionId.current;
    if (items.length < 2) { if (!silent) notify('Have a coaching exchange before saving.'); return; }
    if (preview) {
      const record: SavedSession = { id, title, mode, scenario, coach: sessionCoach, messages: items, created_at: new Date().toISOString() };
      const next = [record, ...readPreviewSessions().filter(item => item.id !== id)];
      localStorage.setItem('rv.preview.sessions.v1', JSON.stringify(next)); setSessions(next); setSaved(true);
    } else {
      await api('sessions', { id, title, mode, scenario, coach: sessionCoach, messages: items }); setSaved(true);
    }
    if (!silent) notify(preview ? 'Sample session saved on this device.' : 'Session saved to your account.');
  }
  saveSessionRef.current = saveSession;
  function playSpeech(base64: string, messageId: string) {
    stopAudio(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    setSpeechMessageId(messageId);
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    audioUrl.current = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    audio.current = new Audio(audioUrl.current); audio.current.onended = () => setSpeaking(false); audio.current.onerror = () => { setSpeaking(false); notify('Voice playback wasn’t available. Open captions to read the reply.'); };
    if (!muted) void audio.current.play().then(() => setSpeaking(true)).catch(() => { setSpeaking(false); notify('Tap Replay voice to hear your coach.'); });
  }
  async function ensureLiveSession(voice = false) {
    if (preview || liveReady.current) return;
    const result = await api<{ token: string; model: string }>('live-token', { coach: sessionCoach, mode, voice });
    await live.current?.connect(result.token, result.model, liveCoachInstruction(sessionCoach, mode, scenario));
    liveReady.current = true;
  }
  async function reserveLiveTurn(voice = false) {
    const result = await api<{ used: number; limit: number }>('live-turn', { coach: sessionCoach, mode, scenario, voice });
    setAccess(current => ({ ...current, used: result.used, limit: result.limit }));
  }
  async function sendLiveText(text: string) {
    if (liveBusy || !text.trim()) return;
    const userId = crypto.randomUUID();
    liveReply.current = { userId, assistantId: '', input: text.trim(), output: '' };
    setMessages(items => [...items, { id: userId, role: 'user', content: text.trim() }]);
    setSaved(false); setLiveBusy(true); stopAudio();
    try { await reserveLiveTurn(false); await ensureLiveSession(false); live.current?.sendText(text.trim()); }
    catch (error) { live.current?.close(); setLiveBusy(false); notify(error instanceof Error ? error.message : 'The live coach could not start. Please try again.'); }
  }
  async function send(text?: string, captured?: Recording) {
    if (inFlight.current || (!text && !captured)) return;
    if (messages.length >= 98) { notify('Save this session and start a new conversation to keep coaching.'); return; }
    if (!preview) {
      if (captured) { notify('Live coaching uses the microphone directly. Tap the mic to speak again.'); return; }
      if (text) { await sendLiveText(text); return; }
    }
    const generation = sessionGeneration.current;
    const history = text ? [...messages, { id: crypto.randomUUID(), role: 'user' as const, content: text }] : messages;
    stopAudio(); setSaved(false); if (text) setMessages(history);
    await task(async () => {
      let next: Message[];
      if (preview) {
        if (captured) throw new Error('Preview recordings are discarded. Use a sample prompt or type to explore coaching.');
        await new Promise(resolve => setTimeout(resolve, 500));
        next = [...history, { id: crypto.randomUUID(), role: 'assistant', content: previewReply(history, mode) }];
      } else {
        const result = await api<{ text: string; reply: string; speech: string | null; message_id: string; used: number; limit: number }>('coach', {
          messages: history.slice(-22).map(item => ({ role: item.role, content: item.content })), mode, scenario, coach: sessionCoach,
          spoken: true, voice_consent: profile.voice_consent, ...(captured || {}),
        });
        if (generation !== sessionGeneration.current) return;
        next = [...history, ...(captured ? [{ id: crypto.randomUUID(), role: 'user' as const, content: result.text }] : []), { id: result.message_id, role: 'assistant', content: result.reply }];
        setAccess(current => ({ ...current, used: result.used, limit: result.limit }));
        if (result.speech) {
          if (!document.hidden && screenRef.current === 'conversation') playSpeech(result.speech, result.message_id);
        } else if (!muted) notify('Spoken audio is temporarily unavailable. Open captions to read the reply.');
      }
      if (generation !== sessionGeneration.current) return;
      setMessages(next);
      if (profileRef.current.save_transcripts) {
        try { await saveSession(next, true); } catch (error) { notify(`Your reply is ready, but saving failed. ${error instanceof Error ? error.message : 'Try saving from the recap.'}`); }
      }
    });
  }
  const sendRef = useRef(send); sendRef.current = send;
  async function beginRecording() {
    if (busy || liveBusy) return;
    if (!profileRef.current.voice_consent) { navigate('consent'); return; }
    stopAudio();
    if (!preview) {
      setLiveBusy(true);
      try {
        await reserveLiveTurn(true);
        await ensureLiveSession(true);
        await live.current?.startMicrophone();
        if (liveRecordingTimer.current) clearTimeout(liveRecordingTimer.current);
        liveRecordingTimer.current = setTimeout(() => live.current?.stopMicrophone(), 45_000);
      } catch (error) {
        live.current?.close(); setLiveBusy(false); setRecording(false);
        notify(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone access was denied. Enable it in settings or use text.' : error instanceof Error ? error.message : 'Microphone unavailable.');
      }
      return;
    }
    try {
      const started = await recorder.current.start(captured => { setRecording(false); if (document.hidden || screenRef.current !== 'conversation') return; void sendRef.current(undefined, captured); }, error => { setRecording(false); notify(error.message); });
      if (started) setRecording(true);
    } catch (error) { notify(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone access was denied. Enable it in settings or use text.' : error instanceof Error ? error.message : 'Microphone unavailable.'); }
  }
  function toggleVoice() { recorder.current.cancel(); live.current?.stopMicrophone(); setRecording(false); if (!voiceMode && !profile.voice_consent) { setVoiceMode(true); navigate('consent'); } else setVoiceMode(!voiceMode); }
  useEffect(() => {
    if (startVoiceWhenReady.current && screen === 'conversation' && profile.voice_consent && !busy) {
      startVoiceWhenReady.current = false;
      if (!document.hidden) void beginRecording();
    }
  }, [screen, profile.voice_consent, busy]);
  function finishSession() { recorder.current.cancel(); live.current?.close(); if (liveRecordingTimer.current) clearTimeout(liveRecordingTimer.current); setRecording(false); setLiveBusy(false); stopAudio(); navigate('recap'); }
  function loadSessions() { void task(async () => { if (preview) setSessions(readPreviewSessions()); else { const result = await api<{ sessions: SavedSession[] }>('sessions'); setSessions(result.sessions); } }); }
function openSession(item: SavedSession) { clearSpeech(); setSpeechMessageId(null); sessionGeneration.current++; sessionId.current = item.id; setTitle(item.title); setMode(item.mode); setScenario(item.scenario || 'intro'); setSessionCoach(item.coach); setMessages(item.messages.map(message => ({ ...message, id: message.id || crypto.randomUUID() }))); setSaved(true); setVoiceMode(false); navigate('conversation'); }
  function removeSession(id?: string) { void task(async () => { if (preview) { const remaining = id ? readPreviewSessions().filter(item => item.id !== id) : []; localStorage.setItem('rv.preview.sessions.v1', JSON.stringify(remaining)); setSessions(remaining); } else { await api('sessions', id ? { id } : {}, 'DELETE'); setSessions(items => id ? items.filter(item => item.id !== id) : []); } notify('Saved sessions deleted.'); }); }
  function exportData() { void task(async () => { await downloadJson(preview ? { preview: true, profile, sessions: readPreviewSessions() } : await api('account/export')); notify('Your data export is ready.'); }); }
  function report(reason: string, note: string) { void task(async () => { if (preview) { notify('Preview: report form tested. No report was sent.'); navigate('conversation'); return; } await api('reports', { reason, note, message_id: reportMessage?.id, content: reportMessage?.content }); notify('Your report was sent for review. Thank you.'); navigate('conversation'); }); }
  function restore() { void task(async () => { if (preview || !user) { notify('Sign in to your account in the Android app to restore purchases.'); return; } await restorePurchases(user.id); notify('Your purchases were checked with Google Play.'); }); }
  function buy(plan: Plan) { void task(async () => { if (!user || preview) { navigate('login'); return; } await subscribe(plan, user.id); }); }
  function signOut() { void task(async () => { sessionGeneration.current++; clearSpeech(); recorder.current.cancel(); live.current?.close(); setLiveBusy(false); if (!preview && supabase) { const result = await supabase.auth.signOut(); if (result.error) throw result.error; } setUser(null); setPreview(!configured); setProfile({ ...defaultProfile }); setMessages([]); setSessions([]); setAccess(INITIAL_ACCESS); navigate('welcome'); }); }
  async function deleteAccount(password: string) { await task(async () => { clearSpeech(); live.current?.close(); setLiveBusy(false); if (preview) localStorage.removeItem('rv.preview.sessions.v1'); else { await api('account', { confirmation: 'DELETE', password }, 'DELETE'); await supabase?.auth.signOut({ scope: 'local' }); } sessionGeneration.current++; setUser(null); setProfile({ ...defaultProfile }); setSessions([]); setMessages([]); setAccess(INITIAL_ACCESS); setPreview(!configured); deletionReturn.current = false; navigate('welcome'); notify(preview ? 'Preview data cleared.' : 'Your account and app data have been deleted.'); }); }
  const main = MAIN_SCREENS.includes(screen);
  const appAccess = user || preview;
  let content;
  if (loadingProfile && screen !== 'reset-password') content = <Empty icon={<Sparkles className="spin" size={30} />} title="Finding your space…" description="Loading your account and coaching preferences." />;
  else if (profileError && user && screen !== 'reset-password') content = <Empty icon={<ShieldCheck size={32} />} title="Your space couldn’t load." description={profileError}><Button onClick={() => void task(async () => { await loadProfile(); setProfileError(''); })}>Try again</Button><Button variant="quiet" onClick={signOut}>Sign out</Button></Empty>;
  else if (!online && ['conversation', 'consent'].includes(screen) && !preview) content = <Empty icon={<WifiOff size={35} />} title="A moment of quiet." description="Check your connection, then try again."><Button onClick={() => setOnline(navigator.onLine)}>Try again</Button><Button variant="secondary" onClick={() => navigate('home')}>Go home</Button></Empty>;
  else if (AUTH_SCREENS.includes(screen)) content = <AuthScreens key={screen} screen={screen as AuthScreen} navigate={navigate} onAccepted={acceptOnboarding} onPreview={enterPreview} busy={busy} notify={notify} />;
  else if (screen === 'privacy' || screen === 'terms') content = <LegalScreen kind={screen} back={() => navigate(legalReturn.current)} />;
  else if (screen === 'help') content = <HelpScreen back={() => navigate(appAccess ? 'profile' : 'welcome')} navigate={navigate} />;
  else if (screen === 'delete-account') content = <DeleteAccountScreen back={() => navigate(appAccess ? 'account' : 'welcome')} loggedIn={Boolean(user)} preview={preview && profile.age_confirmed} busy={busy} onDelete={deleteAccount} onSignIn={() => { deletionReturn.current = true; navigate('login'); }} />;
  else if (!appAccess) content = <Empty icon={<UserRound size={35} />} title="Your coach is waiting." description="Sign in to your account to continue."><Button onClick={() => navigate('login')}>Sign in</Button></Empty>;
  else if (screen === 'home') content = <HomeScreen name={profile.display_name} coach={profile.coach} access={access} navigate={navigate} start={startConversation} />;
  else if (screen === 'choose-coach') content = <ChooseCoachScreen coach={profile.coach} active={access.active || preview} back={() => navigate('home')} onChoose={coach => { if (coach !== 'wingman' && !access.active && !preview) navigate('premium'); else void task(async () => { await patchProfile({ coach }); }); }} onDone={() => navigate(previousScreen.current === 'profile' ? 'profile' : 'home')} />;
  else if (screen === 'practice') content = <PracticeScreen active={access.active || preview} start={startConversation} navigate={navigate} />;
  else if (screen === 'consent' || screen === 'voice-settings') content = <ConsentScreen busy={busy} back={() => navigate(screen === 'voice-settings' ? 'account' : 'home')} onAllow={() => void task(async () => { await patchProfile({ voice_consent: true }); if (screen === 'voice-settings') navigate('account'); else { startVoiceWhenReady.current = true; navigate('conversation'); } })} onText={() => { setVoiceMode(false); navigate(screen === 'voice-settings' ? 'account' : 'conversation'); }} />;
else if (screen === 'conversation') content = <ConversationScreen title={title} coach={sessionCoach} mode={mode} messages={messages} busy={busy || liveBusy} recording={recording} speaking={speaking} voiceMode={voiceMode} muted={muted} preview={preview} liveVoice={!preview} speechMessageId={speechMessageId} saved={profile.save_transcripts} onSend={text => void send(text)} onRecord={() => void beginRecording()} onStopRecording={() => preview ? recorder.current.stop() : live.current?.stopMicrophone()} onCancelRecording={() => { recorder.current.cancel(); live.current?.close(); setLiveBusy(false); setRecording(false); }} onToggleVoice={toggleVoice} onToggleMute={() => { setMuted(!muted); live.current?.setMuted(!muted); stopAudio(); }} onEnd={finishSession} onReport={message => { setReportMessage(message); navigate('report'); }} onReplay={() => { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().then(() => setSpeaking(true)).catch(() => notify('Voice playback is unavailable.')); } else notify('Live replies play as they arrive. Open captions to read this reply.'); }} />;
  else if (screen === 'recap') content = <RecapScreen messages={messages} saved={saved} busy={busy} save={() => void task(() => saveSession())} back={() => navigate('conversation')} home={() => navigate('home')} />;
  else if (screen === 'sessions') content = <SessionsScreen sessions={sessions} busy={busy} load={loadSessions} open={openSession} remove={removeSession} start={() => startConversation('Let’s talk')} />;
  else if (screen === 'profile') content = <ProfileScreen profile={profile} access={access} preview={preview} email={user?.email} patch={patch} navigate={navigate} signOut={signOut} />;
  else if (screen === 'account') content = <PrivacyAccountScreen profile={profile} patch={patch} navigate={navigate} back={() => navigate('profile')} exportData={exportData} deleteSessions={() => removeSession()} />;
  else if (screen === 'premium') content = <PremiumScreen active={access.active} preview={preview} busy={busy} back={() => navigate(previousScreen.current === 'premium' ? 'home' : previousScreen.current)} buy={buy} restore={restore} navigate={navigate} />;
  else if (screen === 'subscription') content = <SubscriptionScreen access={access} back={() => navigate('profile')} restore={restore} navigate={navigate} busy={busy} />;
  else if (screen === 'report') content = <ReportScreen message={reportMessage} busy={busy} back={() => navigate('conversation')} send={report} />;
  else content = <Empty icon={<Sparkles />} title="Let’s head back." description="Your coaching space is one tap away."><Button onClick={() => navigate('home')}>Go home</Button></Empty>;
  return <div className={`app-shell ${main ? 'main-view' : ''} ${screen === 'conversation' ? 'chat-shell' : ''}`}><aside className="desktop-sidebar"><button className="brand-home" onClick={() => navigate(appAccess ? 'home' : 'welcome')}><Brand /></button><p className="sidebar-tagline">A little courage.<br />A better connection.</p>{appAccess ? <nav aria-label="Main navigation">{[{ id: 'home', name: 'Talk', icon: <Mic /> }, { id: 'practice', name: 'Practice', icon: <Target /> }, { id: 'sessions', name: 'Sessions', icon: <History /> }, { id: 'profile', name: 'You', icon: <UserRound /> }].map(item => <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>{item.icon}{item.name}{screen === item.id ? <span /> : null}</button>)}</nav> : <div className="sidebar-intro"><Sparkles size={24} /><p>Find your words.<br />Keep your spark.</p></div>}<div className="sidebar-bottom"><button className="sidebar-plus" onClick={() => navigate(appAccess ? 'premium' : 'login')}><Crown size={20} /><span>Meet Voice Plus<small>More room to grow.</small></span><ArrowRight size={16} /></button><button className="sidebar-help" onClick={() => navigate('help')}>A little help <ArrowRight size={13} /></button><small>AI coaching for adults 18+</small></div></aside><main className={`app-main ${main ? 'has-tabs' : ''}`} id="main-content">{preview ? <div className="preview-strip"><Sparkles size={12} /><span>PREVIEW · Sample coaching · Payments disabled</span></div> : null}<div className={`screen-container screen-${screen}`}>{content}</div>{preview && screen === 'conversation' && !messages.some(m => m.role === 'user') ? <div className="sample-prompt"><button disabled={busy} onClick={() => void send(mode === 'practice' ? 'Hey, nice to meet you. What brings you here?' : 'I have a date tonight and I’m feeling nervous.')}><Sparkles size={14} /> Try a sample conversation <ArrowRight size={15} /></button></div> : null}{main && appAccess ? <nav className="bottom-tabs" aria-label="Main navigation">{[{ id: 'home', title: 'Talk', icon: <Mic size={21} /> }, { id: 'practice', title: 'Practice', icon: <Target size={21} /> }, { id: 'sessions', title: 'Sessions', icon: <History size={21} /> }, { id: 'profile', title: 'You', icon: <UserRound size={21} /> }].map(item => <button key={item.id} className={screen === item.id ? 'active' : ''} aria-current={screen === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.icon}<span>{item.title}</span></button>)}</nav> : null}</main>{toast ? <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={17} /></button></div> : null}</div>;
}
