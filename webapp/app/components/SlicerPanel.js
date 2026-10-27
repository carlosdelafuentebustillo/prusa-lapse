'use client';

import { useState, useRef } from 'react';
import { parseGcodeForPreview } from './gcodeParser';
import dynamic from 'next/dynamic';
import { saveAs } from 'file-saver';

const GcodePreview3D = dynamic(() => import('./GcodePreview3D'), { ssr: false });

export default function SlicerPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [show3DPreview, setShow3DPreview] = useState(false);
  const [parsedGcode, setParsedGcode] = useState(null);
  const [triggerType, setTriggerType] = useState('park');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState(null);
  const [panelStatus, setPanelStatus] = useState(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const fileInputRef = useRef(null);

  const [config, setConfig] = useState({
    parkX: 240,
    parkY: 210,
    travelSpeed: 9000,
    retractDistance: 0.8,
    retractSpeed: 2100,
    zHopHeight: 0.4,
    settleTime: 300,
    captureTime: 1200,
    qualityMode: 'balanced',
    triggerSignal: 'm220',
  });

  const buildPrusaSlicerSnippet = () => {
    const signalCmd =
      config.triggerSignal === 'm221'
        ? 'M221 S99 ; Trigger Prusa-lapse capture via flow factor\nG4 P' + config.captureTime + ' ; Wait for camera capture\nM221 S100 ; Restore 100% flow'
        : config.triggerSignal === 'gpio0'
        ? 'M264 P0 S1\nG4 P100\nM264 P0 S0\nG4 P' + config.captureTime
        : config.triggerSignal === 'serial'
        ? 'M118 action:capture_photo\nG4 P' + config.captureTime
        : 'M220 S99 ; Trigger Prusa-lapse capture via speed factor\nG4 P' + config.captureTime + ' ; Wait for camera capture\nM220 S100 ; Restore 100% speed';

    return [
      ';AFTER_LAYER_CHANGE',
      ';[layer_z]',
      '{if layer_num > 0}',
      '; --- PRUSA-LAPSE START ---',
      'M83 ; Relative extrusion',
      `G1 E-${config.retractDistance} F${config.retractSpeed} ; Retract to prevent oozing during park`,
      'G91 ; Relative positioning',
      `G1 Z${config.zHopHeight} F1200 ; Z-hop lift`,
      'G90 ; Absolute positioning',
      `G1 X${config.parkX} Y${config.parkY} F${config.travelSpeed} ; Park toolhead`,
      'M400 ; Wait for park move to complete',
      `G4 P${config.settleTime} ; Settle frame vibrations`,
      signalCmd,
      'G1 Z[layer_z] F1200 ; Restore exact layer Z height',
      `G1 E${config.retractDistance} F${config.retractSpeed} ; Un-retract filament`,
      '; --- PRUSA-LAPSE END ---',
      '{endif}',
    ].join('\n');
  };

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(buildPrusaSlicerSnippet());
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 3000);
    } catch (e) {}
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
          Parked Timelapse Setup (PrusaSlicer Custom G-Code)
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

              <button
                type="button"
                className={`btn btn-small ${copiedSnippet ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', padding: '8px 12px', fontSize: '0.78rem' }}
                onClick={handleCopySnippet}
              >
                {copiedSnippet ? '✓ Copied to Clipboard!' : 'Copy "After Layer Change" G-Code'}
              </button>
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
                : `Customize Park Coordinates & Timing (X${config.parkX} Y${config.parkY}, ${config.captureTime}ms)`}
            </button>

            {showAdvanced && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px', marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Park Mode</label>
                  <select className="input-field" value={triggerType} onChange={(e) => setTriggerType(e.target.value)} style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}>
                    <option value="park">Fixed Corner (X/Y)</option>
                    <option value="snap">Snap to Print</option>
                    <option value="snap-smooth">Smooth Snap</option>
                  </select>
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Signal</label>
                  <select className="input-field" name="triggerSignal" value={config.triggerSignal} onChange={handleChange} style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}>
                    <option value="m220">M220 S99 (Speed)</option>
                    <option value="m221">M221 S99 (Flow)</option>
                    <option value="gpio0">M264 (GPIO)</option>
                    <option value="serial">M118 (Serial)</option>
                  </select>
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Park X (mm)</label>
                  <input type="number" className="input-field" name="parkX" value={config.parkX} onChange={handleChange} style={{ padding: '5px 8px', fontSize: '0.78rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Park Y (mm)</label>
                  <input type="number" className="input-field" name="parkY" value={config.parkY} onChange={handleChange} style={{ padding: '5px 8px', fontSize: '0.78rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Z-Hop (mm)</label>
                  <input type="number" step="0.1" className="input-field" name="zHopHeight" value={config.zHopHeight} onChange={handleChange} style={{ padding: '5px 8px', fontSize: '0.78rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Retract (mm)</label>
                  <input type="number" step="0.1" className="input-field" name="retractDistance" value={config.retractDistance} onChange={handleChange} style={{ padding: '5px 8px', fontSize: '0.78rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Settle (ms)</label>
                  <input type="number" className="input-field" name="settleTime" value={config.settleTime} onChange={handleChange} style={{ padding: '5px 8px', fontSize: '0.78rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '0.72rem' }}>Capture Wait (ms)</label>
                  <input type="number" className="input-field" name="captureTime" value={config.captureTime} onChange={handleChange} style={{ padding: '5px 8px', fontSize: '0.78rem' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
