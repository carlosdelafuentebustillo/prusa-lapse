'use client';

import { useState, useEffect } from 'react';

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
        style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}
      >
        Snapshot unavailable · Click to retry
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
        title="Click to capture a fresh snapshot"
      />
      <div
        className={isRefreshing ? 'refresh-glow' : ''}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: '8px' }}
      />
    </div>
  );
}

export default function CameraCard({
  cleanIp,
  idx,
  cameraSettings,
  updateCameraSetting,
  getCameraVal,
  fetchCameraSettings,
  config,
  addToast
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [cameraNameInput, setCameraNameInput] = useState(getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`));
  const [connectTokenInput, setConnectTokenInput] = useState('');

  const hasSettings = cameraSettings[cleanIp] !== undefined;
  const cameraName = getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`);
  const led = getCameraVal(cleanIp, 'led', 0);
  const brightness = getCameraVal(cleanIp, 'brightness', 0);
  const contrast = getCameraVal(cleanIp, 'contrast', 0);
  const hmirror = getCameraVal(cleanIp, 'hmirror', 0);
  const vflip = getCameraVal(cleanIp, 'vflip', 0);
  const sd_available = getCameraVal(cleanIp, 'sd_available', 0);
  const offline_mode = getCameraVal(cleanIp, 'offline_mode', 0);
  const firmware_version = getCameraVal(cleanIp, 'firmware_version', null);
  const wifi_rssi = getCameraVal(cleanIp, 'wifi_rssi', null);
  const prusa_connect_configured = getCameraVal(cleanIp, 'prusa_connect_configured', 0) === 1;
  const prusa_connect_token = getCameraVal(cleanIp, 'prusa_connect_token', '');
  const prusa_connect_code = getCameraVal(cleanIp, 'last_prusa_connect_code', getCameraVal(cleanIp, 'prusa_connect_code', 0));
  const fingerprint = getCameraVal(cleanIp, 'fingerprint', '');
  const last_z = getCameraVal(cleanIp, 'last_z', -1);
  const printer_state = getCameraVal(cleanIp, 'printer_state', '');
  const job_progress = getCameraVal(cleanIp, 'job_progress', 0);
  const job_name = getCameraVal(cleanIp, 'job_name', '');
  const frame_count = getCameraVal(cleanIp, 'frame_count', 0);

  const cleanJobTitle = job_name
    ? job_name.replace(/\.(bgcode|gcode)$/i, '').split('_0.')[0].replace(/[-_]+/g, ' ')
    : '';

  useEffect(() => {
    setCameraNameInput(getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`));
  }, [cameraSettings, cleanIp, idx]);

  return (
    <div className="camera-tile" key={idx}>
      {/* Compact Header */}
      <div className="camera-tile-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: !hasSettings ? '#666' : printer_state === 'PRINTING' ? 'var(--color-orange)' : '#22c55e',
              boxShadow: hasSettings ? '0 0 8px rgba(34,197,94,0.4)' : 'none'
            }}
            title={hasSettings ? `Online (${cleanIp})` : `Connecting (${cleanIp})`}
          />
          {cameraName}
          {printer_state === 'PRINTING' && (
            <span
              style={{ fontSize: '0.7rem', background: 'rgba(250,104,49,0.16)', color: 'var(--color-orange)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={job_name || 'Printing'}
            >
              {cleanJobTitle ? `${cleanJobTitle} · ` : ''}
              {Number(job_progress) > 0 ? `${Math.round(Number(job_progress))}%` : 'Printing'}
              {Number(frame_count) > 0 ? ` · ${frame_count}f` : ''}
            </span>
          )}
        </span>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            className={`btn btn-small ${led === 1 ? 'btn-primary' : led === 2 ? 'btn-secondary' : 'btn-ghost'}`}
            style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', gap: '4px' }}
            onClick={() => updateCameraSetting(cleanIp, 'led', led === 2 ? 1 : led === 1 ? 0 : 2)}
            disabled={!hasSettings}
            title="Cycle Flash Mode (Auto / On / Off)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={led === 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {led === 2 ? 'Auto' : led === 1 ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            className={`btn btn-small ${showSettings ? 'btn-secondary' : 'btn-ghost'}`}
            style={{ width: 'auto', padding: '4px 8px', fontSize: '0.72rem' }}
            onClick={() => setShowSettings(s => !s)}
            title="Camera Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="video-player-container" style={{ background: '#000', borderRadius: '8px', overflow: 'hidden', minHeight: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', margin: 0 }}>
        <SnapshotImage ip={cleanIp} idx={idx} />
      </div>

      {/* Collapsible Camera Settings Drawer */}
      {showSettings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
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
              Flip
            </button>
            <button
              className={`btn btn-small ${offline_mode ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, padding: '6px' }}
              onClick={() => updateCameraSetting(cleanIp, 'offline', offline_mode ? 0 : 1)}
              disabled={!hasSettings || !sd_available}
              title={!sd_available ? 'SD Card required for Offline Mode' : 'Save frames to camera SD card autonomously'}
            >
              {offline_mode ? 'SD Mode' : 'RAM Mode'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>
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
                style={{ width: '100%', accentColor: 'var(--color-orange)' }}
                disabled={!hasSettings}
              />
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>
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
                style={{ width: '100%', accentColor: 'var(--color-orange)' }}
                disabled={!hasSettings}
              />
            </div>
          </div>

          {/* Camera Name */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              className="text-input"
              placeholder="Camera Name"
              value={cameraNameInput}
              onChange={(e) => setCameraNameInput(e.target.value)}
              style={{ flex: 1, fontSize: '0.78rem', padding: '5px 8px' }}
              disabled={!hasSettings}
            />
            <button
              className="btn btn-ghost btn-small"
              style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
              disabled={!hasSettings}
              onClick={async () => {
                try {
                  await fetch(`/api/camera/control?ip=${cleanIp}&var=camera_name&name=${encodeURIComponent(cameraNameInput)}`);
                  addToast(`Renamed camera to "${cameraNameInput}"`, 'success');
                  fetchCameraSettings(config.cameraIps);
                } catch (e) {
                  addToast(`Failed to rename: ${e.message}`, 'error');
                }
              }}
            >
              Rename
            </button>
          </div>

          {/* Prusa Connect */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.75rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Prusa Connect</span>
              {prusa_connect_configured && (
                <span style={{ color: (prusa_connect_code === 200 || prusa_connect_code === 204) ? '#22c55e' : 'var(--color-orange)', fontWeight: 600 }}>
                  {(prusa_connect_code === 200 || prusa_connect_code === 204) ? 'Connected' : `Status ${prusa_connect_code}`}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                className="text-input"
                placeholder={prusa_connect_configured ? `Token active (${prusa_connect_token})` : 'Paste Prusa Connect Token'}
                value={connectTokenInput}
                onChange={(e) => setConnectTokenInput(e.target.value)}
                style={{ flex: 1, fontSize: '0.78rem', padding: '5px 8px' }}
                disabled={!hasSettings}
              />
              <button
                className="btn btn-ghost btn-small"
                style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
                disabled={!hasSettings}
                onClick={async () => {
                  const trimmed = connectTokenInput.trim();
                  if (!trimmed || trimmed.includes('*')) {
                    addToast('Please paste a valid Prusa Connect token', 'error');
                    return;
                  }
                  try {
                    await fetch(`/api/camera/control?ip=${cleanIp}&var=prusa_connect_token&token=${encodeURIComponent(trimmed)}`);
                    setConnectTokenInput('');
                    addToast('Prusa Connect token saved', 'success');
                    fetchCameraSettings(config.cameraIps);
                  } catch (e) {
                    addToast(`Failed: ${e.message}`, 'error');
                  }
                }}
              >
                Save
              </button>
            </div>
            {fingerprint && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ID: {fingerprint.slice(0, 12)}…
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ width: 'auto', padding: '2px 8px', fontSize: '0.68rem' }}
                  onClick={() => {
                    navigator.clipboard.writeText(fingerprint);
                    addToast('Fingerprint copied', 'success');
                  }}
                >
                  Copy Fingerprint
                </button>
              </div>
            )}
          </div>

          {/* Compact Footer Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
            <span>{cleanIp}</span>
            <span>{firmware_version || 'FW ?'}{wifi_rssi !== null ? ` · ${wifi_rssi} dBm` : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}
