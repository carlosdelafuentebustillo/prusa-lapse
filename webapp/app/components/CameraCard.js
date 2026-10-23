'use client';

import { useState, useEffect } from 'react';

// On-demand snapshot component
function SnapshotImage({ ip, idx }) {
  const [snapshotUrl, setSnapshotUrl] = useState(null);
  const [error, setError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setSnapshotUrl(`http://${ip}/snapshot.jpg?t=${Date.now()}`);
    setError(false);

    const interval = setInterval(() => {
      setSnapshotUrl(`http://${ip}/snapshot.jpg?t=${Date.now()}`);
    }, 10000);

    return () => clearInterval(interval);
  }, [ip]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setSnapshotUrl(`http://${ip}/snapshot.jpg?t=${Date.now()}&fresh=1`);
    setError(false);
  };

  if (error) {
    return (
      <div 
        onClick={handleRefresh}
        style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '0.9rem', cursor: 'pointer' }}
      >
        Snapshot unavailable. Click to retry...
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        src={snapshotUrl}
        alt={`Snapshot Camera ${idx + 1}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
        onClick={handleRefresh}
        onLoad={() => setIsRefreshing(false)}
        onError={() => setError(true)}
      />
      <div 
        className={isRefreshing ? 'refresh-glow' : ''} 
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', borderRadius: '8px' }} 
      />
      <div style={{ position: 'absolute', bottom: '6px', right: '8px', fontSize: '0.6rem', background: 'rgba(0,0,0,0.6)', color: '#aaa', padding: '2px 6px', borderRadius: '4px', pointerEvents: 'none' }}>
        Auto-refreshes every 10s (Click for instant capture)
      </div>
    </div>
  );
}

export default function CameraCard({ cleanIp, idx, cameraSettings, updateCameraSetting, getCameraVal, fetchCameraSettings, config, addToast }) {
  const [cameraNameInput, setCameraNameInput] = useState(getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`));
  const [connectTokenInput, setConnectTokenInput] = useState('');

  const hasSettings = cameraSettings[cleanIp] !== undefined;
  const led = getCameraVal(cleanIp, 'led', 0);
  const brightness = getCameraVal(cleanIp, 'brightness', 0);
  const contrast = getCameraVal(cleanIp, 'contrast', 0);
  const hmirror = getCameraVal(cleanIp, 'hmirror', 0);
  const vflip = getCameraVal(cleanIp, 'vflip', 0);
  const sd_available = getCameraVal(cleanIp, 'sd_available', 0);
  const offline_mode = getCameraVal(cleanIp, 'offline_mode', 0);
  const firmware_version = getCameraVal(cleanIp, 'firmware_version', null);
  const wifi_rssi = getCameraVal(cleanIp, 'wifi_rssi', null);
  const free_heap = getCameraVal(cleanIp, 'free_heap', null);
  const prusa_connect_configured = getCameraVal(cleanIp, 'prusa_connect_configured', 0) === 1;
  const prusa_connect_token = getCameraVal(cleanIp, 'prusa_connect_token', '');
  const prusa_connect_code = getCameraVal(cleanIp, 'last_prusa_connect_code', getCameraVal(cleanIp, 'prusa_connect_code', 0));
  const fingerprint = getCameraVal(cleanIp, 'fingerprint', '');
  const trigger_mode = getCameraVal(cleanIp, 'trigger_mode', 'auto');
  const last_z = getCameraVal(cleanIp, 'last_z', -1);
  const printer_state = getCameraVal(cleanIp, 'printer_state', '');
  const job_progress = getCameraVal(cleanIp, 'job_progress', 0);

  useEffect(() => {
    setCameraNameInput(getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`));
  }, [cameraSettings, cleanIp, idx]);

  return (
    <div className="camera-tile" key={idx}>
      <div className="camera-tile-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-orange)' }}>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Live Preview: {getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`)} ({cleanIp})
        </span>
        {hasSettings && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
            {printer_state === 'PRINTING' && (
              <span style={{ background: 'rgba(34,197,94,0.18)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }} title="Active Timelapse Trigger Mode">
                {trigger_mode === 'gcode' ? 'G-CODE PARK' : 'SMART Z'}{Number(last_z) >= 0 ? ` · Z ${Number(last_z).toFixed(2)}mm` : ''}{Number(job_progress) > 0 ? ` (${Math.round(Number(job_progress))}%)` : ''}
              </span>
            )}
            {firmware_version && (
              <span style={{ background: 'rgba(250,104,49,0.15)', color: 'var(--color-orange)', border: '1px solid rgba(250,104,49,0.3)', padding: '1px 6px', borderRadius: '4px' }} title="Firmware Version">
                {firmware_version}
              </span>
            )}
            {wifi_rssi !== null && (
              <span style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: '4px' }} title="Wi-Fi Signal Strength">
                {wifi_rssi} dBm
              </span>
            )}
            {free_heap !== null && (
              <span style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: '4px' }} title="Free ESP32 Heap Memory">
                {Math.round(Number(free_heap) / 1024)} KB RAM
              </span>
            )}
          </span>
        )}
      </div>
      <div className="video-player-container" style={{ background: '#000', borderRadius: '8px', overflow: 'hidden', minHeight: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', margin: 0 }}>
        <SnapshotImage ip={cleanIp} idx={idx} />
      </div>
      
      {/* Camera Adjustment Controls */}
      <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: '15px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', opacity: hasSettings ? 1 : 0.4, pointerEvents: hasSettings ? 'auto' : 'none', transition: 'opacity 0.3s ease' }}>
        <div style={{ display: 'flex', gap: '10px', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <button 
            className={`btn btn-small ${led === 1 ? 'btn-primary' : (led === 2 ? 'btn-secondary' : 'btn-ghost')}`}
            style={{ flex: 1, padding: '6px', gap: '6px', borderColor: led === 2 ? 'var(--color-orange-glow)' : '' }}
            onClick={() => updateCameraSetting(cleanIp, 'led', led === 2 ? 1 : (led === 1 ? 0 : 2))}
            disabled={!hasSettings}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={led === 1 ? "currentColor" : "none"} stroke={led === 2 ? "var(--color-orange-glow)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {led === 2 ? 'Flash Auto' : (led === 1 ? 'Flash On' : 'Flash Off')}
          </button>
          <button 
            className={`btn btn-small ${hmirror ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, padding: '6px' }}
            onClick={() => updateCameraSetting(cleanIp, 'hmirror', hmirror ? 0 : 1)}
            disabled={!hasSettings}
          >
            Mirror
          </button>
          <button 
            className={`btn btn-small ${vflip ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, padding: '6px' }}
            onClick={() => updateCameraSetting(cleanIp, 'vflip', vflip ? 0 : 1)}
            disabled={!hasSettings}
          >
            Flip Vertically
          </button>
          <button 
            className={`btn btn-small ${offline_mode ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, padding: '6px' }}
            onClick={() => updateCameraSetting(cleanIp, 'offline', offline_mode ? 0 : 1)}
            disabled={!hasSettings || !sd_available}
            title={!sd_available ? 'SD Card required for Offline Mode' : ''}
          >
            {offline_mode ? 'Offline' : 'Online'}
          </button>
        </div>
        
        <div style={{ flex: 1, minWidth: '120px' }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px', opacity: hasSettings ? 0.8 : 0.4 }}>
            <span>Brightness</span>
            <span>{brightness > 0 ? `+${brightness}` : brightness}</span>
          </label>
          <input 
            type="range" 
            min="-2" 
            max="2" 
            value={brightness}
            onChange={(e) => updateCameraSetting(cleanIp, 'brightness', parseInt(e.target.value), true)}
            onPointerUp={(e) => updateCameraSetting(cleanIp, 'brightness', parseInt(e.target.value))}
            onKeyUp={(e) => updateCameraSetting(cleanIp, 'brightness', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--color-orange)' }}
            disabled={!hasSettings}
          />
        </div>
        
        <div style={{ flex: 1, minWidth: '120px' }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px', opacity: hasSettings ? 0.8 : 0.4 }}>
            <span>Contrast</span>
            <span>{contrast > 0 ? `+${contrast}` : contrast}</span>
          </label>
          <input 
            type="range" 
            min="-2" 
            max="2" 
            value={contrast}
            onChange={(e) => updateCameraSetting(cleanIp, 'contrast', parseInt(e.target.value), true)}
            onPointerUp={(e) => updateCameraSetting(cleanIp, 'contrast', parseInt(e.target.value))}
            onKeyUp={(e) => updateCameraSetting(cleanIp, 'contrast', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--color-orange)' }}
            disabled={!hasSettings}
          />
        </div>

        {/* Camera Name */}
        <div style={{ width: '100%', marginTop: '8px', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', marginBottom: '6px', opacity: hasSettings ? 0.9 : 0.4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Camera Name
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="text-input"
              placeholder="Camera Name (e.g. Front View)"
              value={cameraNameInput}
              onChange={(e) => setCameraNameInput(e.target.value)}
              style={{ flex: 1, fontSize: '0.8rem', padding: '6px 10px' }}
              disabled={!hasSettings}
            />
            <button
              className="btn btn-primary btn-small"
              style={{ width: 'auto', padding: '6px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
              disabled={!hasSettings}
              onClick={async () => {
                try {
                  await fetch(`/api/camera/control?ip=${cleanIp}&var=camera_name&name=${encodeURIComponent(cameraNameInput)}`);
                  addToast(`Camera name updated to "${cameraNameInput}"!`, 'success');
                  fetchCameraSettings(config.cameraIps);
                } catch (e) {
                  addToast(`Failed to update name: ${e.message}`, 'error');
                }
              }}
            >
              Save Name
            </button>
          </div>
        </div>

        {/* Prusa Connect Token */}
        <div style={{ width: '100%', marginTop: '8px', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', opacity: hasSettings ? 0.9 : 0.4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Prusa Connect
            </label>
            {prusa_connect_configured && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {(prusa_connect_code === 200 || prusa_connect_code === 204) && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(34,197,94,0.2)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.4)', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }} title="Snapshot accepted by Prusa Connect">
                    CONNECTED ({prusa_connect_code})
                  </span>
                )}
                {(prusa_connect_code === 401 || prusa_connect_code === 403) && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }} title="Prusa Connect rejected authentication. Re-enter token or check camera in Prusa Connect.">
                    AUTH ERROR ({prusa_connect_code})
                  </span>
                )}
                {prusa_connect_code === 301 && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(245,158,11,0.2)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }} title="Redirect received. Update firmware to v1.2.1.">
                    REDIRECT (UPDATE FW)
                  </span>
                )}
                {prusa_connect_code === -1 && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(245,158,11,0.2)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }} title="Failed to connect to camera-service.prusa3d.com">
                    TLS ERROR
                  </span>
                )}
                {prusa_connect_code === 0 && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(250,104,49,0.2)', color: 'var(--color-orange)', border: '1px solid rgba(250,104,49,0.4)', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }}>
                    CONFIGURED
                  </span>
                )}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="text-input"
              placeholder={prusa_connect_configured ? `Active (${prusa_connect_token}) - Enter new token to change` : "Paste token from Prusa Connect"}
              value={connectTokenInput}
              onChange={(e) => setConnectTokenInput(e.target.value)}
              style={{ flex: 1, fontSize: '0.8rem', padding: '6px 10px' }}
              disabled={!hasSettings}
            />
            <button
              className="btn btn-primary btn-small"
              style={{ width: 'auto', padding: '6px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
              disabled={!hasSettings}
              onClick={async () => {
                const trimmed = connectTokenInput.trim();
                if (!trimmed) {
                  addToast('Please enter a token first', 'error');
                  return;
                }
                if (trimmed.includes('*')) {
                  addToast('Cannot save masked token with asterisks. Please paste the real token.', 'error');
                  return;
                }
                try {
                  await fetch(`/api/camera/control?ip=${cleanIp}&var=prusa_connect_token&token=${encodeURIComponent(trimmed)}`);
                  setConnectTokenInput('');
                  addToast(`Prusa Connect token saved for Camera ${idx + 1}!`, 'success');
                  fetchCameraSettings(config.cameraIps);
                } catch (e) {
                  addToast(`Failed to save token: ${e.message}`, 'error');
                }
              }}
            >
              Save Token
            </button>
            {prusa_connect_configured && (
              <button
                className="btn btn-secondary btn-small"
                style={{ width: 'auto', padding: '6px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                disabled={!hasSettings}
                title="Clear Prusa Connect token"
                onClick={async () => {
                  try {
                    await fetch(`/api/camera/control?ip=${cleanIp}&var=prusa_connect_token&token=`);
                    setConnectTokenInput('');
                    addToast(`Prusa Connect token cleared for Camera ${idx + 1}`, 'info');
                    fetchCameraSettings(config.cameraIps);
                  } catch (e) {
                    addToast(`Failed: ${e.message}`, 'error');
                  }
                }}
              >
                Clear
              </button>
            )}
          </div>
          {fingerprint && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Fingerprint: <code style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fingerprint}</code>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                style={{ padding: '2px 8px', fontSize: '0.68rem', width: 'auto' }}
                onClick={() => {
                  navigator.clipboard.writeText(fingerprint);
                  addToast('Fingerprint copied to clipboard!', 'success');
                }}
              >
                Copy
              </button>
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px', opacity: 0.7 }}>
            Get token from Prusa Connect → Camera → Add new other camera
          </div>
        </div>
      </div>
    </div>
  );
}
