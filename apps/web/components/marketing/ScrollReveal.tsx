"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}

/**
 * Marketing-site scroll reveal. Same IntersectionObserver-once-then-
 * disconnect approach as components/landing/ScrollReveal.tsx, kept as a
 * separate component (rather than shared) so the two visual systems never
 * cross-import -- see the "mkt-*" comment block in app/globals.css.
 */
export function ScrollReveal({ children, className = "", delayMs = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (delayMs > 0) {
              window.setTimeout(() => setIsVisible(true), delayMs);
            } else {
              setIsVisible(true);
            }
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div ref={ref} className={`mkt-reveal ${isVisible ? "is-visible" : ""} ${className}`}>
      {children}
    </div>
  );
}
