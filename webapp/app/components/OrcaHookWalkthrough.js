'use client';

import { useEffect, useState } from 'react';

const STEPS = [
  {
    id: 0,
    label: 'Turn on Advanced',
    cursor: { x: 222, y: 15 },
  },
  {
    id: 1,
    label: 'Process → Others',
    cursor: { x: 220, y: 55 },
  },
  {
    id: 2,
    label: '+ Add plugin → PrusaLapse Slicing Hook',
    cursor: { x: 130, y: 120 },
  },
  {
    id: 3,
    label: 'Save preset',
    cursor: { x: 238, y: 36 },
  },
];

export default function OrcaHookWalkthrough() {
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % STEPS.length);
    }, 2000);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const current = STEPS[activeStep];
  const advancedOn = activeStep >= 0;
  const othersSelected = activeStep >= 1;
  const hookAdded = activeStep >= 2;
  const presetSaved = activeStep === 3;

  return (
    <div className="orca-guide">
      <div className="orca-guide-header">
        <span className="orca-guide-title">Enable in OrcaSlicer</span>
        <button
          type="button"
          className="btn btn-ghost btn-small orca-guide-play-btn"
          onClick={() => setIsPlaying((prev) => !prev)}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>

      <div className="orca-guide-body">
        <div className="orca-mockup" aria-hidden="true">
          <svg viewBox="0 0 260 156" width="100%" height="100%" className="orca-mockup-svg">
            {/* Light OrcaSlicer Panel Frame */}
            <rect x="1" y="1" width="258" height="154" rx="6" fill="#ffffff" stroke="#d1d5db" strokeWidth="1" />

            {/* Top Header Bar: Process + Global/Objects + Advanced Switch */}
            <rect x="8" y="8" width="12" height="12" rx="2" fill="#e6f4f1" />
            <path d="M10,12 L14,10 L18,12 L14,14 Z M10,15 L14,17 L18,15" fill="none" stroke="#009688" strokeWidth="1" />
            <text x="23" y="17" fontSize="8" fill="#1f2937" fontFamily="sans-serif" fontWeight="600">Process</text>

            {/* Global / Objects toggle pill */}
            <rect x="60" y="7" width="60" height="14" rx="7" fill="#e5e7eb" />
            <rect x="61" y="8" width="29" height="12" rx="6" fill="#009688" />
            <text x="67" y="16.5" fontSize="6.5" fill="#ffffff" fontFamily="sans-serif" fontWeight="600">Global</text>
            <text x="93" y="16.5" fontSize="6.5" fill="#4b5563" fontFamily="sans-serif">Objects</text>

            {/* OrcaSlicer Teal Advanced Switch */}
            <rect
              x="206"
              y="8"
              width="30"
              height="13"
              rx="6.5"
              fill={advancedOn ? '#009688' : '#cbd5e1'}
              stroke={activeStep === 0 ? '#0f766e' : 'none'}
              strokeWidth="1.2"
            />
            <circle cx={advancedOn ? 229.5 : 212.5} cy="14.5" r="4.5" fill="#ffffff" className="orca-anim-prop" />
            <circle cx="212" cy="14.5" r="1.1" fill="#e6f4f1" opacity={advancedOn ? 0.9 : 0} />
            <circle cx="217" cy="14.5" r="1.1" fill="#e6f4f1" opacity={advancedOn ? 0.9 : 0} />
            <text x="171" y="17" fontSize="6.2" fill={activeStep === 0 ? '#009688' : '#6b7280'} fontFamily="sans-serif" fontWeight={activeStep === 0 ? '700' : '500'}>
              Advanced
            </text>

            {/* Preset Dropdown Row + Save Disk Icon */}
            <rect x="8" y="27" width="218" height="18" rx="3" fill="#ffffff" stroke="#d1d5db" strokeWidth="1" />
            <path d="M14,34.5 L17,37.5 L20,34.5" fill="none" stroke="#6b7280" strokeWidth="1.1" />
            <text x="24" y="38.5" fontSize="7.3" fill="#1f2937" fontFamily="sans-serif">
              0.20mm Standard @MK4S{hookAdded && !presetSaved ? ' *' : ''}
            </text>

            {/* Floppy Disk Save Icon */}
            <rect
              x="230"
              y="27"
              width="18"
              height="18"
              rx="3"
              fill={presetSaved ? '#e6f4f1' : '#f8fafc'}
              stroke={presetSaved ? '#009688' : '#d1d5db'}
              strokeWidth={presetSaved ? '1.4' : '1'}
            />
            <rect x="234" y="31" width="10" height="10" rx="1" fill="none" stroke={presetSaved ? '#009688' : '#4b5563'} strokeWidth="1.1" />
            <rect x="236.5" y="31" width="5" height="3.5" fill="none" stroke={presetSaved ? '#009688' : '#4b5563'} strokeWidth="0.9" />

            {/* Tabs Bar */}
            <line x1="8" y1="62" x2="252" y2="62" stroke="#e5e7eb" strokeWidth="1" />
            <text x="11" y="57" fontSize="7" fill="#6b7280" fontFamily="sans-serif">Quality</text>
            <text x="45" y="57" fontSize="7" fill="#6b7280" fontFamily="sans-serif">Strength</text>
            <text x="84" y="57" fontSize="7" fill="#6b7280" fontFamily="sans-serif">Speed</text>
            <text x="116" y="57" fontSize="7" fill="#6b7280" fontFamily="sans-serif">Support</text>
            <text x="152" y="57" fontSize="7" fill="#6b7280" fontFamily="sans-serif">Multimaterial</text>
            <text x="206" y="57" fontSize="7.2" fill={othersSelected ? '#111827' : '#6b7280'} fontFamily="sans-serif" fontWeight={othersSelected ? '700' : '500'}>
              Others
            </text>
            {othersSelected && (
              <rect x="204" y="60.5" width="28" height="2" fill="#009688" />
            )}

            {/* Gray context rows (Post-processing Scripts -> Slicing Pipeline Plugin) */}
            <text x="22" y="75" fontSize="7" fill="#9ca3af" fontFamily="sans-serif" fontWeight="600">
              Post-processing Scripts
            </text>
            <rect x="10" y="79" width="240" height="10" rx="2" fill="#f9fafb" stroke="#e5e7eb" strokeWidth="0.8" />

            {/* Section: </> Slicing Pipeline Plugin */}
            <rect x="9" y="95" width="11" height="9" rx="1.5" fill="#e6f4f1" stroke="#009688" strokeWidth="0.8" />
            <text x="10.8" y="101.5" fontSize="5.5" fill="#009688" fontFamily="monospace" fontWeight="700">&lt;/&gt;</text>
            <text x="24" y="102" fontSize="7.6" fill="#111827" fontFamily="sans-serif" fontWeight="700">
              Slicing Pipeline Plugin
            </text>

            {/* + Add plugin / Selected Plugin Card */}
            {hookAdded ? (
              <g>
                <rect x="10" y="109" width="240" height="19" rx="3" fill="#e6f4f1" stroke="#009688" strokeWidth="1.2" />
                <text x="18" y="121" fontSize="7.5" fill="#0f766e" fontFamily="sans-serif" fontWeight="600">
                  ✓ PrusaLapse Slicing Hook
                </text>
                <rect x="10" y="131" width="240" height="15" rx="3" fill="#f3f4f6" stroke="#e5e7eb" strokeWidth="0.9" />
                <text x="108" y="141" fontSize="7" fill="#4b5563" fontFamily="sans-serif">+ Add plugin</text>
              </g>
            ) : (
              <g>
                <rect
                  x="10"
                  y="110"
                  width="240"
                  height="21"
                  rx="3"
                  fill="#f3f4f6"
                  stroke={activeStep === 2 ? '#009688' : '#d1d5db'}
                  strokeWidth={activeStep === 2 ? '1.3' : '1'}
                />
                <text x="106" y="123" fontSize="7.8" fill="#1f2937" fontFamily="sans-serif" fontWeight="500">
                  + Add plugin
                </text>
              </g>
            )}

            {/* Animated Pointer matching OrcaSlicer Teal */}
            <g
              className="orca-mockup-cursor"
              style={{ transform: `translate(${current.cursor.x}px, ${current.cursor.y}px)` }}
            >
              <circle cx="0" cy="0" r="10" fill="rgba(0, 150, 136, 0.22)" />
              <path d="M-2,-2 L9,3 L4,5 L2,10 Z" fill="#009688" stroke="#ffffff" strokeWidth="1" />
            </g>
          </svg>
        </div>

        <div className="orca-guide-checklist" role="tablist" aria-label="OrcaSlicer setup steps">
          {STEPS.map((step) => {
            const isActive = step.id === activeStep;
            return (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`orca-guide-step-row ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  setIsPlaying(false);
                  setActiveStep(step.id);
                }}
              >
                <span className="orca-guide-step-num">{step.id + 1}</span>
                <span>{step.label}</span>
              </button>
            );
          })}
          <div className="orca-guide-hint">Use ASCII .gcode output.</div>
        </div>
      </div>
    </div>
  );
}
