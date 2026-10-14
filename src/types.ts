export type Coach = 'wingman' | 'bestie' | 'straight';
export type Mode = 'advice' | 'practice';
export type Plan = 'weekly' | 'monthly';
export interface Message { id: string; role: 'user' | 'assistant'; content: string }
export interface Profile {
  display_name: string; coach: Coach; save_transcripts: boolean; spoken_replies: boolean;
  age_confirmed: boolean; terms_version: string | null; voice_consent: boolean;
}
export interface Entitlement { active: boolean; plan: Plan | null; expires_at: string | null; state: string; used: number; limit: number }
export interface SavedSession { id: string; title: string; mode: Mode; coach: Coach; scenario?: string; messages: Message[]; created_at: string }
export const COACHES: { id: Coach; name: string; description: string }[] = [
  { id: 'wingman', name: 'Wingman', description: 'Warm, encouraging, and in your corner.' },
  { id: 'bestie', name: 'Bestie', description: 'Honest advice. Big friend energy.' },
  { id: 'straight', name: 'Straight talk', description: 'Clear, kind, and right to the point.' },
];
export const SCENARIOS = [
  { id: 'intro', title: 'Break the ice', description: 'Make a first hello feel like you.', starter: 'Let’s practice introducing yourself to someone at a coffee shop.', opening: 'Hey, is this seat taken? I feel like everyone here already has a favorite coffee.' },
  { id: 'second', title: 'Ask for a second date', description: 'Show interest without the pressure.', starter: 'Let’s practice asking someone for a second date.', opening: 'I had a really nice time the other night. How has your week been?' },
  { id: 'boundary', title: 'Set a boundary', description: 'Say what you need with confidence.', starter: 'Let’s practice setting a boundary when someone texts too often.', opening: 'Hey, I messaged you a few times yesterday. Everything okay?' },
  { id: 'rejection', title: 'Handle rejection', description: 'Stay grounded. Keep your dignity.', starter: 'Let’s practice responding respectfully to a rejection.', opening: 'I’ve enjoyed getting to know you, but I don’t think we’re a romantic match.' },
];
