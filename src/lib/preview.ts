import type { Message, Mode } from '../types';
export function previewReply(messages: Message[], mode: Mode): string {
  const text = messages.at(-1)?.content.toLowerCase() || '';
  if (/stalk|force|manipulat|underage|minor|nude/.test(text)) return 'I can help you communicate with respect and confidence. Let’s focus on mutual interest, clear boundaries, and adults who freely choose to connect.';
  if (mode === 'practice') return messages.filter(m => m.role === 'user').length % 2 ? 'That feels natural. I like that you kept it simple. What made you choose this place?' : 'Nice — you gave me something easy to respond to. Try one curious follow-up, then leave a little space for my answer.';
  if (/nerv|date|overthink/.test(text)) return 'A little nervousness means you care. You don’t have to impress them every second. Try one curious question: “What’s something you’ve been looking forward to lately?” Share a little about yourself, too. Aim to see whether you enjoy each other.';
  if (/text|reply|message/.test(text)) return 'Keep it warm and give them something easy to answer. You could say: “That sounds like a good story — tell me more.” Match their pace, and remember that one slow reply doesn’t tell you how someone feels.';
  if (/ask|out|coffee/.test(text)) return 'Be clear and make it easy to say yes or no. Try: “I’ve liked talking with you. Want to grab coffee this weekend?” One honest invitation is enough. If they decline, respect it and give them space.';
  if (/boundar|reject/.test(text)) return 'You can be kind and clear at the same time. Say what you need in one sentence, without turning it into a debate. Their response gives you useful information about whether this connection feels right for you.';
  return 'Let’s slow it down a little. What happened, and what would you like to happen next? We can find a way to say it that sounds like you — clear, warm, and comfortable for both people.';
}
