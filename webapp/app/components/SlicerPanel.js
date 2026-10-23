'use client';

import { useState, useRef } from 'react';
import { parseGcodeForPreview } from './gcodeParser';
import dynamic from 'next/dynamic';
import { saveAs } from 'file-saver';

const GcodePreview3D = dynamic(() => import('./GcodePreview3D'), { ssr: false });

export default function SlicerPanel() {
  const [files, setFiles] = useState([]);
  const [parsedGcode, setParsedGcode] = useState(null);
  const [triggerType, setTriggerType] = useState('park'); // 'park', 'snap', or 'snap-smooth'
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [downloadData, setDownloadData] = useState(null);
  const fileInputRef = useRef(null);

  // Configuration state
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

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleFileDropSelect = async (selectedFile) => {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();
    setParsedGcode(null); // Reset
    setDownloadData(null); // Reset
    
    if (name.endsWith('.gcode')) {
      setFiles([selectedFile]);
      // Parse immediately for 3D preview
      const text = await selectedFile.text();
      setParsedGcode(parseGcodeForPreview(text));
    } else if (name.endsWith('.bgcode')) {
      alert('Binary G-code (.bgcode) is not supported by Prusa-lapse. Please disable "Supports binary G-code" in PrusaSlicer settings and export as standard ASCII G-code.');
    } else {
      alert('Please upload a valid .gcode file.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileDropSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileDropSelect(e.target.files[0]);
    }
  };

  const handleExport = async () => {
    if (files.length === 0) return;
    setIsExporting(true);
    try {
      const { processGcode } = await import('./exportGcode');
      const result = await processGcode(files[0], config, triggerType);
      
      setParsedGcode(parseGcodeForPreview(result.outputText));
      setDownloadData({
        blob: result.blob,
        outName: result.outName,
        layersModified: result.layersModified
      });
    } catch (error) {
      console.error(error);
      alert('Error processing file: ' + error.message);
    } finally {
      setIsExporting(false);
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
    <div className="panel full-width-panel" style={{ marginTop: '20px' }}>
      <h2>
        <span className="panel-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          G-Code Post-Processor
        </span>
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div>
          <h3>1. Upload G-Code</h3>
          <p className="subtitle" style={{ marginBottom: '1rem' }}>Upload `.gcode` to inject Prusa-lapse triggers.</p>
          <div 
            className={`drop-zone ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ 
              border: `2px dashed ${isDragging ? '#FA6831' : '#444'}`, 
              borderRadius: '8px', 
              padding: '2rem', 
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragging ? 'rgba(250, 104, 49, 0.1)' : 'transparent',
              transition: 'all 0.3s ease'
            }}
            onClick={() => fileInputRef.current.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              accept=".gcode" 
              style={{ display: 'none' }} 
            />
            {files.length > 0 ? (
              <div>
                <div style={{ color: '#FA6831', fontSize: '2.5rem', marginBottom: '0.5rem' }}>&#128196;</div>
                <h4 style={{ margin: 0 }}>{files.length} file{files.length !== 1 ? 's' : ''} loaded</h4>
                <p style={{ color: '#888', marginTop: '0.2rem', fontSize: '0.8rem' }}>Click or drag to add more</p>
              </div>
            ) : (
              <div>
                <div style={{ color: '#444', fontSize: '2.5rem', marginBottom: '0.5rem' }}>&#8681;</div>
                <h4 style={{ margin: 0 }}>Drag & Drop .gcode here</h4>
                <p style={{ color: '#888', marginTop: '0.2rem', fontSize: '0.8rem' }}>or click to browse</p>
              </div>
            )}
          </div>
        </div>

        <div style={{ transition: 'opacity 0.3s' }}>
          <h3>2. Configure Trigger</h3>

          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label className="label">Trigger Mode</label>
              <select 
                className="input-field" 
                value={triggerType} 
                onChange={(e) => setTriggerType(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="park">Standard Park (Fixed X/Y)</option>
                <option value="snap">Snap to Print (Fixed Anchor)</option>
                <option value="snap-smooth">Snap to Print (Smooth / Wandering)</option>
              </select>
            </div>
            
            {(triggerType === 'snap' || triggerType === 'snap-smooth') && (
              <div style={{ flex: 1 }}>
                <label className="label">Quality Mode</label>
                <select 
                   className="input-field" 
                  value={config.qualityMode || 'balanced'} 
                  onChange={handleChange}
                  name="qualityMode"
                  style={{ width: '100%' }}
                >
                  <option value="balanced">Balanced (Prioritize Time)</option>
                  <option value="high">High Quality (Avoid Perimeters)</option>
                </select>
              </div>
            )}

          </div>

          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label className="label">Trigger Signal</label>
              <select 
                className="input-field" 
                name="triggerSignal" 
                value={config.triggerSignal} 
                onChange={handleChange}
                style={{ width: '100%' }}
              >
                <option value="m220">PrusaLink Speed (M220 S99)</option>
                <option value="m221">PrusaLink Flow (M221 S99)</option>
                <option value="gpio0">Hackerboard GPIO (M264 P0 S1)</option>
                <option value="serial">USB Serial (M118)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <label className="label">{triggerType === 'snap' ? 'Target X (mm)' : 'Park X (mm)'}</label>
              <input type="number" className="input-field" name="parkX" value={config.parkX} onChange={handleChange} />
            </div>
            <div>
              <label className="label">{triggerType === 'snap' ? 'Target Y (mm)' : 'Park Y (mm)'}</label>
              <input type="number" className="input-field" name="parkY" value={config.parkY} onChange={handleChange} />
            </div>
            <div>
              <label className="label">Travel (mm/m)</label>
              <input type="number" className="input-field" name="travelSpeed" value={config.travelSpeed} onChange={handleChange} />
            </div>
            <div>
              <label className="label">Z-Hop (mm)</label>
              <input type="number" step="0.1" className="input-field" name="zHopHeight" value={config.zHopHeight} onChange={handleChange} />
            </div>
            <div>
              <label className="label">Retract Dist (mm)</label>
              <input type="number" step="0.1" className="input-field" name="retractDistance" value={config.retractDistance} onChange={handleChange} />
            </div>
            <div>
              <label className="label">Retract Speed (mm/m)</label>
              <input type="number" className="input-field" name="retractSpeed" value={config.retractSpeed} onChange={handleChange} />
            </div>
            <div>
              <label className="label">Settle (ms)</label>
              <input type="number" className="input-field" name="settleTime" value={config.settleTime} onChange={handleChange} />
            </div>
            <div>
              <label className="label">Capture (ms)</label>
              <input type="number" className="input-field" name="captureTime" value={config.captureTime} onChange={handleChange} />
            </div>
          </div>
          
          <button 
            className="btn btn-primary" 
            onClick={handleExport}
            disabled={files.length === 0 || isExporting}
            style={{ width: '100%', marginTop: '1.5rem', padding: '0.8rem', opacity: (files.length === 0 || isExporting) ? 0.5 : 1 }}
          >
            {files.length === 0 ? 'Upload a file to Process' : (isExporting ? 'Processing...' : 'Inject Triggers & Export G-Code')}
          </button>
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', padding: '1rem', background: 'var(--card-bg)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ color: '#aaa' }}>Active {files.length > 1 ? 'Models' : 'Model'}:</span>
            <select className="input-field" style={{ minWidth: '300px' }}>
              {files.map((f, i) => <option key={i}>Uploaded: {f.name}</option>)}
            </select>
            <button 
              className="btn btn-ghost" 
              style={{ fontSize: '0.8rem', padding: '4px 8px', color: '#ff4444' }}
              onClick={() => {
                setFiles([]);
                setParsedGcode(null);
                setDownloadData(null);
              }}
            >
              Clear Uploaded Files
            </button>
          </div>
          {triggerType === 'park' && (
            <div style={{ color: '#888', fontSize: '0.9rem' }}>
              Extruder Position: <span style={{ color: '#2ecc71', fontWeight: 'bold' }}>X{config.parkX} Y{config.parkY}</span>
            </div>
          )}
        </div>
      )}

      {parsedGcode || downloadData ? (
        <div style={{ marginTop: '2rem' }}>
          {parsedGcode && <GcodePreview3D parsedGcode={parsedGcode} />}
          {downloadData && (
            <button 
              className="btn btn-primary"
              onClick={() => saveAs(downloadData.blob, downloadData.outName)}
              style={{ width: '100%', marginTop: '1rem', padding: '1rem', backgroundColor: '#4CAF50' }}
            >
              Download Smart G-Code ({downloadData.layersModified ?? 0} layers injected)
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
