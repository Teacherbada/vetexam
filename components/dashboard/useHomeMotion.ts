"use client";

import { useEffect, useRef } from 'react';

/** Homepage-only progressive enhancement: one observer, no timers or render loop. */
export default function useHomeMotion(ready: boolean) {
  const root = useRef<HTMLElement>(null);
  const seen = useRef(new WeakSet<Element>());
  useEffect(() => {
    const element = root.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!element || !ready || media.matches || typeof IntersectionObserver === 'undefined') return;
    const pending = new Set<HTMLElement>();
    const show = (target: HTMLElement) => {
      target.dataset.homeMotion = 'shown';
      seen.current.add(target);
      pending.delete(target);
      observer.unobserve(target);
      if (!pending.size) observer.disconnect();
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) show(entry.target as HTMLElement);
    }, { threshold: 0.06 });
    for (const target of element.querySelectorAll<HTMLElement>('[data-home-reveal], .study-progress')) {
      // Data-driven text must remain readable as soon as it arrives.
      if (target.matches('[data-widget="progress"], [data-widget="daily-goal"], [data-widget="achievement"], [data-widget="subjects"], [data-widget="chapter-stats"], [data-widget="weekly-most-missed"]')) continue;
      if (seen.current.has(target)) continue;
      target.dataset.homeMotion = 'pending';
      pending.add(target);
      observer.observe(target);
    }
    // Keyboard users must never focus an element in an unrevealed section.
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('[data-home-reveal]');
      if (target && pending.has(target)) show(target);
    };
    const finish = () => {
      observer.disconnect();
      for (const target of pending) { delete target.dataset.homeMotion; seen.current.add(target); }
      pending.clear();
    };
    const preference = () => { if (media.matches) finish(); };
    element.addEventListener('focusin', focus);
    media.addEventListener('change', preference);
    return () => { finish(); element.removeEventListener('focusin', focus); media.removeEventListener('change', preference); };
  }, [ready]);
  return root;
}
