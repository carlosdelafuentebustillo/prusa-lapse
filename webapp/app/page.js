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
  
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const mIdx = month - 1;
  const mName = mIdx >= 0 && mIdx < 12 ? months[mIdx] : month;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  return { 
    monthName: mName, 
    month: month, 
    day, 
    year, 
    hour, min, sec, 
    time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    dateStr, 
    timestamp 
  };
};

export default function Home() {
  const [config, setConfig] = useState({ prusaIp: '', prusaApiKey: '', cameraIps: '' });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [compilingStatus, setCompilingStatus] = useState(null);
  const [compileOptions, setCompileOptions] = useState({ fps: 30, quality: 23 });
  const [activeVideo, setActiveVideo] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [currentSession, setCurrentSession] = useState(null);
  const logBoxRef = useRef(null);
  const [cameraSettings, setCameraSettings] = useState({});
  const [printerOfflineWarning, setPrinterOfflineWarning] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [fetchingSessionId, setFetchingSessionId] = useState(null);
  const [fetchStatus, setFetchStatus] = useState(null);
  const [cameraNameInputs, setCameraNameInputs] = useState({});
  
  const now = new Date();
  const [currentMonthDate, setCurrentMonthDate] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  const [isDetecting, setIsDetecting] = useState(false);
  const [connectTokenInputs, setConnectTokenInputs] = useState({});
  const [otaCameraIp, setOtaCameraIp] = useState('');
  const [otaFile, setOtaFile] = useState(null);
  const [isUpdatingOta, setIsUpdatingOta] = useState(false);
  const [otaProgress, setOtaProgress] = useState(0);
  const [latestFirmwareInfo, setLatestFirmwareInfo] = useState(null);
  const [useCustomOtaFile, setUseCustomOtaFile] = useState(false);

  // Toast and Confirmation states
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
      addToast('Please select a custom .bin firmware file or switch back to latest auto-detected firmware.', 'warning');
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
    // Proxy through backend to avoid CORS/PNA mixed-content issues
    xhr.open('POST', `/api/camera/update?ip=${otaCameraIp}`, true);
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // Fast progress to 50% during the actual file upload to the server
        const percent = Math.round((e.loaded / e.total) * 50);
        currentProgress = percent;
        setOtaProgress(percent);
      }
    };

    xhr.upload.onload = () => {
      // Upload finished. ESP32 is flashing/rebooting. Slowly creep to 90%.
      fakeProgressInterval = setInterval(() => {
        if (currentProgress < 90) {
          currentProgress += 1;
          setOtaProgress(currentProgress);
        }
      }, 500); // 1% every 0.5s = ~20 seconds to reach 90%
    };

    xhr.onload = () => {
      if (fakeProgressInterval) clearInterval(fakeProgressInterval);
      
      const success = xhr.status === 200;
      const targetProgress = success ? 100 : 0;
      const step = success ? 2 : -2;
      
      // Animate quickly to the final outcome (100% or 0%)
      const endInterval = setInterval(() => {
        currentProgress += step;
        
        if ((success && currentProgress >= targetProgress) || (!success && currentProgress <= targetProgress)) {
          clearInterval(endInterval);
          setOtaProgress(targetProgress);
          
          setTimeout(() => {
            setIsUpdatingOta(false);
            if (success) {
              addToast(`Firmware updated successfully! Camera is rebooting.`, 'success');
              setOtaCameraIp('');
            } else {
              addToast(`Firmware update failed: ${xhr.responseText}`, 'error');
            }
            setOtaProgress(0);
          }, 500); // Small delay so user sees final 100% or 0%
        } else {
          setOtaProgress(currentProgress);
        }
      }, 20); // very fast animation
    };

    xhr.onerror = () => {
      if (fakeProgressInterval) clearInterval(fakeProgressInterval);
      setIsUpdatingOta(false);
      addToast(`Firmware update network error.`, 'error');
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
      console.error("Failed to set camera control", e);
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
              brightness: data.brightness ?? 0,
              contrast: data.contrast ?? 0,
              hmirror: data.hmirror ?? 0,
              vflip: data.vflip ?? 0,
              led: data.led ?? 1,
              sd_available: data.sd_available ?? 0,
              offline_mode: data.offline_mode ?? 0,
              prusa_connect_configured: data.prusa_connect_configured ?? 0,
              prusa_connect_token: data.prusa_connect_token ?? '',
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
      // Fetch once initially
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

    // Check for latest compiled firmware binary automatically
    fetch('/api/camera/update')
      .then(res => res.json())
      .then(data => {
        if (data && data.available) {
          setLatestFirmwareInfo(data);
        }
      })
      .catch(() => {});
      
    // Fetch sessions once
    fetchSessions();
  }, []);

  // Continuously poll camera settings so if a camera boots up after page load, it enables itself
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
    // Poll logs, run status, and active session status all the time
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
        .catch(err => console.error("Failed to poll monitor", err));
    }, 1000);

    // Poll sessions less frequently to update frame counts in real time
    const sessionInterval = setInterval(fetchSessions, 3000);

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
          try { await fetch(`/api/camera/control?ip=${ip}&var=offline&val=${offlineVal}&prusa_ip=${encodeURIComponent(config.prusaIp)}&prusa_key=${encodeURIComponent(config.prusaApiKey)}`); } catch(e) {}
        }
        if (!silent) addToast('Configuration saved and pushed to cameras!', 'success');
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
            addToast(`Discovered and added ${addedCount} new camera(s)!`, 'success');
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
             try { await fetch(`/api/camera/control?ip=${ip}&var=offline&val=${offlineVal}&prusa_ip=${encodeURIComponent(updatedConfig.prusaIp)}&prusa_key=${encodeURIComponent(updatedConfig.prusaApiKey)}`); } catch(e) {}
          }
        } else if ((!data.cameras || data.cameras.length === 0) && (!data.printers || data.printers.length === 0)) {
          addToast('No devices discovered on the local network.', 'warning');
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
        addToast('Timelapse monitoring started', 'success');
        fetchSessions();
        fetchCameraSettings(config.cameraIps);
      } else {
        addToast('Failed to start monitoring', 'error');
      }
    } else {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      if (res.ok) {
        setIsMonitoring(false);
        addToast('Timelapse monitoring stopped', 'info');
        fetchSessions();
      } else {
        addToast('Failed to stop monitoring', 'error');
      }
    }
  };

  const handleCompile = async (sessionId, cameraIndex) => {
    setCompilingStatus({ sessionId, cameraIndex });
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cameraIndex, options: compileOptions })
      });
      if (res.ok) {
        fetchSessions();
        addToast(`Timelapse compilation complete for Camera ${cameraIndex}!`, 'success');
        // Force the video player to reload if it's currently showing this compiled camera's video
        setActiveVideo(prev => {
          if (prev && prev.session === sessionId && prev.camera === `camera_${cameraIndex}`) {
            return { ...prev, timestamp: Date.now() };
          }
          return prev;
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

  const handleDeleteSession = (sessionId) => {
    showConfirm(
      `Are you sure you want to delete session ${sessionId}? This will permanently delete all captured frames and compiled videos.`,
      async () => {
        try {
          const res = await fetch('/api/sessions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          });
          if (res.ok) {
            fetchSessions();
            addToast('Session deleted successfully', 'success');
            if (activeVideo && activeVideo.session === sessionId) {
              setActiveVideo(null);
            }
          } else {
            const err = await res.json();
            addToast(`Failed to delete session: ${err.error}`, 'error');
          }
        } catch (e) {
          addToast(`Failed to delete session: ${e.message}`, 'error');
        }
      }
    );
  };

  const handleClearAllSessions = () => {
    showConfirm(
      'Are you sure you want to delete ALL sessions? This will permanently delete all captured frames and videos.',
      async () => {
        try {
          const res = await fetch('/api/sessions/clear', { method: 'DELETE' });
          if (res.ok) {
            fetchSessions();
            addToast('All sessions deleted successfully', 'success');
            setActiveVideo(null);
          } else {
            const err = await res.json();
            addToast(`Failed to clear sessions: ${err.error}`, 'error');
          }
        } catch (e) {
          addToast(`Failed to clear sessions: ${e.message}`, 'error');
        }
      }
    );
  };

  const handleTestCameras = async () => {
    setIsTesting(true);
    addToast('Starting camera test flow...', 'info');
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
        addToast('Camera test completed successfully!', 'success');
        fetchSessions();
      }
    } catch (e) {
      addToast(`Test failed: ${e.message}`, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleFetchOffline = async (targetSessionIds = null, sessionTimestamp = null, sessionId = null) => {
    if (isMonitoring) {
      addToast('Please stop monitoring first.', 'warning');
      return;
    }
    setFetchingSessionId(sessionId);
    addToast('Fetching offline session from SD cards... This may take a while.', 'info');
    try {
      const res = await fetch('/api/offline/fetch', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSessionIds, sessionTimestamp })
      });
      if (res.ok) {
        addToast('Offline session fetched successfully!', 'success');
        fetchSessions();
      } else {
        const err = await res.json();
        addToast(`Fetch failed: ${err.error}`, 'error');
        if (err.sessionId) {
          fetchSessions();
        }
      }
    } catch (e) {
      addToast(`Fetch failed: ${e.message}`, 'error');
    } finally {
      setFetchingSessionId(null);
    }
  };

  const handleWipeSD = async () => {
    showConfirm(
      'Are you sure you want to wipe all SD cards? This cannot be undone.',
      async () => {
        try {
          const res = await fetch('/api/offline/wipe', { method: 'POST' });
          if (res.ok) {
            addToast('SD cards wiped successfully.', 'success');
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

  const getDaysInMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    const day = new Date(year, month - 1, 1).getDay();
    return day === 0 ? 6 : day - 1; // 0 = Mon, ..., 6 = Sun
  };

  const generateCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentMonthDate.year, currentMonthDate.month);
    const firstDay = getFirstDayOfMonth(currentMonthDate.year, currentMonthDate.month);
    
    const prevMonthDate = currentMonthDate.month === 1 ? { month: 12, year: currentMonthDate.year - 1 } : { month: currentMonthDate.month - 1, year: currentMonthDate.year };
    const nextMonthDate = currentMonthDate.month === 12 ? { month: 1, year: currentMonthDate.year + 1 } : { month: currentMonthDate.month + 1, year: currentMonthDate.year };
    
    const prevMonthDays = getDaysInMonth(prevMonthDate.year, prevMonthDate.month);
    
    const days = [];
    
    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, isOtherMonth: true });
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${currentMonthDate.year}-${String(currentMonthDate.month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, isOtherMonth: false, dateStr });
    }
    
    // Next month padding
    const remainingCells = 42 - days.length; 
    for (let i = 1; i <= remainingCells; i++) {
      days.push({ day: i, isOtherMonth: true });
    }
    
    return days;
  };

  const calendarDays = generateCalendarDays();

  const handlePrevMonth = () => {
    setCurrentMonthDate(prev => prev.month === 1 ? { month: 12, year: prev.year - 1 } : { month: prev.month - 1, year: prev.year });
  };
  
  const handleNextMonth = () => {
    setCurrentMonthDate(prev => prev.month === 12 ? { month: 1, year: prev.year + 1 } : { month: prev.month + 1, year: prev.year });
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="dashboard-container">
      {/* Header */}
      <div className="header">
        <img src="/logo.png" alt="Prusa-lapse" className="header-logo" />
        <h1>Prusa-lapse</h1>
        <p>Multi-Camera Cinematic Timelapse Controller</p>
      </div>

      {/* Main Grid */}
      <div className="grid">
        {/* Timelapses */}
        <div className="panel full-width-panel">
          <h2>
            <span className="panel-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Timelapses
            </span>
            {isTesting && (
              <span className="spinner" style={{ width: '18px', height: '18px', marginLeft: '12px' }} />
            )}
          </h2>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
            <button
              className={`btn ${isMonitoring ? 'btn-danger' : 'btn-primary'}`}
              onClick={toggleMonitoring}
              style={{ flex: '2 1 200px' }}
              disabled={isTesting}
            >
              {isMonitoring ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                  Stop PC Backup Sync
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Start PC Backup Sync
                </>
              )}
            </button>

            <button 
              className="btn btn-ghost" 
              style={{ flex: '1 1 150px' }} 
              onClick={handleTestCameras}
              disabled={isTesting}
            >
              {isTesting ? (
                <>
                  <span className="spinner" style={{ width: '14px', height: '14px' }} />
                  Testing...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Test Cameras
                </>
              )}
            </button>

            {isMonitoring && (
              <div style={{ flex: '1 1 120px', textAlign: 'right', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Frame {frameCount}</div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', opacity: 0.8 }}>{currentSession}</div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
              The cameras handle polling autonomously. Enable PC Backup Sync to automatically fetch frames from camera RAM to your computer as they are captured.
            </p>
          </div>



          <div className="cameras-grid">
            {config.cameraIps && config.cameraIps.split('\n').filter(ip => ip.trim()).map((ip, idx) => {
              const cleanIp = ip.trim();
              const hmirror = getCameraVal(cleanIp, 'hmirror', 0);
              const vflip = getCameraVal(cleanIp, 'vflip', 0);
              const brightness = getCameraVal(cleanIp, 'brightness', 0);
              const contrast = getCameraVal(cleanIp, 'contrast', 0);
              return (
                <CameraCard key={idx} cleanIp={cleanIp} idx={idx} cameraSettings={cameraSettings} updateCameraSetting={updateCameraSetting} getCameraVal={getCameraVal} fetchCameraSettings={fetchCameraSettings} config={config} addToast={addToast} />
              );
            })}
            {(!config.cameraIps || config.cameraIps.trim() === '') && (
              <div style={{ color: 'var(--text-secondary)', padding: '20px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                No cameras configured yet. Go to Configuration to add cameras.
              </div>
            )}
          </div>
          
          <SlicerPanel />
        </div>

        {/* Sessions & Compilation Panel */}
        <div className="panel full-width-panel">
          <h2>
            <span className="panel-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <rect x="7" y="7" width="3" height="3" />
                <rect x="14" y="7" width="3" height="3" />
                <rect x="7" y="14" width="3" height="3" />
                <rect x="14" y="14" width="3" height="3" />
              </svg>
              Timelapse sessions
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-ghost btn-small" onClick={() => fetchSessions(true)} style={{ width: 'auto' }}>
                Refresh
              </button>
              <button className="btn btn-danger btn-small" onClick={handleClearAllSessions} style={{ width: 'auto' }}>
                Clear All Sessions
              </button>
              <button className="btn btn-danger btn-small" onClick={handleWipeSD} style={{ width: 'auto' }}>
                Delete All Offline Sessions
              </button>
            </div>
          </h2>

          <div style={{ background: 'rgba(20, 24, 30, 0.5)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Compile Settings:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem' }}>FPS:</label>
              <input 
                type="number" 
                min="1" max="60"
                className="input-field" 
                style={{ width: '80px', padding: '0.4rem' }}
                value={compileOptions.fps} 
                onChange={(e) => setCompileOptions(p => ({...p, fps: parseInt(e.target.value)}))} 
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem' }}>Quality (CRF):</label>
              <select 
                className="input-field"
                style={{ width: '160px', padding: '0.4rem' }}
                value={compileOptions.quality}
                onChange={(e) => setCompileOptions(p => ({...p, quality: parseInt(e.target.value)}))}
              >
                <option value="18">High (18)</option>
                <option value="23">Standard (23)</option>
                <option value="28">Draft (28)</option>
              </select>
            </div>
          </div>

          {compilingStatus && (
            <div className="compiler-status-box">
              <span className="spinner" />
              Compiling {compilingStatus.sessionId} (Camera {compilingStatus.cameraIndex}) into MP4. Please wait...
            </div>
          )}

          {activeVideo && (
            <div style={{ marginBottom: '25px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Playing: <strong style={{ color: 'var(--text-primary)' }}>{activeVideo.session} - {activeVideo.camera}</strong>
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
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
              No timelapse sessions recorded yet. Start monitoring and trigger a print to capture frames.
            </div>
          ) : (
            <>
              {selectedSessionId && sessions.find(s => s.id === selectedSessionId) && (() => {
                const session = sessions.find(s => s.id === selectedSessionId);
                const dateObj = parseSessionDate(session.timestamp);
                return (
                  <div className="session-card expanded" style={{ marginBottom: '20px' }}>
                    <div className="session-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span className="session-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {dateObj ? `${dateObj.monthName} ${dateObj.day}, ${dateObj.year} at ${dateObj.time}` : session.timestamp}
                        {session.isOffline && session.isRemote && (
                          <span style={{ fontSize: '0.65rem', background: 'rgba(232,83,63,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(232,83,63,0.3)', padding: '2px 8px', borderRadius: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Offline
                          </span>
                        )}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button 
                          className="btn btn-danger btn-small"
                          style={{ width: 'auto', padding: '4px 8px', fontSize: '0.75rem' }}
                          onClick={() => { handleDeleteSession(session.id); setSelectedSessionId(null); }}
                        >
                          Delete Session
                        </button>
                        <button 
                          className="btn btn-ghost btn-small"
                          style={{ width: 'auto', padding: '4px 8px', fontSize: '0.75rem' }}
                          onClick={() => setSelectedSessionId(null)}
                        >
                          &times; Close
                        </button>
                      </div>
                    </div>
                    <span className="session-time" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', opacity: 0.6 }}>
                    ID: {session.id}
</span>
                    
                    <div className="session-actions" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      {session.isRemote ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                          <button 
                            className="btn btn-primary" 
                            onClick={() => handleFetchOffline(session.remoteSessionIds, session.timestamp, session.id)}
                            style={{ width: '100%', position: 'relative', overflow: 'hidden' }}
                            disabled={isMonitoring || fetchingSessionId !== null}
                          >
                            {fetchingSessionId === session.id && fetchStatus && fetchStatus.isFetching && (
                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: 'rgba(0,0,0,0.25)', width: `${fetchStatus.progress}%`, transition: 'width 0.3s ease' }} />
                            )}
                            <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {fetchingSessionId === session.id ? (
                                <>
                                  <span className="spinner" style={{ width: '14px', height: '14px', marginRight: '8px' }} />
                                  {fetchStatus && fetchStatus.isFetching ? `Camera ${fetchStatus.currentCameraIndex + 1}/${fetchStatus.totalCameras} - ${fetchStatus.progress}%` : 'Fetching Session...'}
                                </>
                              ) : (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  Fetch Session from Cameras
                                </>
                              )}
                            </div>
                          </button>
                        </div>
                      ) : (
                        session.cameras.map((cam, idx) => {
                          const hasVideo = session.videos.includes(`camera_${idx}.mp4`);
                          const isThisCompiling = compilingStatus?.sessionId === session.id && compilingStatus?.cameraIndex === idx;

                          return (
                            <div key={cam.name} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                                <span>Camera {idx} ({cam.frameCount} frames)</span>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  className="btn btn-ghost btn-small"
                                  style={{ flex: 1, padding: '8px 6px', fontSize: '0.8rem' }}
                                  disabled={cam.frameCount === 0 || isThisCompiling || !!compilingStatus}
                                  onClick={() => handleCompile(session.id, idx)}
                                >
                                  {isThisCompiling ? 'Compiling...' : hasVideo ? 'Re-compile' : 'Compile MP4'}
                                </button>
                                
                                <a
                                  href={`/api/captures/zip?session=${session.id}&camera=camera_${idx}`}
                                  className={`btn btn-ghost btn-small ${cam.frameCount === 0 ? 'disabled' : ''}`}
                                  style={{ flex: 1, textDecoration: 'none', pointerEvents: cam.frameCount === 0 ? 'none' : 'auto', opacity: cam.frameCount === 0 ? 0.5 : 1, padding: '8px 6px', fontSize: '0.8rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  Download RAW images
                                </a>
                              </div>
                              
                              {hasVideo && (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    className="btn btn-primary btn-small"
                                    style={{ flex: 1, padding: '8px 6px', fontSize: '0.8rem' }}
                                    onClick={() => setActiveVideo({ session: session.id, camera: `camera_${idx}`, timestamp: Date.now() })}
                                  >
                                    Play Video
                                  </button>
                                  <a
                                    href={`/api/captures?session=${session.id}&file=camera_${idx}.mp4&t=${Date.now()}`}
                                    download={`${session.id}_camera_${idx}.mp4`}
                                    className="btn btn-ghost btn-small"
                                    style={{ padding: '8px 10px', textDecoration: 'none', width: '40px', flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <polyline points="7 10 12 15 17 10" />
                                      <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                  </a>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="calendar-header-nav">
                <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={handlePrevMonth}>&lt;</button>
                <div className="calendar-month-title">{monthNames[currentMonthDate.month - 1]} {currentMonthDate.year}</div>
                <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={handleNextMonth}>&gt;</button>
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
                          return (
                            <div 
                              key={sess.id} 
                              className={`session-pill ${sess.isOffline && sess.isRemote ? 'offline' : ''} ${selectedSessionId === sess.id ? 'selected' : ''}`}
                              onClick={() => setSelectedSessionId(prev => prev === sess.id ? null : sess.id)}
                              title={`Time: ${sObj.time}\nID: ${sess.id}\nCameras: ${sess.cameras.length}`}
                            >
                              {sObj.time} {sess.isOffline && sess.isRemote ? '(Off)' : ''}
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

        {/* Configuration Panel */}
        <div className="panel full-width-panel">
          <h2 onClick={() => setConfigCollapsed(!configCollapsed)} style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="panel-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Configuration
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
                <div style={{ backgroundColor: 'rgba(255,50,50,0.1)', borderLeft: '4px solid #ff4444', padding: '12px 16px', margin: '0 0 20px 0', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <div style={{ color: '#ff4444', fontSize: '14px', fontWeight: '500' }}>
                    Warning: One or more ESP32-CAMs have lost connection to the PrusaLink Printer. Check the IP address or Auto-detect it below.
                  </div>
                </div>
              )}
              <div className="input-group">
                <label>PrusaLink IP Address</label>
                <input
                  type="text"
                  placeholder="192.168.1.50"
                  value={config.prusaIp}
                  onChange={(e) => setConfig({ ...config, prusaIp: e.target.value })}
                />
              </div>

              <div className="input-group">
                <label>PrusaLink API Key</label>
                <input
                  type="password"
                  placeholder="Enter API Key"
                  value={config.prusaApiKey}
                  onChange={(e) => setConfig({ ...config, prusaApiKey: e.target.value })}
                />
              </div>

              <div className="input-group">
                <label>Configured Cameras (Discovered)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {config.cameraIps && config.cameraIps.split('\n').filter(ip => ip.trim()).map((ip, idx) => {
                    const cleanIp = ip.trim();
                    const name = getCameraVal(cleanIp, 'camera_name', `Camera ${idx + 1}`);
                    return (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '6px' }}>
                        <span>
                          <strong>{name}</strong> 
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginLeft: '8px' }}>({cleanIp})</span>
                          <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px', color: 'var(--text-secondary)' }}>
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
                  {(!config.cameraIps || config.cameraIps.trim() === '') && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic' }}>No cameras configured. Use Auto-detect or add manually below.</div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <input 
                      type="text" 
                      className="text-input" 
                      placeholder="Add IP manually (e.g. 192.168.1.100)" 
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
                      className="btn btn-ghost"
                      style={{ width: 'auto' }}
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

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <button className="btn btn-ghost" style={{ flex: 1, minWidth: '120px' }} onClick={handleSaveConfig}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save
                </button>
                <button className="btn btn-ghost" style={{ flex: 1, minWidth: '120px' }} onClick={handleAutoDetect} disabled={isDetecting}>
                  {isDetecting ? (
                    <>
                      <span className="spinner" style={{ width: '14px', height: '14px' }} />
                      Detecting...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        <line x1="11" y1="8" x2="11" y2="14" />
                        <line x1="8" y1="11" x2="14" y2="11" />
                      </svg>
                      Auto-detect
                    </>
                  )}
                </button>
              </div>

              {/* Webapp Log */}
              <div className="input-group" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px', marginTop: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  Webapp Log
                </label>
                <div className="log-box" ref={logBoxRef}>
                  {logs.length === 0 ? (
                    <div className="log-placeholder">
                      System logs will appear here
                    </div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className={`log-entry ${log.type}`}>
                        <span className="log-time">[{log.time}]</span> {log.message}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* OTA Firmware Update */}
              <div className="input-group" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px', marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    OTA Firmware Update
                  </label>
                  {latestFirmwareInfo && latestFirmwareInfo.available && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34D399' }} />
                      Latest built: <strong style={{ color: 'var(--color-orange)' }}>{latestFirmwareInfo.version}</strong> ({latestFirmwareInfo.sizeFormatted})
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
                    <option value="">Select Camera to Update...</option>
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
                      style={{ flex: 2, minWidth: '200px', color: 'var(--text-primary)' }}
                    />
                  ) : (
                    <div style={{ flex: 2, minWidth: '200px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                      <span>
                        Automatic: <strong style={{ color: 'var(--text-primary)' }}>firmware.bin</strong> {latestFirmwareInfo?.version ? `(${latestFirmwareInfo.version})` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                        onClick={() => setUseCustomOtaFile(true)}
                      >
                        Custom .bin
                      </button>
                    </div>
                  )}

                  {useCustomOtaFile && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                      onClick={() => {
                        setUseCustomOtaFile(false);
                        setOtaFile(null);
                      }}
                    >
                      Use Latest
                    </button>
                  )}

                  <button 
                    className="btn btn-primary"
                    onClick={handleOtaUpdate}
                    disabled={!otaCameraIp || isUpdatingOta || (useCustomOtaFile && !otaFile)}
                    style={{ flex: 1, minWidth: '140px' }}
                  >
                    {isUpdatingOta 
                      ? `Updating... ${otaProgress}%` 
                      : (!useCustomOtaFile && latestFirmwareInfo?.version ? `Flash ${latestFirmwareInfo.version}` : 'Flash Firmware')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        Prusa-lapse &middot; Open Source &middot; MIT License
      </div>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast-card toast-${toast.type}`}>
              <div className="toast-icon">
                {toast.type === 'success' && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                )}
                {toast.type === 'error' && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                )}
                {toast.type === 'warning' && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
                {toast.type === 'info' && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
              </div>
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="modal-icon text-danger">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h3>Confirm Action</h3>
            </div>
            <div className="modal-body">
              {confirmModal.message}
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setConfirmModal(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-danger" 
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
