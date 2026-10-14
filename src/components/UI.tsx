import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronRight, Crown, Loader2, Mic2, Sparkles } from 'lucide-react';
export function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`} aria-label="Rizzmaster Voice"><span>Rizz<span className="brand-accent">master</span><span className="brand-spark"><Sparkles size={14} /></span></span><span className="voice-word"><Mic2 size={12} /> V O I C E</span></div>;
}
export function Button({ children, busy, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
  return <button {...props} disabled={props.disabled || busy} className={`button ${variant} ${className}`}>{busy ? <Loader2 className="spin" size={18} /> : null}{children}</button>;
}
export function Header({ title, subtitle, back, action }: { title?: string; subtitle?: string; back?: () => void; action?: ReactNode }) {
  return <header className="topbar">{back ? <button className="icon-button" aria-label="Go back" onClick={back}><ArrowLeft size={21} /></button> : <Brand small />}{title ? <div className="header-title"><strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}</div> : null}{action || <span className="header-spacer" />}</header>;
}
export function Orb({ active = false, small = false }: { active?: boolean; small?: boolean }) {
  return <div className={`orb ${active ? 'orb-active' : ''} ${small ? 'orb-small' : ''}`}><img src="/voice-orb.png" alt="Luminous pink and violet voice orb" draggable={false} /></div>;
}
export function Row({ icon, title, description, onClick, trailing, danger = false, plus = false }: { icon: ReactNode; title: string; description?: string; onClick?: () => void; trailing?: ReactNode; danger?: boolean; plus?: boolean }) {
  const content = <><span className={`row-icon ${danger ? 'danger-text' : ''}`}>{icon}</span><span className="row-copy"><strong>{title}{plus ? <span className="plus-tag">PLUS</span> : null}</strong>{description ? <small>{description}</small> : null}</span>{trailing || (onClick ? <ChevronRight size={17} className="muted" /> : null)}</>;
  return onClick ? <button className={`row ${danger ? 'danger-row' : ''}`} onClick={onClick}>{content}</button> : <div className="row">{content}</div>;
}
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button className={`toggle ${checked ? 'is-on' : ''}`} role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>;
}
export function Pill({ children, gold = false }: { children: ReactNode; gold?: boolean }) { return <span className={`pill ${gold ? 'pill-gold' : ''}`}>{gold ? <Crown size={12} /> : <span className="status-dot" />}{children}</span>; }
export function PageTitle({ eyebrow, children, description }: { eyebrow?: string; children: ReactNode; description?: string }) {
  return <div className="page-title">{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h1>{children}</h1>{description ? <p>{description}</p> : null}</div>;
}
export function Empty({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{description}</p>{children}</div>;
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) { return <a className="external-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={16} /></a>; }
