"use client";

import { useState } from "react";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";

const FAQS: Array<{ question: string; answer: string }> = [
  {
    question: "What is ChampionsStake?",
    answer:
      "ChampionsStake is a platform for structured competitions and challenges, built around defined formats, tracked performance, and clear rules.",
  },
  {
    question: "How do challenges work?",
    answer:
      "Each challenge has a defined format and rule set before it begins. Status is tracked from entry through to result, so participants always know where a challenge stands.",
  },
  {
    question: "Who can participate?",
    answer:
      "ChampionsStake is designed for competitors who want a structured, performance-based format rather than an open-ended casual match.",
  },
  {
    question: "Which features are currently available?",
    answer:
      "The Platform Status section on this page lists exactly what is available, in development, and coming soon. We update it as the platform evolves.",
  },
  {
    question: "Where can I contact ChampionsStake?",
    answer: "Reach us directly at support@championsstake.app.",
  },
];

function AccordionItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-vv-divider border-b py-5">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="mkt-focus-ring flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="font-exo text-[15px] font-medium text-white">{question}</span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-lg transition-all duration-200 ${
            isOpen ? "rotate-45 text-vv-neon-green" : "text-vv-text-tertiary"
          }`}
        >
          +
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr] pt-3" : "grid-rows-[0fr]"
        }`}
      >
        <p className="text-vv-text-secondary min-h-0 text-sm leading-relaxed">{answer}</p>
      </div>
    </div>
  );
}

export function FAQSection() {
  return (
    <section id="faq" className="mkt-section border-vv-divider border-t px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-3xl">
        <ScrollReveal>
          <p className="font-mono text-vv-neon-green text-xs uppercase tracking-[0.2em]">FAQ</p>
          <h2 className="font-exo mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Questions, answered.
          </h2>
        </ScrollReveal>

        <ScrollReveal delayMs={80}>
          <div className="border-vv-divider mt-10 border-t">
            {FAQS.map((faq) => (
              <AccordionItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
