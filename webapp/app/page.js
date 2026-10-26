'use client';

import { useState, useEffect, useRef } from 'react';
import CameraCard from './components/CameraCard';
import SlicerPanel from './components/SlicerPanel';

const parseSessionDate = (timestamp) => {
  if (!timestamp || timestamp.length < 15) return null;
  const year = parseInt(timestamp.substring(0, 4), 10);
  const month = parseInt(timestamp.substring(4, 6), 10);
  const day = parseInt(timestamp.substring(6, 8), 10);
  const hour = parseInt(timestamp.substring(9, 11), 10);
  const min = parseInt(timestamp.substring(11, 13), 10);
  const sec = parseInt(timestamp.substring(13, 15), 10);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = month - 1;
  const mName = mIdx >= 0 && mIdx < 12 ? months[mIdx] : month;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    monthName: mName,
    month,
    day,
    year,
    hour,
    min,
    sec,
    time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    dateStr,
    timestamp
  };
};

const getSessionDisplayName = (session, dateObj) => {
  if (session?.meta?.modelName) return session.meta.modelName;
  if (session?.jobName) return session.jobName.replace(/\.(bgcode|gcode|gco)$/i, '').replace(/_/g, ' ');
  if (dateObj) return `Print Session · ${dateObj.monthName} ${dateObj.day}`;
  return session?.id || 'Print Session';
};

export default function Home() {
  const [config, setConfig] = useState({ prusaIp: '', prusaApiKey: '', cameraIps: '' });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [compilingStatus, setCompilingStatus] = useState(null);
  const [compileOptions, setCompileOptions] = useState({ fps: 30, quality: 23, filterDark: true });
  const [cameraRotations, setCameraRotations] = useState({ 0: 0, 1: 90 });
  const [activeVideo, setActiveVideo] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [currentSession, setCurrentSession] = useState(null);
  const logBoxRef = useRef(null);
  const [cameraSettings, setCameraSettings] = useState({});
  const [printerOfflineWarning, setPrinterOfflineWarning] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [fetchingSessionId, setFetchingSessionId] = useState(null);
  const [fetchStatus, setFetchStatus] = useState(null);

  const now = new Date();
  const [currentMonthDate, setCurrentMonthDate] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  const [isDetecting, setIsDetecting] = useState(false);
  const [otaCameraIp, setOtaCameraIp] = useState('');
  const [otaFile, setOtaFile] = useState(null);
  const [isUpdatingOta, setIsUpdatingOta] = useState(false);
  const [otaProgress, setOtaProgress] = useState(0);
  const [latestFirmwareInfo, setLatestFirmwareInfo] = useState(null);
  const [useCustomOtaFile, setUseCustomOtaFile] = useState(false);

  const [toasts, setToasts] = useState([]);
  const [confirmModal, setConfirmModal] = useState(null);

  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const showConfirm = (message, onConfirm) => {
    setConfirmModal({ message, onConfirm });
  };

  const handleOtaUpdate = async () => {
    if (!otaCameraIp) return;
    if (useCustomOtaFile && !otaFile) {
      addToast('Please select a custom .bin firmware file.', 'warning');
      return;
    }
    setIsUpdatingOta(true);
    setOtaProgress(0);
    const verText = (!useCustomOtaFile && latestFirmwareInfo?.version) ? ` (${latestFirmwareInfo.version})` : '';
    addToast(`Starting firmware update for ${otaCameraIp}${verText}...`, 'info');

    const formData = new FormData();
    if (useCustomOtaFile && otaFile) {
      formData.append('update', otaFile);
    }

    let currentProgress = 0;
    let fakeProgressInterval = null;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/camera/update?ip=${otaCameraIp}`, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 50);
        currentProgress = percent;
        setOtaProgress(percent);
      }
    };

    xhr.upload.onload = () => {
      fakeProgressInterval = setInterval(() => {
        if (currentProgress < 90) {
          currentProgress += 1;
          setOtaProgress(currentProgress);
        }
      }, 500);
    };

    xhr.onload = () => {
      if (fakeProgressInterval) clearInterval(fakeProgressInterval);
      const success = xhr.status === 200;
      const targetProgress = success ? 100 : 0;
      const step = success ? 2 : -2;

      const endInterval = setInterval(() => {
        currentProgress += step;
        if ((success && currentProgress >= targetProgress) || (!success && currentProgress <= targetProgress)) {
          clearInterval(endInterval);
          setOtaProgress(targetProgress);
          setTimeout(() => {
            setIsUpdatingOta(false);
            if (success) {
              addToast('Firmware updated! Camera is rebooting.', 'success');
              setOtaCameraIp('');
            } else {
              addToast(`Firmware update failed: ${xhr.responseText}`, 'error');
            }
            setOtaProgress(0);
          }, 500);
        } else {
          setOtaProgress(currentProgress);
        }
      }, 20);
    };

    xhr.onerror = () => {
      if (fakeProgressInterval) clearInterval(fakeProgressInterval);
      setIsUpdatingOta(false);
      addToast('Firmware update network error.', 'error');
      setOtaProgress(0);
    };

    xhr.send(formData);
  };

  const handleCameraControl = async (ip, variable, value) => {
    try {
      let url = `/api/camera/control?ip=${ip}&var=${variable}&val=${value}`;
      if (variable === 'offline') {
        url += `&prusa_ip=${encodeURIComponent(config.prusaIp)}&prusa_key=${encodeURIComponent(config.prusaApiKey)}`;
      }
      await fetch(url);
    } catch (e) {
      console.error('Failed to set camera control', e);
    }
  };

  const updateCameraSetting = (ip, variable, value, localOnly = false) => {
    setCameraSettings(prev => {
      const current = prev[ip] || { brightness: 0, contrast: 0, hmirror: 0, vflip: 0 };
      const updated = {
        ...prev,
        [ip]: {
          ...current,
          [variable]: value
        }
      };
      if (variable === 'offline') {
        updated[ip].offline_mode = value;
      } else if (variable === 'prusa_connect_token') {
        updated[ip].prusa_connect_configured = value && value.length > 0 ? 1 : 0;
      }
      return updated;
    });
    if (!localOnly) {
      handleCameraControl(ip, variable, value);
    }
  };

  const getCameraVal = (ip, variable, defaultVal) => {
    const val = cameraSettings[ip]?.[variable];
    return (val !== undefined && val !== null && val !== '') ? val : defaultVal;
  };

  const getCameraDisplayName = (idx) => {
    const ips = config.cameraIps ? config.cameraIps.split('\n').map(i => i.trim()).filter(Boolean) : [];
    const ip = ips[idx];
    if (ip && cameraSettings[ip]?.camera_name) {
      return cameraSettings[ip].camera_name;
    }
    return `Camera ${idx + 1}`;
  };

  const fetchCameraSettings = async (cameraIpsStr) => {
    if (!cameraIpsStr) return;
    const ips = cameraIpsStr.split('\n').map(ip => ip.trim()).filter(ip => ip);
    let anyCameraOffline = false;
    for (const ip of ips) {
      try {
        const res = await fetch(`/api/camera/status?ip=${ip}`);
        if (res.ok) {
          const data = await res.json();
          setCameraSettings(prev => ({
            ...prev,
            [ip]: {
              ...prev[ip],
              brightness: data.brightness ?? 0,
              contrast: data.contrast ?? 0,
              hmirror: data.hmirror ?? 0,
              vflip: data.vflip ?? 0,
              led: data.led ?? 1,
              sd_available: data.sd_available ?? 0,
              offline_mode: data.offline_mode ?? 0,
              prusa_connect_configured: data.prusa_connect_configured ?? 0,
              prusa_connect_token: data.prusa_connect_token ?? '',
              prusa_connect_code: data.prusa_connect_code ?? 0,
              fingerprint: data.fingerprint ?? '',
              camera_name: data.camera_name ?? 'PrusaLapse Camera',
              firmware_version: data.firmware_version ?? prev[ip]?.firmware_version,
            }
          }));
        }
        const statusRes = await fetch(`/api/camera/camera_status?ip=${ip}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setCameraSettings(prev => ({
            ...prev,
            [ip]: {
              ...prev[ip],
              ...statusData
            }
          }));
          if (statusData.last_http_code < 0 && statusData.prusa_ip && statusData.prusa_ip.length > 0) {
            anyCameraOffline = true;
          }
        }
      } catch (e) {
        console.error(`Failed to fetch camera settings for ${ip}`, e);
      }
    }
    setPrinterOfflineWarning(anyCameraOffline);
  };

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.config) {
          const cameraIpsStr = data.config.cameraIps ? data.config.cameraIps.join('\n') : '';
          setConfig({
            prusaIp: data.config.prusaIp || '',
            prusaApiKey: data.config.prusaApiKey || '',
            cameraIps: cameraIpsStr
          });
          fetchCameraSettings(cameraIpsStr);
        }
      });

    fetch('/api/camera/update')
      .then(res => res.json())
      .then(data => {
        if (data && data.available) {
          setLatestFirmwareInfo(data);
        }
      })
      .catch(() => {});

    fetchSessions(true);
  }, []);

  useEffect(() => {
    if (!config.cameraIps) return;
    const cameraSettingsInterval = setInterval(() => {
      fetchCameraSettings(config.cameraIps);
    }, 10000);
    return () => clearInterval(cameraSettingsInterval);
  }, [config.cameraIps]);

  const fetchSessions = (forceRemote = false) => {
    fetch(`/api/sessions${forceRemote === true ? '?remote=true' : ''}`)
      .then(res => res.json())
      .then(data => {
        if (data.sessions) setSessions(data.sessions);
      });
  };

  useEffect(() => {
    const monitorInterval = setInterval(() => {
      fetch('/api/monitor')
        .then(res => res.json())
        .then(data => {
          if (data.logs) setLogs(data.logs);
          setFrameCount(data.frameCount || 0);
          setCurrentSession(data.currentSession || null);
          if (data.isRunning !== undefined) {
            setIsMonitoring(data.isRunning);
          }
          if (data.fetchStatus !== undefined) {
            setFetchStatus(data.fetchStatus);
          }
        })
        .catch(() => {});
    }, 2000);

    const sessionInterval = setInterval(fetchSessions, 5000);

    return () => {
      clearInterval(monitorInterval);
      clearInterval(sessionInterval);
    };
  }, []);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSaveConfig = async (silent = false) => {
    try {
      const cameraIpArray = config.cameraIps.split('\n').map(ip => ip.trim()).filter(ip => ip);
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, cameraIps: cameraIpArray })
      });
      if (res.ok) {
        for (const ip of cameraIpArray) {
          const offlineVal = getCameraVal(ip, 'offline_mode', 1);
          try {
            await fetch(`/api/camera/control?ip=${ip}&var=offline&val=${offlineVal}&prusa_ip=${encodeURIComponent(config.prusaIp)}&prusa_key=${encodeURIComponent(config.prusaApiKey)}`);
          } catch (e) {}
        }
        if (!silent) addToast('Configuration saved!', 'success');
      } else {
        addToast('Failed to save configuration.', 'error');
      }
    } catch (e) {
      addToast(`Failed to save configuration: ${e.message}`, 'error');
    }
  };

  const handleAutoDetect = async () => {
    setIsDetecting(true);
    addToast('Scanning network for devices...', 'info');
    try {
      const res = await fetch('/api/config/discover');
      if (res.ok) {
        const data = await res.json();
        let updatedConfig = { ...config };
        let didUpdate = false;

        if (data.printers && data.printers.length > 0) {
          const firstPrinter = data.printers[0];
          if (updatedConfig.prusaIp !== firstPrinter) {
            updatedConfig.prusaIp = firstPrinter;
            didUpdate = true;
            addToast(`Found Prusa printer at ${firstPrinter}`, 'success');
          }
        }

        if (data.cameras && data.cameras.length > 0) {
          const currentIps = updatedConfig.cameraIps.split('\n').map(ip => ip.trim()).filter(ip => ip);
          const newIps = [...currentIps];
          let addedCount = 0;
          for (const ip of data.cameras) {
            if (!newIps.includes(ip)) {
              newIps.push(ip);
              addedCount++;
            }
          }
          if (addedCount > 0) {
            updatedConfig.cameraIps = newIps.join('\n');
            didUpdate = true;
            addToast(`Discovered ${addedCount} new camera(s)!`, 'success');
          }
        }

        if (didUpdate) {
          setConfig(updatedConfig);
          const cameraIpArray = updatedConfig.cameraIps.split('\n').map(ip => ip.trim()).filter(ip => ip);
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...updatedConfig, cameraIps: cameraIpArray })
          });
          for (const ip of cameraIpArray) {
            const offlineVal = getCameraVal(ip, 'offline_mode', 1);
            try {
              await fetch(`/api/camera/control?ip=${ip}&var=offline&val=${offlineVal}&prusa_ip=${encodeURIComponent(updatedConfig.prusaIp)}&prusa_key=${encodeURIComponent(updatedConfig.prusaApiKey)}`);
            } catch (e) {}
          }
        } else {
          addToast('No new devices found.', 'info');
        }
      } else {
        addToast('Auto-detection failed.', 'error');
      }
    } catch (e) {
      addToast(`Auto-detection failed: ${e.message}`, 'error');
    } finally {
      setIsDetecting(false);
    }
  };

  const toggleMonitoring = async () => {
    if (!isMonitoring) {
      await handleSaveConfig(true);
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });
      if (res.ok) {
        setIsMonitoring(true);
        addToast('Live PC sync started', 'success');
        fetchSessions();
        fetchCameraSettings(config.cameraIps);
      } else {
        addToast('Failed to start live sync', 'error');
      }
    } else {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      if (res.ok) {
        setIsMonitoring(false);
        addToast('Live PC sync stopped', 'info');
        fetchSessions();
      } else {
        addToast('Failed to stop live sync', 'error');
      }
    }
  };

  const handleCompile = async (sessionId, cameraIndex) => {
    setCompilingStatus({ sessionId, cameraIndex });
    const rotation = cameraRotations[cameraIndex] ?? (cameraIndex === 1 ? 90 : 0);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          cameraIndex,
          options: { ...compileOptions, rotation }
        })
      });
      if (res.ok) {
        fetchSessions();
        addToast(`Compiled video for ${getCameraDisplayName(cameraIndex)}!`, 'success');
        setActiveVideo({
          session: sessionId,
          camera: `camera_${cameraIndex}`,
          cameraLabel: getCameraDisplayName(cameraIndex),
          timestamp: Date.now()
        });
      } else {
        const err = await res.json();
        addToast(`Compilation failed: ${err.error}`, 'error');
      }
    } catch (e) {
      addToast(`Compilation failed: ${e.message}`, 'error');
    } finally {
      setCompilingStatus(null);
    }
  };

  const handleRenameSession = async (sessionId) => {
    const trimmed = editingSessionName.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    try {
      const res = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name: trimmed })
      });
      if (res.ok) {
        addToast(`Renamed session to "${trimmed}"`, 'success');
        fetchSessions();
      } else {
        const err = await res.json();
        addToast(`Rename failed: ${err.error}`, 'error');
      }
    } catch (e) {
      addToast(`Rename failed: ${e.message}`, 'error');
    } finally {
      setEditingSessionId(null);
    }
  };

  const handleDeleteSession = (sessionId, title) => {
    showConfirm(
      `Delete "${title || sessionId}"? This removes its captured frames and compiled videos.`,
      async () => {
        try {
          const res = await fetch('/api/sessions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          });
          if (res.ok) {
            fetchSessions();
            addToast('Session deleted', 'success');
            if (activeVideo && activeVideo.session === sessionId) {
              setActiveVideo(null);
            }
          } else {
            const err = await res.json();
            addToast(`Failed to delete: ${err.error}`, 'error');
          }
        } catch (e) {
          addToast(`Failed to delete: ${e.message}`, 'error');
        }
      }
    );
  };

  const handleClearAllSessions = () => {
    showConfirm(
      'Delete ALL local sessions and videos from this computer?',
      async () => {
        try {
          const res = await fetch('/api/sessions/clear', { method: 'DELETE' });
          if (res.ok) {
            fetchSessions();
            addToast('All local sessions cleared', 'success');
            setActiveVideo(null);
          } else {
            const err = await res.json();
            addToast(`Failed: ${err.error}`, 'error');
          }
        } catch (e) {
          addToast(`Failed: ${e.message}`, 'error');
        }
      }
    );
  };

  const handleTestCameras = async () => {
    setIsTesting(true);
    addToast('Running 5-frame camera test...', 'info');
    try {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' })
      });
      if (!res.ok) {
        const err = await res.json();
        addToast(`Test failed: ${err.error}`, 'error');
      } else {
        addToast('Camera test completed! Click Refresh in Sessions to view.', 'success');
        fetchSessions(true);
      }
    } catch (e) {
      addToast(`Test failed: ${e.message}`, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleFetchOffline = async (session) => {
    if (isMonitoring) {
      addToast('Please stop Live Sync first.', 'warning');
      return;
    }
    setFetchingSessionId(session.id);
    addToast('Syncing session from camera SD cards...', 'info');
    try {
      const res = await fetch('/api/offline/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSessionIds: session.remoteSessionIds,
          sessionTimestamp: session.timestamp,
          jobName: session.jobName || session.meta?.displayName || null,
          jobId: session.jobId || session.meta?.jobId || null
        })
      });
      if (res.ok) {
        addToast('Session synced from SD card!', 'success');
        fetchSessions(true);
      } else {
        const err = await res.json();
        addToast(`Sync failed: ${err.error}`, 'error');
        fetchSessions(true);
      }
    } catch (e) {
      addToast(`Sync failed: ${e.message}`, 'error');
    } finally {
      setFetchingSessionId(null);
    }
  };

  const handleWipeSD = async () => {
    showConfirm(
      'Wipe all timelapse files stored on the camera SD cards?',
      async () => {
        try {
          const res = await fetch('/api/offline/wipe', { method: 'POST' });
          if (res.ok) {
            addToast('Camera SD cards wiped.', 'success');
            fetchSessions(true);
          } else {
            const err = await res.json();
            addToast(`Wipe failed: ${err.error}`, 'error');
          }
        } catch (e) {
          addToast(`Wipe failed: ${e.message}`, 'error');
        }
      }
    );
  };

  const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const getFirstDayOfMonth = (year, month) => {
    const day = new Date(year, month - 1, 1).getDay();
    return day === 0 ? 6 : day - 1;
  };

  const generateCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentMonthDate.year, currentMonthDate.month);
    const firstDay = getFirstDayOfMonth(currentMonthDate.year, currentMonthDate.month);
    const prevMonthDate = currentMonthDate.month === 1 ? { month: 12, year: currentMonthDate.year - 1 } : { month: currentMonthDate.month - 1, year: currentMonthDate.year };
    const prevMonthDays = getDaysInMonth(prevMonthDate.year, prevMonthDate.month);

    const days = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, isOtherMonth: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${currentMonthDate.year}-${String(currentMonthDate.month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, isOtherMonth: false, dateStr });
    }
    const remainingCells = 42 - days.length;
    for (let i = 1; i <= remainingCells; i++) {
      days.push({ day: i, isOtherMonth: true });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Check if any camera reports an active print
  const activePrintCamera = Object.values(cameraSettings).find(c => c?.printer_state === 'PRINTING');
  const activePrintName = activePrintCamera?.job_name
    ? activePrintCamera.job_name.replace(/\.(bgcode|gcode|gco)$/i, '').replace(/_/g, ' ')
    : null;

  const renderSessionCard = (session) => {
    const dateObj = parseSessionDate(session.timestamp);
    const title = getSessionDisplayName(session, dateObj);
    const isEditing = editingSessionId === session.id;
    const totalFrames = (session.cameras || []).reduce((sum, c) => sum + (c.frameCount || 0), 0);

    return (
      <div key={session.id} className="session-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Left: Thumbnail + Print Name + Date/Tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: 1 }}>
            {session.hasThumbnail ? (
              <img
                src={`/api/captures?session=${session.id}&file=thumbnail.png`}
                alt={title}
                style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '8px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: '56px', height: '56px', borderRadius: '8px', background: 'rgba(250,104,49,0.08)', border: '1px solid rgba(250,104,49,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--color-orange)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
              {isEditing ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="text-input"
                    value={editingSessionName}
                    onChange={(e) => setEditingSessionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSession(session.id);
                      if (e.key === 'Escape') setEditingSessionId(null);
                    }}
                    autoFocus
                    style={{ padding: '4px 8px', fontSize: '0.9rem', maxWidth: '280px' }}
                  />
                  <button className="btn btn-primary btn-small" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => handleRenameSession(session.id)}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-small" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => setEditingSessionId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.02rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {title}
                  </span>
                  {!session.isRemote && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSessionId(session.id);
                        setEditingSessionName(title);
                      }}
                      title="Rename print session"
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', display: 'inline-flex', opacity: 0.7 }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                  )}
                  {session.meta?.material && (
                    <span style={{ fontSize: '0.68rem', background: 'rgba(250,104,49,0.15)', color: 'var(--color-orange)', border: '1px solid rgba(250,104,49,0.3)', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>
                      {session.meta.material}{session.meta?.layerHeight ? ` · ${session.meta.layerHeight}` : ''}
                    </span>
                  )}
                  {session.isRemote && (
                    <span style={{ fontSize: '0.68rem', background: 'rgba(232,83,63,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(232,83,63,0.3)', padding: '1px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      On Camera SD
                    </span>
                  )}
                </div>
              )}

              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <span>{dateObj ? `${dateObj.monthName} ${dateObj.day}, ${dateObj.year} · ${dateObj.time}` : session.timestamp}</span>
                <span>•</span>
                <span>{session.cameras.length} {session.cameras.length === 1 ? 'camera' : 'cameras'} ({totalFrames} frames)</span>
              </div>
            </div>
          </div>

          {/* Right: Delete button */}
          <button
            className="btn btn-ghost btn-small"
            style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'rgba(232,83,63,0.25)' }}
            onClick={() => handleDeleteSession(session.id, title)}
            title="Delete Session"
          >
            Delete
          </button>
        </div>

        {/* Camera Actions */}
        {session.isRemote ? (
          <div>
            <button
              className="btn btn-primary btn-small"
              onClick={() => handleFetchOffline(session)}
              style={{ width: '100%', position: 'relative', overflow: 'hidden', padding: '9px' }}
              disabled={isMonitoring || fetchingSessionId !== null}
            >
              {fetchingSessionId === session.id && fetchStatus && fetchStatus.isFetching && (
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: 'rgba(0,0,0,0.25)', width: `${fetchStatus.progress}%`, transition: 'width 0.3s ease' }} />
              )}
              <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                {fetchingSessionId === session.id ? (
                  <>
                    <span className="spinner" style={{ width: '14px', height: '14px' }} />
                    {fetchStatus && fetchStatus.isFetching ? `Syncing Camera ${fetchStatus.currentCameraIndex + 1}/${fetchStatus.totalCameras} (${fetchStatus.progress}%)` : 'Syncing from SD...'}
                  </>
                ) : (
                  'Sync Session from Camera SD'
                )}
              </span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
            {session.cameras.map((cam, idx) => {
              const hasVideo = session.videos.includes(`camera_${idx}.mp4`);
              const isThisCompiling = compilingStatus?.sessionId === session.id && compilingStatus?.cameraIndex === idx;
              const camLabel = getCameraDisplayName(idx);

              return (
                <div key={cam.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{camLabel}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cam.frameCount} frames</div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      className="input-field"
                      style={{ width: 'auto', padding: '4px 6px', fontSize: '0.72rem' }}
                      value={cameraRotations[idx] ?? (idx === 1 ? 90 : 0)}
                      onChange={(e) => setCameraRotations(prev => ({ ...prev, [idx]: parseInt(e.target.value, 10) }))}
                      title="Video Rotation"
                    >
                      <option value="0">0°</option>
                      <option value="90">90° CW</option>
                      <option value="270">90° CCW</option>
                      <option value="180">180°</option>
                    </select>

                    {hasVideo && (
                      <button
                        className="btn btn-primary btn-small"
                        style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
                        onClick={() => setActiveVideo({ session: session.id, title, camera: `camera_${idx}`, cameraLabel: camLabel, timestamp: Date.now() })}
                      >
                        Play
                      </button>
                    )}

                    <button
                      className={`btn btn-small ${hasVideo ? 'btn-ghost' : 'btn-secondary'}`}
                      style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
                      disabled={cam.frameCount === 0 || isThisCompiling || !!compilingStatus}
                      onClick={() => handleCompile(session.id, idx)}
                    >
                      {isThisCompiling ? 'Compiling…' : hasVideo ? 'Re-compile' : 'Compile MP4'}
                    </button>

                    {hasVideo && (
                      <a
                        href={`/api/captures?session=${session.id}&file=camera_${idx}.mp4&t=${Date.now()}`}
                        download={`${title.replace(/[^a-z0-9-_]+/gi, '_')}_${camLabel}.mp4`}
                        className="btn btn-ghost btn-small"
                        style={{ width: 'auto', padding: '5px 8px', textDecoration: 'none', fontSize: '0.75rem' }}
                        title="Download MP4"
                      >
                        MP4 ↓
                      </a>
                    )}

                    <a
                      href={`/api/captures/zip?session=${session.id}&camera=camera_${idx}`}
                      className="btn btn-ghost btn-small"
                      style={{ width: 'auto', padding: '5px 8px', textDecoration: 'none', fontSize: '0.75rem', pointerEvents: cam.frameCount === 0 ? 'none' : 'auto', opacity: cam.frameCount === 0 ? 0.4 : 1 }}
                      title="Download RAW Frames ZIP"
                    >
                      ZIP ↓
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      {/* Compact Header */}
      <div className="header" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '14px' }}>
          <img src="/logo.png" alt="Prusa-lapse" className="header-logo" style={{ width: '52px', height: '52px', marginBottom: 0 }} />
          <div style={{ textAlign: 'left' }}>
            <h1 style={{ fontSize: '1.9rem', marginBottom: '2px' }}>Prusa-lapse</h1>
            <p style={{ fontSize: '0.9rem' }}>Dual-Camera 3D Print Timelapse Studio</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid">
        {/* 1. Live Cameras Panel */}
        <div className="panel full-width-panel" style={{ marginTop: 0 }}>
          <h2 style={{ flexWrap: 'wrap', gap: '10px' }}>
            <span className="panel-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Cameras
              {activePrintCamera && (
                <span style={{ fontSize: '0.78rem', background: 'rgba(250,104,49,0.15)', color: 'var(--color-orange)', border: '1px solid rgba(250,104,49,0.35)', padding: '2px 10px', borderRadius: '12px', fontWeight: 600, marginLeft: '6px' }}>
                  Printing: {activePrintName || `Job #${activePrintCamera.job_id}`}
                </span>
              )}
            </span>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className={`btn btn-small ${isMonitoring ? 'btn-danger' : 'btn-ghost'}`}
                onClick={toggleMonitoring}
                disabled={isTesting}
                style={{ width: 'auto', padding: '6px 12px', fontSize: '0.78rem' }}
                title="Stream frames directly from camera RAM to this PC while printing"
              >
                {isMonitoring ? `Stop Live Sync (${frameCount})` : 'Start Live PC Sync'}
              </button>

              <button
                className="btn btn-ghost btn-small"
                onClick={handleTestCameras}
                disabled={isTesting}
                style={{ width: 'auto', padding: '6px 12px', fontSize: '0.78rem' }}
              >
                {isTesting ? 'Testing…' : 'Test Capture'}
              </button>
            </div>
          </h2>

          <div className="cameras-grid">
            {config.cameraIps && config.cameraIps.split('\n').filter(ip => ip.trim()).map((ip, idx) => (
              <CameraCard
                key={idx}
                cleanIp={ip.trim()}
                idx={idx}
                cameraSettings={cameraSettings}
                updateCameraSetting={updateCameraSetting}
                getCameraVal={getCameraVal}
                fetchCameraSettings={fetchCameraSettings}
                config={config}
                addToast={addToast}
              />
            ))}
            {(!config.cameraIps || config.cameraIps.trim() === '') && (
              <div style={{ color: 'var(--text-secondary)', padding: '20px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                No cameras configured yet. Open Settings below to auto-detect cameras.
              </div>
            )}
          </div>
        </div>

        {/* 2. Timelapse Sessions Panel */}
        <div className="panel full-width-panel">
          <h2 style={{ flexWrap: 'wrap', gap: '10px' }}>
            <span className="panel-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              Timelapse Sessions
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                ({sessions.length})
              </span>
            </span>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="input-field"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.75rem' }}
                value={compileOptions.fps}
                onChange={(e) => setCompileOptions(p => ({ ...p, fps: parseInt(e.target.value, 10) }))}
                title="Output Video Framerate"
              >
                <option value="24">24 FPS</option>
                <option value="30">30 FPS</option>
                <option value="60">60 FPS</option>
              </select>

              <button
                className="btn btn-ghost btn-small"
                onClick={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')}
                style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
              >
                {viewMode === 'list' ? 'Calendar View' : 'List View'}
              </button>

              <button
                className="btn btn-secondary btn-small"
                onClick={() => fetchSessions(true)}
                style={{ width: 'auto', padding: '5px 12px', fontSize: '0.75rem' }}
              >
                Check Camera SD
              </button>

              {sessions.length > 0 && (
                <button
                  className="btn btn-ghost btn-small"
                  onClick={handleClearAllSessions}
                  style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem', color: 'var(--color-danger)' }}
                >
                  Clear All
                </button>
              )}
            </div>
          </h2>

          {compilingStatus && (
            <div className="compiler-status-box">
              <span className="spinner" />
              Compiling {getCameraDisplayName(compilingStatus.cameraIndex)} into MP4…
            </div>
          )}

          {activeVideo && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Playing: <strong style={{ color: 'var(--text-primary)' }}>{activeVideo.title || activeVideo.session} ({activeVideo.cameraLabel || activeVideo.camera})</strong>
                </span>
                <button className="btn btn-ghost btn-small" onClick={() => setActiveVideo(null)} style={{ width: 'auto' }}>
                  Close Player
                </button>
              </div>
              <div className="video-player-container">
                <video
                  className="video-player"
                  src={`/api/captures?session=${activeVideo.session}&file=${activeVideo.camera}.mp4&t=${activeVideo.timestamp || ''}`}
                  controls
                  autoPlay
                />
              </div>
            </div>
          )}

          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              No timelapse sessions yet. Start a print on your Prusa printer or click <strong>Check Camera SD</strong> to sync finished prints.
            </div>
          ) : viewMode === 'list' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {sessions.map(session => renderSessionCard(session))}
            </div>
          ) : (
            <>
              {selectedSessionId && sessions.find(s => s.id === selectedSessionId) && (
                <div style={{ marginBottom: '16px' }}>
                  {renderSessionCard(sessions.find(s => s.id === selectedSessionId))}
                </div>
              )}

              <div className="calendar-header-nav">
                <button className="btn btn-ghost btn-small" style={{ width: 'auto' }} onClick={() => setCurrentMonthDate(prev => prev.month === 1 ? { month: 12, year: prev.year - 1 } : { month: prev.month - 1, year: prev.year })}>&lt;</button>
                <div className="calendar-month-title">{monthNames[currentMonthDate.month - 1]} {currentMonthDate.year}</div>
                <button className="btn btn-ghost btn-small" style={{ width: 'auto' }} onClick={() => setCurrentMonthDate(prev => prev.month === 12 ? { month: 1, year: prev.year + 1 } : { month: prev.month + 1, year: prev.year })}>&gt;</button>
              </div>

              <div className="calendar-grid">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="calendar-day-header">{d}</div>
                ))}
                {calendarDays.map((cDay, i) => {
                  const daySessions = cDay.dateStr ? sessions.filter(s => {
                    const dObj = parseSessionDate(s.timestamp);
                    return dObj && dObj.dateStr === cDay.dateStr;
                  }) : [];

                  return (
                    <div key={i} className={`calendar-cell ${cDay.isOtherMonth ? 'other-month' : ''}`}>
                      <div className="calendar-date-number">{cDay.day}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', flex: 1 }}>
                        {daySessions.map(sess => {
                          const sObj = parseSessionDate(sess.timestamp);
                          const pillTitle = getSessionDisplayName(sess, sObj);
                          return (
                            <div
                              key={sess.id}
                              className={`session-pill ${sess.isRemote ? 'offline' : ''} ${selectedSessionId === sess.id ? 'selected' : ''}`}
                              onClick={() => setSelectedSessionId(prev => prev === sess.id ? null : sess.id)}
                              title={`${pillTitle} (${sObj?.time || ''})`}
                            >
                              {pillTitle}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 3. Optional G-Code Post-Processor (Collapsed by default) */}
        <SlicerPanel />

        {/* 4. System Settings & Firmware Panel (Collapsed by default) */}
        <div className="panel full-width-panel">
          <h2
            onClick={() => setConfigCollapsed(!configCollapsed)}
            style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: configCollapsed ? 0 : '20px', borderBottom: configCollapsed ? 'none' : '1px solid var(--border-color)', paddingBottom: configCollapsed ? 0 : '12px' }}
          >
            <span className="panel-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Printer, Cameras & Firmware Settings
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {configCollapsed ? 'Expand' : 'Collapse'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: configCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s ease' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </h2>

          {!configCollapsed && (
            <>
              {printerOfflineWarning && (
                <div style={{ backgroundColor: 'rgba(255,50,50,0.1)', borderLeft: '4px solid #ff4444', padding: '10px 14px', margin: '0 0 16px 0', borderRadius: '4px', color: '#ff4444', fontSize: '0.85rem' }}>
                  One or more cameras cannot reach the PrusaLink printer. Check the printer IP below.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>PrusaLink IP Address</label>
                  <input
                    type="text"
                    placeholder="192.168.1.64"
                    value={config.prusaIp}
                    onChange={(e) => setConfig({ ...config, prusaIp: e.target.value })}
                  />
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>PrusaLink API Key</label>
                  <input
                    type="password"
                    placeholder="Enter API Key"
                    value={config.prusaApiKey}
                    onChange={(e) => setConfig({ ...config, prusaApiKey: e.target.value })}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>Configured Cameras</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {config.cameraIps && config.cameraIps.split('\n').filter(ip => ip.trim()).map((ip, idx) => {
                    const cleanIp = ip.trim();
                    const name = getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`);
                    return (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: '6px' }}>
                        <span>
                          <strong>{name}</strong>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginLeft: '8px' }}>({cleanIp})</span>
                          <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px', color: 'var(--text-secondary)' }}>
                            {getCameraVal(cleanIp, 'firmware_version', 'Unknown')}
                          </span>
                        </span>
                        <button
                          className="btn btn-danger btn-small"
                          style={{ width: 'auto', padding: '4px 8px' }}
                          onClick={() => {
                            const newIps = config.cameraIps.split('\n').filter(i => i.trim() && i.trim() !== cleanIp).join('\n');
                            setConfig({ ...config, cameraIps: newIps });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="Add camera IP (e.g. 192.168.1.38)"
                      id="new-camera-ip"
                      style={{ flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = e.target.value.trim();
                          if (val) {
                            const currentIps = config.cameraIps ? config.cameraIps.split('\n').filter(i => i.trim()) : [];
                            if (!currentIps.includes(val)) {
                              setConfig({ ...config, cameraIps: [...currentIps, val].join('\n') });
                              e.target.value = '';
                            }
                          }
                        }
                      }}
                    />
                    <button
                      className="btn btn-ghost btn-small"
                      style={{ width: 'auto', padding: '0 16px' }}
                      onClick={() => {
                        const input = document.getElementById('new-camera-ip');
                        const val = input.value.trim();
                        if (val) {
                          const currentIps = config.cameraIps ? config.cameraIps.split('\n').filter(i => i.trim()) : [];
                          if (!currentIps.includes(val)) {
                            setConfig({ ...config, cameraIps: [...currentIps, val].join('\n') });
                            input.value = '';
                          }
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
                <button className="btn btn-primary btn-small" style={{ flex: 1, minWidth: '120px', padding: '9px' }} onClick={() => handleSaveConfig(false)}>
                  Save Settings
                </button>
                <button className="btn btn-ghost btn-small" style={{ flex: 1, minWidth: '120px', padding: '9px' }} onClick={handleAutoDetect} disabled={isDetecting}>
                  {isDetecting ? 'Scanning…' : 'Auto-detect Devices'}
                </button>
                <button className="btn btn-ghost btn-small" style={{ width: 'auto', padding: '9px 14px', color: 'var(--color-danger)' }} onClick={handleWipeSD}>
                  Wipe Camera SD Cards
                </button>
              </div>

              {/* OTA Firmware Update */}
              <div className="input-group" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <label style={{ margin: 0 }}>OTA Firmware Update</label>
                  {latestFirmwareInfo && latestFirmwareInfo.available && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Latest build: <strong style={{ color: 'var(--color-orange)' }}>{latestFirmwareInfo.version}</strong> ({latestFirmwareInfo.sizeFormatted})
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    className="text-input"
                    style={{ flex: 1, minWidth: '180px' }}
                    value={otaCameraIp}
                    onChange={(e) => setOtaCameraIp(e.target.value)}
                  >
                    <option value="">Select Camera…</option>
                    {config.cameraIps && config.cameraIps.split('\n').filter(ip => ip.trim()).map((ip, idx) => (
                      <option key={ip} value={ip.trim()}>
                        {getCameraVal(ip.trim(), 'camera_name', `Camera ${idx + 1}`)} ({ip.trim()})
                      </option>
                    ))}
                  </select>

                  {useCustomOtaFile ? (
                    <input
                      type="file"
                      accept=".bin"
                      onChange={(e) => setOtaFile(e.target.files[0])}
                      style={{ flex: 2, minWidth: '180px', color: 'var(--text-primary)' }}
                    />
                  ) : (
                    <div style={{ flex: 2, minWidth: '180px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '7px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                      <span>
                        Auto: <strong style={{ color: 'var(--text-primary)' }}>firmware.bin</strong> {latestFirmwareInfo?.version ? `(${latestFirmwareInfo.version})` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        style={{ width: 'auto', padding: '2px 8px', fontSize: '0.7rem' }}
                        onClick={() => setUseCustomOtaFile(true)}
                      >
                        Custom .bin
                      </button>
                    </div>
                  )}

                  <button
                    className="btn btn-primary btn-small"
                    onClick={handleOtaUpdate}
                    disabled={!otaCameraIp || isUpdatingOta || (useCustomOtaFile && !otaFile)}
                    style={{ width: 'auto', padding: '9px 18px' }}
                  >
                    {isUpdatingOta
                      ? `Updating… ${otaProgress}%`
                      : (!useCustomOtaFile && latestFirmwareInfo?.version ? `Flash ${latestFirmwareInfo.version}` : 'Flash Firmware')}
                  </button>
                </div>
              </div>

              {/* Collapsible System Logs */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: '0.75rem' }}
                  onClick={() => setShowLogs(s => !s)}
                >
                  {showLogs ? 'Hide System Logs' : `Show System Logs (${logs.length})`}
                </button>

                {showLogs && (
                  <div className="log-box" ref={logBoxRef} style={{ marginTop: '10px', height: '180px' }}>
                    {logs.length === 0 ? (
                      <div className="log-placeholder">System logs will appear here</div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className={`log-entry ${log.type}`}>
                          <span className="log-time">[{log.time}]</span> {log.message}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="footer">
        Prusa-lapse &middot; Open Source &middot; MIT License
      </div>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast-card toast-${toast.type}`}>
              <div className="toast-content">{toast.message}</div>
              <button className="toast-close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>
                &times;
              </button>
              <div className="toast-progress" />
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Confirm Action</h3>
            </div>
            <div className="modal-body">{confirmModal.message}</div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmModal(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
