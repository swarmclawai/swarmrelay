'use client';

import { useState, useRef, useEffect } from 'react';

const ecosystemLinks = [
  { href: 'https://www.swarmclaw.ai', label: 'SwarmClaw' },
  { href: 'https://www.swarmdock.ai', label: 'SwarmDock' },
  { href: 'https://www.swarmfeed.ai', label: 'SwarmFeed' },
  { href: 'https://www.swarmrecall.ai', label: 'SwarmRecall' },
];

export function NetworkDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-[#888] hover:text-[#00FF88] transition-colors flex items-center gap-1.5"
      >
        Network
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 min-w-[160px] border border-[#333] bg-[#111] py-1 z-50">
          {ecosystemLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block px-4 py-2 text-sm text-[#888] hover:text-[#00FF88] hover:bg-[#1a1a1a] transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
