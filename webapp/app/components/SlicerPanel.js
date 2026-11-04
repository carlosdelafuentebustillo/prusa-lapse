'use client';

import { useState, useRef, useEffect } from 'react';
import { parseGcodeForPreview } from './gcodeParser';
import dynamic from 'next/dynamic';
import { saveAs } from 'file-saver';

const GcodePreview3D = dynamic(() => import('./GcodePreview3D'), { ssr: false });

const PRINTER_PRESETS = [
  { name: 'MK4 / MK3.9', x: 240, y: 210, desc: '250×210 bed' },
  { name: 'Core One', x: 245, y: 215, desc: '250×220 bed' },
  { name: 'MINI / MINI+', x: 175, y: 175, desc: '180×180 bed' },
  { name: 'XL', x: 350, y: 350, desc: '360×360 bed' },
];

export default function SlicerPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSnippetPreview, setShowSnippetPreview] = useState(false);
  const [show3DPreview, setShow3DPreview] = useState(false);
  const [parsedGcode, setParsedGcode] = useState(null);
  const [triggerType, setTriggerType] = useState('park');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState(null);
  const [panelStatus, setPanelStatus] = useState(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const fileInputRef = useRef(null);

  const [slicerStatus, setSlicerStatus] = useState({
    installed: false,
    orcaDirectoryFound: false,
    targetDir: null,
    pluginDir: null,
    installing: false,
    message: null,
  });
  const [autoInjectOrcaSlicer, setAutoInjectOrcaSlicer] = useState(true);

  const [config, setConfig] = useState({
    parkX: 240,
    parkY: 210,
    travelSpeed: 9000,
    retractDistance: 0,
    retractSpeed: 2100,
    zHopHeight: 0.4,
    settleTime: 300,
    captureTime: 1500,
    qualityMode: 'balanced',
    triggerSignal: 'm220',
  });

  const fetchSlicerStatus = async () => {
    try {
      const res = await fetch('/api/slicer/status');
      if (res.ok) {
        const data = await res.json();
        setSlicerStatus((prev) => ({
          ...prev,
          ...data,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch OrcaSlicer status:', err);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data?.config?.slicer) {
          if (typeof data.config.slicer.autoInjectOrcaSlicer === 'boolean') {
            setAutoInjectOrcaSlicer(data.config.slicer.autoInjectOrcaSlicer);
          }
          setConfig((prev) => ({
            ...prev,
            ...(data.config.slicer.parkX != null && { parkX: Number(data.config.slicer.parkX) }),
            ...(data.config.slicer.parkY != null && { parkY: Number(data.config.slicer.parkY) }),
            ...(data.config.slicer.zHopHeight != null && { zHopHeight: Number(data.config.slicer.zHopHeight) }),
            ...(data.config.slicer.settleTime != null && { settleTime: Number(data.config.slicer.settleTime) }),
            ...(data.config.slicer.captureTime != null && { captureTime: Number(data.config.slicer.captureTime) }),
          }));
        }
      }
    } catch (err) {
      console.error('Failed to load slicer config:', err);
    }
  };

  useEffect(() => {
    fetchSlicerStatus();
    fetchConfig();
  }, []);

  const handleToggleAutoInject = async (e) => {
    const newVal = e.target.checked;
    setAutoInjectOrcaSlicer(newVal);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slicer: {
            autoInjectOrcaSlicer: newVal,
            parkX: config.parkX,
            parkY: config.parkY,
            zHopHeight: config.zHopHeight,
            settleTime: config.settleTime,
            captureTime: config.captureTime,
          },
        }),
      });
      if (!res.ok) {
        throw new Error('Server returned ' + res.status);
      }
    } catch (err) {
      setAutoInjectOrcaSlicer(!newVal);
      setSlicerStatus((prev) => ({
        ...prev,
        message: { ok: false, text: 'Failed to update auto-injection setting: ' + err.message },
      }));
    }
  };

  const handleInstallPlugin = async () => {
    setSlicerStatus((prev) => ({ ...prev, installing: true, message: null }));
    try {
      const res = await fetch('/api/slicer/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSlicerStatus((prev) => ({
          ...prev,
          installing: false,
          installed: true,
          pluginDir: data.pluginDir || prev.pluginDir,
          message: { ok: true, text: data.message || 'OrcaSlicer plugin installed successfully!' },
        }));
        await fetchSlicerStatus();
      } else {
        setSlicerStatus((prev) => ({
          ...prev,
          installing: false,
          message: { ok: false, text: data.error || 'Failed to install OrcaSlicer plugin.' },
        }));
      }
    } catch (err) {
      setSlicerStatus((prev) => ({
        ...prev,
        installing: false,
        message: { ok: false, text: 'Error installing plugin: ' + err.message },
      }));
    }
  };

  const buildPrusaSlicerSnippet = () => {
    const signalLines =
      config.triggerSignal === 'm221'
        ? [
            'M221 S99 ; Trigger Prusa-lapse capture via flow factor',
            `G4 P${config.captureTime} ; Wait for camera capture`,
            'M221 S100 ; Restore 100% flow',
          ]
        : config.triggerSignal === 'gpio0'
        ? [
            'M264 P0 S1 ; Trigger Hackerboard GPIO',
            'G4 P100 ; Pulse duration',
            'M264 P0 S0 ; Reset GPIO',
            `G4 P${config.captureTime} ; Wait for camera capture`,
          ]
        : config.triggerSignal === 'serial'
        ? [
            'M118 action:capture_photo ; Trigger Serial',
            `G4 P${config.captureTime} ; Wait for camera capture`,
          ]
        : [
            'M220 S99 ; Trigger Prusa-lapse capture via speed factor',
            `G4 P${config.captureTime} ; Wait for camera capture`,
            'M220 S100 ; Restore 100% speed',
          ];

    const lines =
      triggerType === 'snap'
        ? [
            ';AFTER_LAYER_CHANGE',
            ';[layer_z]',
            '{if layer_num > 0}',
            '; --- PRUSA-LAPSE START (Snap In-Place) ---',
            'M83 ; Force relative extrusion mode',
            'M400 ; Wait for layer moves to finish',
            `G4 P${config.settleTime} ; Settle frame vibrations`,
            ...signalLines,
            'G90 ; Set absolute positioning for XYZ',
            'M83 ; CRITICAL: Ensure relative extrusion mode for PrusaSlicer',
            '; --- PRUSA-LAPSE END ---',
            '{endif}',
            '',
          ]
        : [
            ';AFTER_LAYER_CHANGE',
            ';[layer_z]',
            '{if layer_num > 0}',
            '; --- PRUSA-LAPSE START ---',
            'M83 ; Force relative extrusion mode',
            ...(config.retractDistance > 0
              ? [`G1 E-${config.retractDistance} F${config.retractSpeed} ; Extra retract`]
              : []),
            ...(config.zHopHeight > 0
              ? [`G1 Z{layer_z + ${config.zHopHeight}} F1200 ; Z-hop lift above current layer`]
              : []),
            `G1 X${config.parkX} Y${config.parkY} F${config.travelSpeed} ; Park toolhead`,
            'M400 ; Wait for park move to complete',
            `G4 P${config.settleTime} ; Settle frame vibrations`,
            ...signalLines,
            ...(config.zHopHeight > 0
              ? ['G1 Z[layer_z] F1200 ; Restore exact layer Z height']
              : []),
            ...(config.retractDistance > 0
              ? [`G1 E${config.retractDistance} F${config.retractSpeed} ; Un-retract extra`]
              : []),
            'G90 ; Set absolute positioning for XYZ',
            'M83 ; CRITICAL: Restore relative extrusion mode for PrusaSlicer!',
            '; --- PRUSA-LAPSE END ---',
            '{endif}',
            '',
          ];

    return lines.join('\r\n');
  };

  const handleCopySnippet = async () => {
    const textToCopy = buildPrusaSlicerSnippet();
    let success = false;

    // Primary: Modern Async Clipboard API (passes exact CRLF string directly)
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        success = true;
      } catch (e) {
        console.warn('navigator.clipboard.writeText failed, using event fallback:', e);
      }
    }

    // Secondary: copy event listener with clipboardData (preserves CRLF on Windows for LAN HTTP access)
    if (!success && typeof document !== 'undefined') {
      try {
        const listener = (e) => {
          e.clipboardData.setData('text/plain', textToCopy);
          e.preventDefault();
        };
        document.addEventListener('copy', listener);
        success = document.execCommand('copy');
        document.removeEventListener('copy', listener);
      } catch (e) {
        console.warn('execCommand copy listener failed:', e);
      }
    }

    // Tertiary: Fallback via textarea
    if (!success && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        success = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) {
        console.error('All copy fallbacks failed:', e);
      }
    }

    if (success) {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 3000);
    }
  };

  const handleProcessFile = async (selectedFile) => {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();

    if (name.endsWith('.bgcode')) {
      setPanelStatus({
        ok: false,
        message: 'Binary .bgcode files are compressed. Paste the PrusaSlicer Preset snippet into your printer profile so PrusaSlicer injects triggers directly when creating the .bgcode file!'
      });
      return;
    }

    if (!name.endsWith('.gcode')) {
      setPanelStatus({ ok: false, message: 'Please select a .gcode file.' });
      return;
    }

    setIsProcessing(true);
    setParsedGcode(null);
    setShow3DPreview(false);

    try {
      const { processGcode } = await import('./exportGcode');
      const result = await processGcode(selectedFile, config, triggerType);
      saveAs(result.blob, result.outName);
      setLastProcessed({
        inName: selectedFile.name,
        outName: result.outName,
        blob: result.blob,
        outputText: result.outputText,
        layersModified: result.layersModified
      });
    } catch (error) {
      setPanelStatus({ ok: false, message: 'Error processing G-code: ' + error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value,
    }));
  };

  return (
    <div className="panel full-width-panel">
      <h2
        onClick={() => setCollapsed(!collapsed)}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: collapsed ? 0 : '16px',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-color)',
          paddingBottom: collapsed ? 0 : '12px'
        }}
      >
        <span className="panel-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          Timelapse Slicer Setup (OrcaSlicer &amp; PrusaSlicer)
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '6px' }}>
            (Optional — Smart Z works automatically without this)
          </span>
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          {collapsed ? 'Expand' : 'Collapse'}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s ease' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </h2>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Your cameras already capture layer changes automatically via <strong>Smart Z</strong>. Only use one of the options below if you want <strong>Parked-Head Timelapses</strong> (moving the extruder to <code>X{config.parkX} Y{config.parkY}</code> on every layer so the print appears to grow by magic).
          </div>

          {/* OrcaSlicer Native Plugin (v2.5+) Card */}
          <div
            style={{
              background: 'linear-gradient(180deg, rgba(250, 104, 49, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)',
              border: '1px solid rgba(250, 104, 49, 0.35)',
              borderRadius: '10px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  OrcaSlicer Native Plugin (v2.5+)
                </span>
                <span style={{ fontSize: '0.68rem', background: 'rgba(250, 104, 49, 0.15)', color: 'var(--color-orange)', border: '1px solid rgba(250, 104, 49, 0.35)', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>
                  Automated Hook
                </span>
              </div>

              {slicerStatus.installed ? (
                <span style={{ fontSize: '0.72rem', background: 'rgba(46, 204, 113, 0.15)', color: '#2ecc71', border: '1px solid rgba(46, 204, 113, 0.35)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2ecc71' }} />
                  OrcaSlicer Plugin Installed
                </span>
              ) : (
                <span style={{ fontSize: '0.72rem', background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-secondary)', border: '1px solid rgba(255, 255, 255, 0.12)', padding: '2px 8px', borderRadius: '10px', fontWeight: 500 }}>
                  Plugin Not Installed
                </span>
              )}
            </div>

            <p style={{ fontSize: '0.79rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
              Direct integration with OrcaSlicer. Automatically injects toolhead parking moves and camera capture triggers during slice and export — no manual G-code snippet pasting required.
            </p>

            {/* Auto-Injection Toggle & Live Status */}
            <div style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={autoInjectOrcaSlicer}
                    onChange={handleToggleAutoInject}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--color-orange)', cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    Automatic Slicing Injection
                  </span>
                </label>

                {autoInjectOrcaSlicer ? (
                  <span style={{ background: 'rgba(46, 204, 113, 0.15)', color: '#2ecc71', border: '1px solid rgba(46, 204, 113, 0.35)', padding: '2px 9px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2ecc71' }} />
                    Active
                  </span>
                ) : (
                  <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.35)', padding: '2px 9px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }} />
                    Disabled
                  </span>
                )}
              </div>

              <div style={{ fontSize: '0.75rem', color: autoInjectOrcaSlicer ? '#2ecc71' : '#f59e0b', lineHeight: 1.4 }}>
                {autoInjectOrcaSlicer
                  ? 'G-code triggers and parking moves will be automatically injected on slice.'
                  : 'Auto-injection paused. Standard high-speed prints without toolhead parking.'}
              </div>
            </div>

            {/* Plugin Installer Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {slicerStatus.installed ? 'Plugin Integration Ready' : 'Install OrcaSlicer Plugin'}
                </span>
                <span style={{ fontSize: '0.71rem', color: 'var(--text-secondary)', fontFamily: slicerStatus.pluginDir || slicerStatus.targetDir ? 'var(--font-mono)' : 'inherit' }}>
                  {slicerStatus.installed
                    ? `Path: ${slicerStatus.pluginDir || slicerStatus.targetDir}`
                    : slicerStatus.targetDir
                    ? `Target: ${slicerStatus.targetDir}`
                    : 'Copies the plugin bridge into OrcaSlicer user plugins directory.'}
                </span>
              </div>

              <button
                type="button"
                className={`btn btn-small ${slicerStatus.installed ? 'btn-ghost' : 'btn-primary'}`}
                style={{ width: 'auto', padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600 }}
                disabled={slicerStatus.installing}
                onClick={handleInstallPlugin}
              >
                {slicerStatus.installing
                  ? 'Installing Plugin…'
                  : slicerStatus.installed
                  ? 'Reinstall / Update Plugin'
                  : 'Install Plugin into OrcaSlicer'}
              </button>
            </div>

            {/* Plugin Status Message */}
            {slicerStatus.message && (
              <div
                style={{
                  fontSize: '0.76rem',
                  color: slicerStatus.message.ok ? '#2ecc71' : '#ff6b6b',
                  background: slicerStatus.message.ok ? 'rgba(46, 204, 113, 0.1)' : 'rgba(232, 83, 63, 0.12)',
                  border: `1px solid ${slicerStatus.message.ok ? 'rgba(46, 204, 113, 0.35)' : 'rgba(232, 83, 63, 0.35)'}`,
                  padding: '8px 12px',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>{slicerStatus.message.text}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ width: 'auto', padding: '1px 6px', fontSize: '0.7rem' }}
                  onClick={() => setSlicerStatus((prev) => ({ ...prev, message: null }))}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Safety & Format Badges */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '0.72rem', color: '#2ecc71', background: 'rgba(46, 204, 113, 0.08)', border: '1px solid rgba(46, 204, 113, 0.25)', padding: '3px 8px', borderRadius: '5px', fontWeight: 500 }}>
                  ✓ Dynamic Bed Boundary Clamping (Safe for MK4, MK3.9, MINI, XL)
                </span>
                <span style={{ fontSize: '0.72rem', color: '#2ecc71', background: 'rgba(46, 204, 113, 0.08)', border: '1px solid rgba(46, 204, 113, 0.25)', padding: '3px 8px', borderRadius: '5px', fontWeight: 500 }}>
                  ✓ Strict Relative Extrusion (M83) Protected
                </span>
                <span
                  style={{ fontSize: '0.72rem', color: '#60a5fa', background: 'rgba(96, 165, 250, 0.08)', border: '1px solid rgba(96, 165, 250, 0.25)', padding: '3px 8px', borderRadius: '5px', fontWeight: 500 }}
                  title="Binary .bgcode is compressed; OrcaSlicer automatically injects triggers into standard ASCII .gcode or on export."
                >
                  ℹ Binary .bgcode bypass notice
                </span>
              </div>
              <div style={{ fontSize: '0.71rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                ℹ Binary <code>.bgcode</code> files are compressed and cannot be parsed post-slice. OrcaSlicer exports standard ASCII <code>.gcode</code> when using the auto-injection hook.
              </div>
            </div>
          </div>

          {/* Section Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '2px 0', color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.5px' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
            <span>OR MANUAL SLICER SETUP (PRUSASLICER &amp; OTHER SLICERS)</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
          </div>

          {/* 2 Simple Workflow Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {/* Option 1: PrusaSlicer Native Custom G-Code Preset */}
            <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    ⭐ 1. PrusaSlicer Preset (Recommended)
                  </span>
                  <span style={{ fontSize: '0.68rem', background: 'rgba(46,204,113,0.15)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.35)', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>
                    100% Native &amp; .bgcode
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                  Paste once into <strong>Printer Settings → Custom G-code → After layer change G-code</strong>. Works natively across all PrusaSlicer versions and directly exports binary <code>.bgcode</code>!
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`btn btn-small ${copiedSnippet ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '8px 12px', fontSize: '0.78rem' }}
                  onClick={handleCopySnippet}
                >
                  {copiedSnippet ? '✓ Copied to Clipboard!' : 'Copy "After Layer Change" G-Code'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ padding: '8px 10px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}
                  onClick={() => setShowSnippetPreview(v => !v)}
                  title="View or manually select G-code macro text"
                >
                  {showSnippetPreview ? 'Hide Code' : 'View Code'}
                </button>
              </div>

              {showSnippetPreview && (
                <div style={{ marginTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    <span>Macro Preview (Click to Select All):</span>
                    <span>{triggerType === 'snap' ? 'Snap In-Place' : `Park X${config.parkX} Y${config.parkY}`}</span>
                  </div>
                  <textarea
                    readOnly
                    className="input-field"
                    value={buildPrusaSlicerSnippet()}
                    rows={8}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      lineHeight: 1.45,
                      whiteSpace: 'pre',
                      cursor: 'text',
                    }}
                    onClick={(e) => e.target.select()}
                    onCopy={(e) => {
                      e.clipboardData.setData('text/plain', buildPrusaSlicerSnippet());
                      e.preventDefault();
                    }}
                  />
                </div>
              )}
            </div>

            {/* Option 2: Instant 1-Step .gcode Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.length > 0) {
                  handleProcessFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: isDragging ? 'rgba(250,104,49,0.1)' : 'rgba(255,255,255,0.025)',
                border: `1.5px dashed ${isDragging ? 'var(--color-orange)' : 'rgba(255,255,255,0.18)'}`,
                borderRadius: '10px',
                padding: '16px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '10px',
                transition: 'all 0.2s ease'
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files?.length > 0) {
                    handleProcessFile(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
                accept=".gcode"
                style={{ display: 'none' }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    2. Quick .gcode File Drop
                  </span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.12)', padding: '1px 7px', borderRadius: '10px' }}>
                    ASCII .gcode
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                  Drop or click to select a <code>.gcode</code> file — triggers are injected and downloaded immediately in one click.
                </p>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--color-orange)', fontWeight: 600, textAlign: 'center', padding: '6px', background: 'rgba(250,104,49,0.08)', borderRadius: '6px' }}>
                {isProcessing ? 'Injecting triggers…' : 'Drop .gcode here or Click to Browse'}
              </div>
            </div>
          </div>

          {/* Status Banner */}
          {panelStatus && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                background: panelStatus.ok ? 'rgba(46,204,113,0.1)' : 'rgba(232,83,63,0.12)',
                border: `1px solid ${panelStatus.ok ? 'rgba(46,204,113,0.35)' : 'rgba(232,83,63,0.35)'}`,
                color: panelStatus.ok ? '#2ecc71' : '#ff6b6b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <span>{panelStatus.message}</span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                style={{ width: 'auto', padding: '2px 8px', fontSize: '0.72rem' }}
                onClick={() => setPanelStatus(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {lastProcessed && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.28)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', fontSize: '0.8rem' }}>
              <span>
                ✓ Injected <strong>{lastProcessed.layersModified}</strong> layer triggers into <code>{lastProcessed.outName}</code>
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: '0.74rem' }}
                  onClick={() => {
                    if (!show3DPreview && !parsedGcode) {
                      setParsedGcode(parseGcodeForPreview(lastProcessed.outputText));
                    }
                    setShow3DPreview(v => !v);
                  }}
                >
                  {show3DPreview ? 'Hide 3D Preview' : '3D Toolpath Preview'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: '0.74rem' }}
                  onClick={() => saveAs(lastProcessed.blob, lastProcessed.outName)}
                >
                  Download Again
                </button>
              </div>
            </div>
          )}

          {show3DPreview && parsedGcode && (
            <div style={{ marginTop: '4px' }}>
              <GcodePreview3D parsedGcode={parsedGcode} />
            </div>
          )}

          {/* Collapsible Advanced Park Settings */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              style={{ width: 'auto', padding: '4px 10px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}
              onClick={() => setShowAdvanced(s => !s)}
            >
              {showAdvanced
                ? 'Hide Advanced Park Coordinates & Timing'
                : triggerType === 'snap'
                ? `Customize Snap & Timing (${config.captureTime}ms)`
                : `Customize Park Coordinates & Timing (X${config.parkX} Y${config.parkY}, ${config.captureTime}ms)`}
            </button>

            {showAdvanced && (
              <div style={{ marginTop: '14px', padding: '16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Printer Quick Presets */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Printer Presets:
                    </span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {PRINTER_PRESETS.map((p) => {
                        const isMatch = config.parkX === p.x && config.parkY === p.y;
                        return (
                          <button
                            key={p.name}
                            type="button"
                            disabled={triggerType !== 'park'}
                            onClick={() => setConfig(prev => ({ ...prev, parkX: p.x, parkY: p.y }))}
                            className={`btn btn-small ${isMatch && triggerType === 'park' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ padding: '3px 9px', fontSize: '0.72rem', borderRadius: '5px' }}
                            title={`${p.name} (${p.desc}) → X${p.x} Y${p.y}`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {triggerType === 'park' ? `Target: X${config.parkX} Y${config.parkY}` : 'Park disabled (Snap mode)'}
                  </span>
                </div>

                {/* 4x2 Responsive Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
                  <div>
                    <label className="label">Park Mode</label>
                    <select
                      className="input-field"
                      value={triggerType}
                      onChange={(e) => setTriggerType(e.target.value)}
                    >
                      <option value="park">Fixed Corner (X/Y)</option>
                      <option value="snap">Snap to Print (In-Place)</option>
                      <option value="snap-smooth">Smooth Snap (File Drop)</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Trigger Signal</label>
                    <select
                      className="input-field"
                      name="triggerSignal"
                      value={config.triggerSignal}
                      onChange={handleChange}
                    >
                      <option value="m220">M220 S99 (Print Speed — Rec.)</option>
                      <option value="m221">M221 S99 (Flow Factor)</option>
                      <option value="serial">M118 (Serial / UART)</option>
                      <option value="gpio0">M264 (GPIO / Hackerboard)</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">
                      Park X (mm)
                      {triggerType !== 'park' && <span style={{ opacity: 0.6, marginLeft: '4px' }}>(N/A)</span>}
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      name="parkX"
                      value={config.parkX}
                      disabled={triggerType !== 'park'}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="label">
                      Park Y (mm)
                      {triggerType !== 'park' && <span style={{ opacity: 0.6, marginLeft: '4px' }}>(N/A)</span>}
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      name="parkY"
                      value={config.parkY}
                      disabled={triggerType !== 'park'}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="label">Z-Hop (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      className="input-field"
                      name="zHopHeight"
                      value={config.zHopHeight}
                      disabled={triggerType === 'snap'}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="label" title="PrusaSlicer natively retracts before layer change. Keep at 0.0 to prevent double-retraction clogs on Nextruder.">
                      Extra Retract (mm) <span style={{ fontSize: '0.68rem', color: '#2ecc71', fontWeight: 600 }}>[0.0 Rec.]</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      className="input-field"
                      name="retractDistance"
                      value={config.retractDistance}
                      onChange={handleChange}
                      placeholder="0.0 (Rec.)"
                    />
                    {config.retractDistance > 0 && (
                      <div style={{ fontSize: '0.68rem', color: '#ff6b6b', marginTop: '4px', lineHeight: 1.25 }}>
                        ⚠️ Warning: Setting retract causes double-retraction jams on Nextruder (MK4/MK3.9). Set to 0.0 mm.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="label">Settle Time (ms)</label>
                    <input
                      type="number"
                      step="50"
                      min="0"
                      max="3000"
                      className="input-field"
                      name="settleTime"
                      value={config.settleTime}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="label">Capture Wait (ms)</label>
                    <input
                      type="number"
                      step="100"
                      min="100"
                      max="5000"
                      className="input-field"
                      name="captureTime"
                      value={config.captureTime}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                {/* Explanatory Context Footer */}
                <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.5, background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '6px' }}>
                  {triggerType === 'park' ? (
                    <span>
                      💡 <strong>Parked Mode:</strong> Lifts Z by {config.zHopHeight}mm, parks at <code>X{config.parkX} Y{config.parkY}</code>, and pauses {config.settleTime + config.captureTime}ms for capture. Relative extrusion (<code>M83</code>) is strictly locked so PrusaSlicer&apos;s native layer retractions and perimeters extrude 100% reliably.
                    </span>
                  ) : triggerType === 'snap' ? (
                    <span>
                      💡 <strong>Snap to Print:</strong> Nozzle dwells briefly at the exact end of each layer without moving to the corner. Preserves fast print times with zero travel overhead.
                    </span>
                  ) : (
                    <span>
                      💡 <strong>Smooth Snap:</strong> Applies algorithmic motion smoothing between layer points to create smooth panning. <em>Note: Generated through Option 2 (.gcode drop) above.</em>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
