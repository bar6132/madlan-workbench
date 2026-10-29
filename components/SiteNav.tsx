'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '/', label: 'בדיקת תלונה' },
  { href: '/deals', label: 'מאגר עסקאות' },
  { href: '/corrections', label: 'תיקונים' },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <nav aria-label="ניווט ראשי" className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-2 sm:px-6">
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {l.label}
            </Link>
          );
        })}
        <div className="ms-auto">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
