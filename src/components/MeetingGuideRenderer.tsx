'use client';

import { parseMarkdown, type ParsedGuide, type Beat, type Tripwire } from '@/lib/formatters/meeting-guide-formatter';

// ── Phase Box ──────────────────────────────────────────────────────

const phaseStyles = {
  start: {
    labelBg: 'bg-teal-700',
    contentBg: 'bg-teal-50',
    contentBorder: 'border-teal-200',
  },
  stay: {
    labelBg: 'bg-blue-800',
    contentBg: 'bg-blue-50',
    contentBorder: 'border-blue-200',
  },
  continue: {
    labelBg: 'bg-purple-700',
    contentBg: 'bg-purple-50',
    contentBorder: 'border-purple-200',
  },
} as const;

function InlineMarkdown({ text }: { text: string }) {
  // Convert **bold** to <strong>, preserving the rest as text
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const boldMatch = part.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          return <strong key={i} className="font-semibold">{boldMatch[1]}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function PhaseBox({ type, label, children }: {
  type: 'start' | 'stay' | 'continue';
  label: string;
  children: React.ReactNode;
}) {
  const s = phaseStyles[type];
  return (
    <div className="mb-4 last:mb-0 rounded-md overflow-hidden">
      <div className={`${s.labelBg} text-white text-xs font-semibold tracking-widest uppercase px-3.5 py-1.5 inline-block rounded-t-md`}>
        {label}
      </div>
      <div className={`${s.contentBg} border ${s.contentBorder} border-t-0 rounded-b-md px-4 py-3 text-[14.5px] leading-[1.7]`}>
        {children}
      </div>
    </div>
  );
}

// ── Beat ───────────────────────────────────────────────────────────

function BeatCard({ beat, isLast }: { beat: Beat; isLast: boolean }) {
  return (
    <>
      <div className="mb-11 last:mb-0">
        {/* Header */}
        <div className="flex items-center gap-4 py-3 mb-2.5">
          <div className="w-10 h-10 rounded-full bg-stone-900 text-stone-50 flex items-center justify-center font-serif text-lg font-bold shrink-0">
            {beat.number}
          </div>
          <div className="flex-1">
            <div className="font-serif text-lg font-semibold leading-tight">
              <InlineMarkdown text={beat.title} />
            </div>
            {beat.goal && (
              <div className="text-sm text-stone-500 italic leading-snug mt-0.5">
                {beat.goal}
              </div>
            )}
          </div>
        </div>

        {/* Goal below header (if needed for spacing) */}
        {beat.goal && <div className="mb-4" />}

        {/* Phases */}
        <div className="ml-14">
          {/* START */}
          <PhaseBox type="start" label="Start">
            <InlineMarkdown text={beat.start} />
          </PhaseBox>

          {/* STAY */}
          <PhaseBox type="stay" label="Stay">
            {beat.stayParagraphs.map((p, i) => (
              <p key={i} className="mb-3 last:mb-0">
                <InlineMarkdown text={p} />
              </p>
            ))}
            {beat.stayScenarios.length > 0 && (
              <ul className="my-3 flex flex-col gap-2.5">
                {beat.stayScenarios.map((s, i) => (
                  <li key={i} className="pl-4 relative">
                    <span className="absolute left-0 text-blue-800 text-xs top-0.5">{'\u25B8'}</span>
                    <strong className="font-semibold text-blue-800">{s.label}</strong>
                    {' \u2014 '}
                    <InlineMarkdown text={s.text} />
                  </li>
                ))}
              </ul>
            )}
            {beat.stallingText && (
              <div className="mt-3.5 pt-3 border-t border-dashed border-blue-300 text-[14.5px]">
                <span className="font-semibold text-amber-700 text-xs uppercase tracking-wide">Stalling:</span>{' '}
                <InlineMarkdown text={beat.stallingText} />
              </div>
            )}
          </PhaseBox>

          {/* CONTINUE */}
          <PhaseBox type="continue" label="Continue">
            <InlineMarkdown text={beat.continue} />
          </PhaseBox>
        </div>
      </div>

      {/* Connector */}
      {!isLast && (
        <div className="w-0.5 h-5 bg-stone-300 ml-[23px]" />
      )}
    </>
  );
}

// ── Tripwire ───────────────────────────────────────────────────────

function TripwireCard({ tripwire }: { tripwire: Tripwire }) {
  return (
    <div className="bg-red-50 border border-red-200 border-l-4 border-l-red-800 rounded-r-md px-5 py-4">
      <div className="text-sm font-bold text-red-800 mb-1.5">
        <InlineMarkdown text={tripwire.name} />.
      </div>
      <div className="text-[14.5px] leading-relaxed mb-1">
        <span className="text-[10px] font-semibold tracking-wide uppercase text-red-800 mr-1">Tell:</span>
        <em className="italic text-stone-500"><InlineMarkdown text={tripwire.tell} /></em>
      </div>
      <div className="text-[14.5px] leading-relaxed">
        <span className="text-[10px] font-semibold tracking-wide uppercase text-red-800 mr-1">Recovery:</span>
        <InlineMarkdown text={tripwire.recovery} />
      </div>
    </div>
  );
}

// ── Section Label ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold tracking-widest uppercase text-stone-500 mb-8 pb-2 border-b border-stone-300">
      {children}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function MeetingGuideRenderer({ markdown }: { markdown: string }) {
  const guide: ParsedGuide = parseMarkdown(markdown);

  return (
    <div className="max-w-[820px] mx-auto px-8 pt-9 pb-14 font-sans text-stone-900 leading-relaxed text-[14.5px]">
      {/* Header */}
      <div className="mb-12 relative">
        <div className="text-xs font-medium tracking-[0.12em] uppercase text-stone-500 mb-1.5">
          Meeting Guide
        </div>
        <h1 className="font-serif text-[32px] font-bold tracking-tight leading-tight">
          {guide.donorName}
        </h1>
        <div className="mt-5 h-0.5 bg-stone-900" />
      </div>

      {/* Setup */}
      {guide.setupGroups.length > 0 && (
        <div className="mb-10">
          <SectionLabel>Setup</SectionLabel>
          <div className="space-y-6">
            {guide.setupGroups.map((group, i) => (
              <div key={i}>
                <div className="text-sm font-bold uppercase tracking-wide text-stone-900 mb-2.5">
                  {group.heading}
                </div>
                <ul className="flex flex-col gap-2">
                  {group.bullets.map((bullet, j) => (
                    <li key={j} className="text-[14.5px] leading-[1.65] pl-4 relative">
                      <span className="absolute left-0 text-stone-400 font-medium">{'\u2014'}</span>
                      <InlineMarkdown text={bullet} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The Arc */}
      {guide.beats.length > 0 && (
        <div className="mb-10">
          <SectionLabel>The Arc</SectionLabel>
          {guide.beats.map((beat, i) => (
            <BeatCard key={i} beat={beat} isLast={i === guide.beats.length - 1} />
          ))}
        </div>
      )}

      {/* Tripwires */}
      {guide.tripwires.length > 0 && (
        <div className="mb-10">
          <SectionLabel>Tripwires</SectionLabel>
          <div className="flex flex-col gap-3">
            {guide.tripwires.map((tw, i) => (
              <TripwireCard key={i} tripwire={tw} />
            ))}
          </div>
        </div>
      )}

      {/* One Line */}
      {guide.oneLine && (
        <div>
          <SectionLabel>One Line</SectionLabel>
          <div className="bg-stone-900 text-stone-50 px-8 py-7 rounded-lg text-center">
            <p className="font-serif text-lg font-semibold leading-relaxed italic tracking-tight">
              {guide.oneLine}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
