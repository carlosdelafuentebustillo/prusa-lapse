'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import CameraCard from './components/CameraCard';
import SlicerPanel from './components/SlicerPanel';

function CalendarSessionPill({ session, title, time, isSelected, onClick }) {
  const trackRef = useRef(null);
  const labelRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [overflowDistance, setOverflowDistance] = useState(0);
  const [duration, setDuration] = useState('3s');

  const checkOverflow = useCallback(() => {
    if (trackRef.current && labelRef.current) {
      const trackWidth = trackRef.current.clientWidth;
      const textWidth = labelRef.current.scrollWidth;
      const diff = textWidth - trackWidth;
      if (diff > 2) {
        setIsOverflowing(true);
        const dist = diff + 8;
        setOverflowDistance(dist);
        const dur = Math.max(2.5, Number((dist / 32).toFixed(1)));
        setDuration(`${dur}s`);
      } else {
        setIsOverflowing(false);
        setOverflowDistance(0);
      }
    }
  }, []);

  useEffect(() => {
    checkOverflow();
  }, [title, checkOverflow]);

  useEffect(() => {
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [checkOverflow]);

  return (
    <div
      className={`session-pill ${session.isRemote ? 'offline' : ''} ${session.isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onMouseEnter={checkOverflow}
      title={`${title}${time ? ` (${time})` : ''}`}
    >
      {session.isActive && <span className="pill-dot active-dot" />}
      <span className="session-pill-track" ref={trackRef}>
        <span
          ref={labelRef}
          className={`session-pill-label ${isOverflowing ? 'overflowing' : ''}`}
          style={{
            '--marquee-offset': `-${overflowDistance}px`,
            '--marquee-duration': duration,
          }}
        >
          {title}
        </span>
      </span>
    </div>
  );
}

function CalendarDayCell({ cDay, isToday, daySessions, selectedSessionId, setSelectedSessionId, getSessionDisplayName }) {
  const listRef = useRef(null);
  const rafRef = useRef(null);
  const scrollDirRef = useRef(0);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const up = el.scrollTop > 2;
    const down = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
    setCanScrollUp(up);
    setCanScrollDown(down);
  }, []);

  useEffect(() => {
    updateScrollState();
  }, [daySessions.length, updateScrollState]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateScrollState();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollState) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', updateScrollState);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);

  const stopHoverScroll = useCallback(() => {
    scrollDirRef.current = 0;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startHoverScroll = useCallback((direction) => {
    stopHoverScroll();
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const startEl = listRef.current;
    if (!startEl) return;

    scrollDirRef.current = direction;
    let lastTime = performance.now();
    let virtualScrollTop = startEl.scrollTop;

    const step = (now) => {
      const el = listRef.current;
      if (!el || scrollDirRef.current === 0) return;
      const dt = Math.min(50, now - lastTime);
      lastTime = now;

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      virtualScrollTop = Math.max(0, Math.min(maxScroll, virtualScrollTop + scrollDirRef.current * (dt * 0.065)));
      el.scrollTop = virtualScrollTop;
      updateScrollState();

      const stillCanScroll = scrollDirRef.current > 0
        ? (maxScroll - virtualScrollTop > 1)
        : (virtualScrollTop > 1);

      if (stillCanScroll) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        stopHoverScroll();
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [stopHoverScroll, updateScrollState]);

  useEffect(() => {
    return () => stopHoverScroll();
  }, [stopHoverScroll]);

  const handleStepScroll = (e, direction) => {
    e.stopPropagation();
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ top: direction * 26, behavior: 'smooth' });
    setTimeout(updateScrollState, 220);
  };

  return (
    <div
      className={`calendar-cell ${cDay.isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
      onMouseLeave={stopHoverScroll}
    >
      <div className="calendar-date-number">{cDay.day}</div>
      <div className="calendar-sessions-wrapper">
        <div
          className={`calendar-scroll-zone top ${canScrollUp ? 'visible' : ''}`}
          onMouseEnter={() => startHoverScroll(-1)}
          onMouseLeave={stopHoverScroll}
          onClick={(e) => handleStepScroll(e, -1)}
          title="Hover or click to scroll up"
        >
          <span className="calendar-scroll-arrow" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </span>
        </div>

        <div
          ref={listRef}
          className="calendar-sessions-list"
          onScroll={updateScrollState}
        >
          {daySessions.map(sess => {
            const sObj = parseSessionDate(sess.timestamp);
            const pillTitle = getSessionDisplayName(sess, sObj);
            return (
              <CalendarSessionPill
                key={sess.id}
                session={sess}
                title={pillTitle}
                time={sObj?.time}
                isSelected={selectedSessionId === sess.id}
                onClick={() => setSelectedSessionId(selectedSessionId === sess.id ? null : sess.id)}
              />
            );
          })}
        </div>

        <div
          className={`calendar-scroll-zone bottom ${canScrollDown ? 'visible' : ''}`}
          onMouseEnter={() => startHoverScroll(1)}
          onMouseLeave={stopHoverScroll}
          onClick={(e) => handleStepScroll(e, 1)}
          title="Hover or click to scroll down"
        >
          <span className="calendar-scroll-arrow" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

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

const generateSessionTimestamp = (date = new Date()) => {
  return date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') + '_' +
    String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0') +
    String(date.getSeconds()).padStart(2, '0');
};

const parsePrusaFilenameClient = (displayName = '') => {
  if (!displayName) return null;
  const base = displayName.replace(/\.(bgcode|gcode|gco)$/i, '');
  const nozzleMatch = base.match(/_(\d+(?:\.\d+)?n)(?:_|$)/i);
  const layerMatch = base.match(/_(\d+(?:\.\d+)?mm)(?:_|$)/i);
  const materialMatch = base.match(/_(PLA|PETG|ASA|ABS|TPU|FLEX|PC|PVB|PA|HIPS|NYLON|PET|CPE|PP)(?:_|$)/i);
  const timeMatch = base.match(/_((?:\d+d)?(?:\d+h)?(?:\d+m))$/i);

  let modelName = base;
  const suffixIdx = modelName.search(/_(?:\d+(?:\.\d+)?n|\d+(?:\.\d+)?mm)_/i);
  if (suffixIdx > 0) {
    modelName = modelName.substring(0, suffixIdx);
  }
  modelName = modelName.replace(/_/g, ' ').trim();

  return {
    displayName,
    modelName: modelName || base,
    nozzle: nozzleMatch ? nozzleMatch[1] : null,
    layerHeight: layerMatch ? layerMatch[1] : null,
    material: materialMatch ? materialMatch[1].toUpperCase() : null,
    estimatedTime: timeMatch ? timeMatch[1] : null,
  };
};

const getSessionDisplayName = (session, dateObj) => {
  if (session?.meta?.modelName) return session.meta.modelName;
  if (session?.jobName) return session.jobName.replace(/\.(bgcode|gcode|gco)$/i, '').replace(/_/g, ' ');
  if (dateObj) return `Print Session · ${dateObj.monthName} ${dateObj.day}`;
  return session?.id || 'Print Session';
};

export default function Home() {
  const [config, setConfig] = useState({ prusaIp: '', prusaApiKey: '', cameraIps: '', cameraMacs: {}, cameraNames: {} });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [compilingStatus, setCompilingStatus] = useState(null);
  const [compileOptions, setCompileOptions] = useState({ fps: 30, quality: 23, filterDark: true });
  const [cameraRotations, setCameraRotations] = useState({
    camera_5C013B885234: 0,
    camera_5C013B87D598: 90,
    0: 0,
    1: 90
  });
  const [activeVideo, setActiveVideo] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [currentSession, setCurrentSession] = useState(null);
  const logBoxRef = useRef(null);
  const [cameraSettings, setCameraSettings] = useState({});
  const [printerOfflineWarning, setPrinterOfflineWarning] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [fetchingSessionId, setFetchingSessionId] = useState(null);
  const [fetchStatus, setFetchStatus] = useState(null);
  const isFetchRequestInFlightRef = useRef(false);
  const prevFetchingRef = useRef(false);
  const lastHandledFetchCompletionRef = useRef(0);

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
    if (val !== undefined && val !== null && val !== '') return val;
    if (variable === 'camera_name') {
      const mac = config.cameraMacs?.[ip]?.toUpperCase();
      const persisted = (mac && config.cameraNames?.[mac]) || config.cameraNames?.[ip];
      if (persisted) return persisted;
    }
    return defaultVal;
  };

  const getCameraDisplayName = (camOrIdx) => {
    const ips = config.cameraIps ? config.cameraIps.split('\n').map(i => i.trim()).filter(Boolean) : [];

    if (typeof camOrIdx === 'number' || (typeof camOrIdx === 'string' && /^\d+$/.test(camOrIdx))) {
      const idx = Number(camOrIdx);
      const ip = ips[idx];
      if (ip && cameraSettings[ip]?.camera_name && cameraSettings[ip].camera_name !== 'PrusaLapse Camera') {
        return cameraSettings[ip].camera_name;
      }
      const mac = ip ? config.cameraMacs?.[ip]?.toUpperCase() : null;
      const persisted = (mac && config.cameraNames?.[mac]) || (ip && config.cameraNames?.[ip]);
      if (persisted) return persisted;
      return `Camera ${idx + 1}`;
    }

    const obj = typeof camOrIdx === 'string' ? { name: camOrIdx } : (camOrIdx || {});
    if (obj.displayName && !/^Camera \d+$/i.test(obj.displayName)) {
      return obj.displayName;
    }

    const folderKey = obj.name || obj.folderName || '';
    const suffix = folderKey.startsWith('camera_') ? folderKey.slice('camera_'.length) : folderKey;
    const mac = (obj.mac || (/^[0-9A-Fa-f]{12}$/.test(suffix) ? suffix : null))?.toUpperCase() || null;

    let ip = obj.ip || null;
    if (!ip && mac && config.cameraMacs) {
      ip = Object.entries(config.cameraMacs).find(([, m]) => String(m || '').toUpperCase() === mac)?.[0] || null;
    }
    if (!ip && /^\d+_\d+_\d+_\d+$/.test(suffix)) {
      ip = suffix.replace(/_/g, '.');
    }

    if (ip && cameraSettings[ip]?.camera_name && cameraSettings[ip].camera_name !== 'PrusaLapse Camera') {
      return cameraSettings[ip].camera_name;
    }

    if (mac) {
      for (const [, st] of Object.entries(cameraSettings)) {
        const stMac = (st?.mac || (st?.fingerprint && st.fingerprint.length >= 24 ? st.fingerprint.slice(0, 12) : '')).toUpperCase();
        if (stMac === mac && st?.camera_name && st.camera_name !== 'PrusaLapse Camera') {
          return st.camera_name;
        }
      }
    }

    if (obj.cameraName && obj.cameraName !== 'PrusaLapse Camera') {
      return obj.cameraName;
    }

    const persisted = (mac && config.cameraNames?.[mac]) || (ip && config.cameraNames?.[ip]);
    if (persisted) return persisted;

    if (typeof obj.index === 'number') return getCameraDisplayName(obj.index);
    if (typeof obj.cameraIndex === 'number' && obj.cameraIndex < 99) return getCameraDisplayName(obj.cameraIndex);
    if (/^\d+$/.test(suffix)) return getCameraDisplayName(Number(suffix));
    if (mac) return `Camera ${mac.slice(-4)}`;
    if (ip) return `Camera (${ip})`;
    return 'Camera';
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
          const derivedMac = (data.mac || (data.fingerprint && data.fingerprint.length >= 24 ? data.fingerprint.slice(0, 12) : '')).toUpperCase();
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
              mac: derivedMac || prev[ip]?.mac || '',
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
            cameraIps: cameraIpsStr,
            cameraMacs: data.config.cameraMacs || {},
            cameraNames: data.config.cameraNames || {}
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

  const isAnyPrinting = Object.values(cameraSettings).some(c => c && (c.printer_state === 'PRINTING' || c.printer_state === 'PAUSED'));

  useEffect(() => {
    if (!config.cameraIps) return;
    const intervalTime = isAnyPrinting ? 4000 : 10000;
    const cameraSettingsInterval = setInterval(() => {
      fetchCameraSettings(config.cameraIps);
    }, intervalTime);
    return () => clearInterval(cameraSettingsInterval);
  }, [config.cameraIps, isAnyPrinting]);

  const fetchSessions = (forceRemote = false) => {
    return fetch(`/api/sessions${forceRemote === true ? '?remote=true' : ''}`)
      .then(res => res.json())
      .then(data => {
        if (data.sessions) {
          // Client-side deduplication safeguard: if a local session exists for a specific print, never render a duplicate remote card.
          // A shared job ID only counts when the start times agree: two recordings of the same job that started far apart
          // are different timelapses and must each keep their own card.
          const tsToMs = (ts) => {
            const p = parseSessionDate(ts);
            return p ? new Date(p.year, p.month - 1, p.day, p.hour, p.min, p.sec).getTime() : null;
          };
          const sameStart = (a, b) => {
            const x = tsToMs(a);
            const y = tsToMs(b);
            return x === null || y === null || Math.abs(x - y) <= 10 * 60 * 1000;
          };
          const localTimestamps = new Set();
          const localStartsByJobId = new Map();
          const localRemoteIdsByIp = new Map();
          const addLocalJob = (jobId, ts) => {
            if (!jobId) return;
            if (!localStartsByJobId.has(jobId)) localStartsByJobId.set(jobId, []);
            localStartsByJobId.get(jobId).push(ts);
          };

          data.sessions.forEach(s => {
            if (!s.isRemote) {
              if (s.timestamp) localTimestamps.add(s.timestamp);
              addLocalJob(s.meta?.jobId, s.timestamp);
              if (s.jobId && s.jobId !== s.meta?.jobId) addLocalJob(s.jobId, s.timestamp);
              if (s.remoteSessionIds) {
                Object.entries(s.remoteSessionIds).forEach(([ip, sid]) => {
                  localRemoteIdsByIp.set(`${ip}:${sid}`, true);
                });
              }
            }
          });

          const deduped = data.sessions.filter(s => {
            if (!s.isRemote) return true;
            if (s.timestamp && localTimestamps.has(s.timestamp)) return false;
            if (s.jobId && (localStartsByJobId.get(s.jobId) || []).some(ts => sameStart(ts, s.timestamp))) return false;
            if (s.remoteSessionIds && Object.entries(s.remoteSessionIds).some(([ip, sid]) => localRemoteIdsByIp.has(`${ip}:${sid}`))) {
              return false;
            }
            return true;
          });

          setSessions(deduped);
        }
      })
      .catch(() => {});
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
            if (data.fetchStatus?.isFetching) {
              prevFetchingRef.current = true;
              setFetchStatus(data.fetchStatus);
              if (data.fetchStatus.remoteSessionId || data.fetchStatus.sessionId) {
                setFetchingSessionId(data.fetchStatus.remoteSessionId || data.fetchStatus.sessionId);
              }
            } else if (!isFetchRequestInFlightRef.current) {
              if (prevFetchingRef.current) {
                prevFetchingRef.current = false;
                if (data.lastFetchResult && data.lastFetchResult.completedAt > lastHandledFetchCompletionRef.current) {
                  lastHandledFetchCompletionRef.current = data.lastFetchResult.completedAt;
                  if (data.lastFetchResult.success) {
                    addToast('Session synced from SD card!', 'success');
                  } else if (data.lastFetchResult.error) {
                    addToast(`Sync failed: ${data.lastFetchResult.error}`, 'error');
                  }
                  fetchSessions(true);
                }
              }
              setFetchStatus(null);
              if (fetchingSessionId) {
                setFetchingSessionId(null);
              }
            }
          }
        })
        .catch(() => {});
    }, 2000);

    const sessionInterval = setInterval(fetchSessions, 5000);

    return () => {
      clearInterval(monitorInterval);
      clearInterval(sessionInterval);
    };
  }, [fetchingSessionId]);

  useEffect(() => {
    if (!fetchingSessionId && !fetchStatus?.isFetching) return;
    const fastSyncPoll = setInterval(() => {
      fetch('/api/monitor')
        .then(res => res.json())
        .then(data => {
          if (data.fetchStatus !== undefined) {
            if (data.fetchStatus?.isFetching) {
              prevFetchingRef.current = true;
              setFetchStatus(data.fetchStatus);
              if (data.fetchStatus.remoteSessionId || data.fetchStatus.sessionId) {
                setFetchingSessionId(data.fetchStatus.remoteSessionId || data.fetchStatus.sessionId);
              }
            } else if (!isFetchRequestInFlightRef.current) {
              if (prevFetchingRef.current) {
                prevFetchingRef.current = false;
                if (data.lastFetchResult && data.lastFetchResult.completedAt > lastHandledFetchCompletionRef.current) {
                  lastHandledFetchCompletionRef.current = data.lastFetchResult.completedAt;
                  if (data.lastFetchResult.success) {
                    addToast('Session synced from SD card!', 'success');
                  } else if (data.lastFetchResult.error) {
                    addToast(`Sync failed: ${data.lastFetchResult.error}`, 'error');
                  }
                  fetchSessions(true);
                }
              }
              setFetchStatus(null);
              setFetchingSessionId(null);
            }
          }
        })
        .catch(() => {});
    }, 400);
    return () => clearInterval(fastSyncPoll);
  }, [fetchingSessionId, fetchStatus?.isFetching]);

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

  const handleCompile = async (sessionId, camKey, camLabel = null) => {
    const folderName = (typeof camKey === 'string' && camKey.startsWith('camera_')) ? camKey : `camera_${camKey}`;
    const label = camLabel || getCameraDisplayName(folderName);
    setCompilingStatus({ sessionId, camera: folderName, cameraLabel: label });
    const defaultRot = (folderName === 'camera_5C013B87D598' || label.toLowerCase().includes('x-axis')) ? 90 : 0;
    const rotation = cameraRotations[folderName] ?? defaultRot;
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          camera: folderName,
          options: { ...compileOptions, rotation }
        })
      });
      if (res.ok) {
        fetchSessions();
        addToast(`Compiled video for ${label}!`, 'success');
        setActiveVideo({
          session: sessionId,
          camera: folderName,
          cameraLabel: label,
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
            setSelectedSessionId(prev => prev === sessionId ? null : prev);
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
      'Delete ALL sessions and videos from this computer and wipe camera SD cards to start fresh?',
      async () => {
        try {
          const res = await fetch('/api/sessions/clear', { method: 'DELETE' });
          try {
            await fetch('/api/offline/wipe', { method: 'POST' });
          } catch (e) {}
          setSessions([]);
          await fetchSessions(false);
          addToast('All timelapse sessions and camera SD cards cleared', 'success');
          setActiveVideo(null);
          setSelectedSessionId(null);
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
    if (isFetchRequestInFlightRef.current || fetchStatus?.isFetching) {
      return;
    }

    const remoteFrameCountsPayload = session.remoteFrameCounts || (session.cameras ? Object.fromEntries(session.cameras.filter(c => c.ip).map(c => [c.ip, c.frameCount])) : null);
    const initialExpected = session.totalFramesExpected ?? (remoteFrameCountsPayload ? Object.values(remoteFrameCountsPayload).reduce((a, b) => a + (Number(b) || 0), 0) : 0);
    const initialFetched = session.totalFramesLocal ?? (session.isRemote ? 0 : (session.cameras || []).reduce((sum, c) => sum + (c.frameCount || 0), 0));
    const initialPct = initialExpected > 0 ? Math.min(99, Math.round((initialFetched / initialExpected) * 100)) : 0;
    const targetLocalSessionId = session.timestamp ? `session_${session.timestamp}` : session.id;

    isFetchRequestInFlightRef.current = true;
    setFetchingSessionId(session.id);
    setFetchStatus({
      isFetching: true,
      sessionId: targetLocalSessionId,
      remoteSessionId: session.id,
      sessionTimestamp: session.timestamp || null,
      jobName: session.jobName || session.meta?.displayName || null,
      jobId: session.jobId || session.meta?.jobId || null,
      targetSessionIds: session.remoteSessionIds || null,
      remoteFrameCounts: remoteFrameCountsPayload,
      overallProgress: initialPct,
      progress: initialPct,
      totalFramesExpected: initialExpected,
      totalFramesFetched: initialFetched,
      cameras: []
    });
    addToast('Syncing session from camera SD cards...', 'info');

    const earlyRefreshTimer = setTimeout(() => {
      fetchSessions(false);
    }, 600);

    try {
      prevFetchingRef.current = true;
      const res = await fetch('/api/offline/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remoteSessionId: session.id,
          targetSessionIds: session.remoteSessionIds,
          remoteFrameCounts: remoteFrameCountsPayload,
          sessionTimestamp: session.timestamp,
          jobName: session.jobName || session.meta?.displayName || null,
          jobId: session.jobId || session.meta?.jobId || null
        })
      });
      clearTimeout(earlyRefreshTimer);
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        await fetchSessions(false);
        if (json.success && !json.isFetching) {
          prevFetchingRef.current = false;
          addToast('Session synced from SD card!', 'success');
          fetchSessions(true);
          setFetchingSessionId(null);
          setFetchStatus(null);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        prevFetchingRef.current = false;
        await fetchSessions(false);
        addToast(`Sync failed: ${err.error || 'Server error'}`, 'error');
        fetchSessions(true);
        setFetchingSessionId(null);
        setFetchStatus(null);
      }
    } catch (e) {
      clearTimeout(earlyRefreshTimer);
      console.warn('Sync connection closed or timed out:', e.message);
      fetch('/api/monitor')
        .then(r => r.json())
        .then(data => {
          if (!data.fetchStatus?.isFetching) {
            setFetchingSessionId(null);
            setFetchStatus(null);
            prevFetchingRef.current = false;
          }
        })
        .catch(() => {
          setFetchingSessionId(null);
          setFetchStatus(null);
          prevFetchingRef.current = false;
        });
    } finally {
      isFetchRequestInFlightRef.current = false;
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
    const nextMonthDate = currentMonthDate.month === 12 ? { month: 1, year: currentMonthDate.year + 1 } : { month: currentMonthDate.month + 1, year: currentMonthDate.year };
    const prevMonthDays = getDaysInMonth(prevMonthDate.year, prevMonthDate.month);

    const days = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const dateStr = `${prevMonthDate.year}-${String(prevMonthDate.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, isOtherMonth: true, dateStr });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${currentMonthDate.year}-${String(currentMonthDate.month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, isOtherMonth: false, dateStr });
    }
    const remainingCells = 42 - days.length;
    for (let i = 1; i <= remainingCells; i++) {
      const dateStr = `${nextMonthDate.year}-${String(nextMonthDate.month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, isOtherMonth: true, dateStr });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Check if any camera reports an active print
  const activePrintCamera = Object.values(cameraSettings).find(c => c && (c.printer_state === 'PRINTING' || c.printer_state === 'PAUSED'));
  const activePrintName = activePrintCamera?.job_name
    ? activePrintCamera.job_name.replace(/\.(bgcode|gcode|gco)$/i, '').replace(/_/g, ' ')
    : null;

  // Active print session synthesis: if a print is currently active on the printer/cameras, surface it at the top of Timelapse Sessions
  const activeSession = (activePrintCamera && (activePrintCamera.job_id || activePrintCamera.job_name)) ? (() => {
    const activeJobId = activePrintCamera.job_id;
    const activeJobName = activePrintCamera.job_name;
    const parsed = parsePrusaFilenameClient(activeJobName);
    const activeCameras = Object.entries(cameraSettings)
      .filter(([_, c]) => c && (c.sensor_ok || (c.frame_count && c.frame_count > 0) || c.printer_state))
      .map(([ip, c], idx) => {
        const mac = (c.mac || (c.fingerprint && c.fingerprint.length >= 24 ? c.fingerprint.slice(0, 12) : '') || config.cameraMacs?.[ip] || '').toUpperCase();
        return {
          name: mac ? `camera_${mac}` : `camera_${idx}`,
          mac: mac || null,
          displayName: c.camera_name || config.cameraNames?.[mac] || config.cameraNames?.[ip] || `Camera ${idx + 1}`,
          frameCount: c.frame_count || 0,
          ip
        };
      });
    const totalFramesAcrossCameras = activeCameras.reduce((sum, c) => sum + (c.frameCount || 0), 0);
    const now = new Date();
    const activeTimestamp = generateSessionTimestamp(now);

    return {
      id: `active_job_${activeJobId || 'live'}`,
      timestamp: activeTimestamp,
      isActive: true,
      isRemote: !isMonitoring,
      jobId: activeJobId,
      jobName: activeJobName,
      meta: parsed,
      printerState: activePrintCamera.printer_state,
      progress: Math.round(Number(activePrintCamera.job_progress) || 0),
      cameras: activeCameras,
      totalFramesLocal: isMonitoring ? frameCount : 0,
      totalFramesExpected: totalFramesAcrossCameras,
      videos: []
    };
  })() : null;

  const displaySessions = (() => {
    let list = [...sessions];
    if (activeSession) {
      const matchingLocalIdx = list.findIndex(s => !s.isRemote && (
        (activeSession.jobId && (s.jobId === activeSession.jobId || s.meta?.jobId === activeSession.jobId)) ||
        (activeSession.jobName && (s.meta?.displayName === activeSession.jobName || s.jobName === activeSession.jobName))
      ));
      if (matchingLocalIdx >= 0) {
        list[matchingLocalIdx] = {
          ...list[matchingLocalIdx],
          isActive: true,
          printerState: activeSession.printerState,
          progress: activeSession.progress,
          totalFramesExpected: Math.max(list[matchingLocalIdx].totalFramesExpected || 0, activeSession.totalFramesExpected)
        };
      } else {
        list = [activeSession, ...list];
      }
    }
    return list;
  })();

  const resolveSelectedSession = (list, selectedId) => {
    if (!selectedId || !list || list.length === 0) return null;
    const exact = list.find(s => s.id === selectedId);
    if (exact) return exact;

    if (selectedId.startsWith('remote_')) {
      const withoutPrefix = selectedId.slice('remote_'.length);
      const ts = withoutPrefix.slice(0, 15);
      const remSid = withoutPrefix.length > 16 ? withoutPrefix.slice(16) : null;
      const byLocal = list.find(s =>
        s.id === `session_${ts}` ||
        s.timestamp === ts ||
        (remSid && s.remoteSessionIds && Object.values(s.remoteSessionIds).includes(remSid))
      );
      if (byLocal) return byLocal;
    }

    if (fetchStatus && (fetchStatus.remoteSessionId === selectedId || fetchStatus.sessionId === selectedId)) {
      const byFetch = list.find(s =>
        s.id === fetchStatus.sessionId ||
        s.id === fetchStatus.remoteSessionId ||
        (fetchStatus.sessionTimestamp && s.timestamp === fetchStatus.sessionTimestamp)
      );
      if (byFetch) return byFetch;
    }

    return null;
  };

  const selectedSession = resolveSelectedSession(displaySessions, selectedSessionId);

  const renderSessionCard = (session) => {
    const dateObj = parseSessionDate(session.timestamp);
    const title = getSessionDisplayName(session, dateObj);
    const isEditing = editingSessionId === session.id;

    const totalFramesLocal = session.totalFramesLocal ?? (session.isRemote ? 0 : (session.cameras || []).reduce((sum, c) => sum + (c.frameCount || 0), 0));
    const totalFramesExpected = session.totalFramesExpected ?? (session.remoteFrameCounts ? Object.values(session.remoteFrameCounts).reduce((a, b) => a + (Number(b) || 0), 0) : totalFramesLocal);
    const syncPercent = session.syncPercentage ?? (totalFramesExpected > 0 ? Math.min(100, Math.round((totalFramesLocal / totalFramesExpected) * 100)) : (session.isSynced ? 100 : 0));

    const hasJobConflict = session.jobId && fetchStatus?.jobId && session.jobId !== fetchStatus.jobId;
    const isCurrentFetching = Boolean(
      !session.isActive && !hasJobConflict && (
        (fetchingSessionId && (
          fetchingSessionId === session.id ||
          (session.timestamp && (
            fetchingSessionId === `session_${session.timestamp}` ||
            fetchingSessionId.startsWith(`remote_${session.timestamp}`)
          ))
        )) ||
        (fetchStatus?.isFetching && (
          fetchStatus.remoteSessionId === session.id ||
          fetchStatus.sessionId === session.id ||
          (fetchStatus.sessionTimestamp && session.timestamp && session.timestamp === fetchStatus.sessionTimestamp) ||
          (fetchStatus.jobId && (session.jobId === fetchStatus.jobId || session.meta?.jobId === fetchStatus.jobId))
        ))
      )
    );

    const displayPercent = isCurrentFetching ? (fetchStatus?.overallProgress ?? fetchStatus?.progress ?? syncPercent) : syncPercent;
    const displayFetched = isCurrentFetching ? (fetchStatus?.totalFramesFetched ?? totalFramesLocal) : totalFramesLocal;
    const displayExpected = isCurrentFetching ? (fetchStatus?.totalFramesExpected || totalFramesExpected) : totalFramesExpected;

    return (
      <div key={session.timestamp || session.id} className="session-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: 'rgba(255,255,255,0.02)' }}>
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
                  {!session.isRemote && !session.isActive && (
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
                  {session.isActive ? (
                    <span style={{ fontSize: '0.68rem', background: 'rgba(250,104,49,0.18)', color: 'var(--color-orange)', border: '1px solid rgba(250,104,49,0.4)', padding: '2px 10px', borderRadius: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-orange)', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      {isMonitoring ? `Live PC Syncing (${session.progress || 0}%)` : `Recording Live (${session.progress || 0}%)`}
                    </span>
                  ) : totalFramesLocal === 0 ? (
                    <span style={{ fontSize: '0.68rem', background: 'rgba(232,83,63,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(232,83,63,0.3)', padding: '1px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      On Camera SD
                    </span>
                  ) : (displayPercent >= 100 || session.isSynced) ? (
                    <span style={{ fontSize: '0.68rem', background: 'rgba(46,204,113,0.15)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.3)', padding: '1px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      ✓ Synced
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.68rem', background: 'rgba(255,170,0,0.15)', color: '#ffaa00', border: '1px solid rgba(255,170,0,0.3)', padding: '1px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      Partially Synced ({displayPercent}%)
                    </span>
                  )}
                </div>
              )}

              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <span>{session.isActive ? `Printing now · Active Job #${session.jobId || ''}` : (dateObj ? `${dateObj.monthName} ${dateObj.day}, ${dateObj.year} · ${dateObj.time}` : session.timestamp)}</span>
                <span>•</span>
                <span>{session.cameras.length} {session.cameras.length === 1 ? 'camera' : 'cameras'} ({session.isActive ? `${session.totalFramesExpected} frames on SD` : (totalFramesLocal > 0 ? `${totalFramesLocal} frames local` : `${totalFramesExpected} frames on SD`)})</span>
              </div>
            </div>
          </div>

          {/* Right: Delete button */}
          {!session.isActive && (
            <button
              className="btn btn-ghost btn-small"
              style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'rgba(232,83,63,0.25)' }}
              onClick={() => handleDeleteSession(session.id, title)}
              title="Delete Session"
            >
              Delete
            </button>
          )}
        </div>

        {/* Compact Sync & Status Row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 14px', background: 'rgba(0,0,0,0.22)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            {/* Left: Progress details & bar */}
            {session.isActive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '200px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-orange)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span className="spinner" style={{ width: '11px', height: '11px' }} />
                    {isMonitoring ? 'Live PC sync streaming frames in real-time…' : 'Recording timelapse frames to camera SD card…'}
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {session.progress}% print &middot; {session.totalFramesExpected} frames
                  </span>
                </div>
                <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(2, session.progress || 0)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--color-orange), #ff9f43)',
                      transition: 'width 0.4s ease'
                    }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '200px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span style={{ fontWeight: 600, color: displayPercent === 100 ? '#2ecc71' : 'var(--text-primary)' }}>
                    {isCurrentFetching ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-orange)' }}>
                        <span className="spinner" style={{ width: '12px', height: '12px' }} />
                        Syncing frames in progress…
                      </span>
                    ) : displayPercent === 100 ? (
                      '✓ All frames synced locally'
                    ) : totalFramesLocal > 0 ? (
                      'Sync incomplete — more frames on SD'
                    ) : (
                      'Stored on camera SD card'
                    )}
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {displayFetched} / {displayExpected} frames ({displayPercent}%)
                  </span>
                </div>
                <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${displayPercent}%`,
                      height: '100%',
                      background: displayPercent === 100 ? '#2ecc71' : 'linear-gradient(90deg, var(--color-orange), #ff9f43)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>
            )}

            {/* Right: Button */}
            {!session.isActive && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {(isCurrentFetching || displayPercent < 100) ? (
                  <button
                    className={`btn btn-small ${totalFramesLocal > 0 && !isCurrentFetching ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ width: 'auto', padding: '5px 12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    disabled={isMonitoring || isCurrentFetching || Boolean(fetchStatus?.isFetching) || fetchingSessionId !== null}
                    onClick={() => handleFetchOffline(session)}
                    title={totalFramesLocal > 0 ? 'Resume downloading missing frames from SD card' : 'Sync session frames from camera SD card'}
                  >
                    {isCurrentFetching ? (
                      <>
                        <span className="spinner" style={{ width: '12px', height: '12px' }} />
                        <span>{`Syncing… ${displayPercent}%`}</span>
                      </>
                    ) : (
                      <span>{totalFramesLocal > 0 ? 'Resume Sync' : 'Sync Session'}</span>
                    )}
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost btn-small"
                    style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', opacity: 0.7 }}
                    disabled={isMonitoring || fetchStatus?.isFetching || fetchingSessionId !== null}
                    onClick={() => handleFetchOffline(session)}
                    title="Re-verify or re-sync frames from camera SD card"
                  >
                    Re-sync
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sub-status: Active camera frame counts for active print */}
          {session.isActive && session.cameras && session.cameras.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {session.cameras.map((c, idx) => (
                  <span key={idx}>
                    {c.displayName}: {c.frameCount} frames
                  </span>
                ))}
              </div>
              <span style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>Ready to sync once print finishes</span>
            </div>
          )}

          {/* Sub-status: Active multi-camera sync progress details */}
          {!session.isActive && isCurrentFetching && fetchStatus?.cameras && fetchStatus.cameras.filter(c => c.status !== 'skipped').length > 0 && (
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              {fetchStatus.cameras.filter(c => c.status !== 'skipped').map((c, idx) => (
                <span key={c.folderName || c.ip || idx} style={{ opacity: c.status === 'done' ? 0.8 : 1, color: c.status === 'error' ? '#ff6b6b' : 'inherit' }}>
                  {getCameraDisplayName(c)}: {c.fetched}/{c.expected} {c.status === 'done' ? '✓' : (c.status === 'error' ? '⚠ offline' : '')}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Camera Compilation Grid (Only displayed when local frames exist) */}
        {totalFramesLocal > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
            {session.cameras.map((cam, idx) => {
              const camKey = cam.name || `camera_${idx}`;
              const hasVideo = session.videos.includes(`${camKey}.mp4`);
              const isThisCompiling = compilingStatus?.sessionId === session.id && compilingStatus?.camera === camKey;
              const camLabel = getCameraDisplayName(cam);
              const defaultRot = (camKey === 'camera_5C013B87D598' || camLabel.toLowerCase().includes('x-axis')) ? 90 : 0;

              return (
                <div key={camKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{camLabel}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cam.frameCount} frames</div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      className="input-field"
                      style={{ width: 'auto', padding: '4px 6px', fontSize: '0.72rem' }}
                      value={cameraRotations[camKey] ?? defaultRot}
                      onChange={(e) => setCameraRotations(prev => ({ ...prev, [camKey]: parseInt(e.target.value, 10) }))}
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
                        onClick={() => setActiveVideo({ session: session.id, title, camera: camKey, cameraLabel: camLabel, timestamp: Date.now() })}
                      >
                        Play
                      </button>
                    )}

                    <button
                      className={`btn btn-small ${hasVideo ? 'btn-ghost' : 'btn-secondary'}`}
                      style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
                      disabled={cam.frameCount === 0 || isThisCompiling || !!compilingStatus}
                      onClick={() => handleCompile(session.id, camKey, camLabel)}
                    >
                      {isThisCompiling ? 'Compiling…' : hasVideo ? 'Re-compile' : 'Compile MP4'}
                    </button>

                    {hasVideo && (
                      <a
                        href={`/api/captures?session=${session.id}&file=${camKey}.mp4&t=${Date.now()}`}
                        download={`${title.replace(/[^a-z0-9-_]+/gi, '_')}_${camLabel}.mp4`}
                        className="btn btn-ghost btn-small"
                        style={{ width: 'auto', padding: '5px 8px', textDecoration: 'none', fontSize: '0.75rem' }}
                        title="Download MP4"
                      >
                        MP4 ↓
                      </a>
                    )}

                    <a
                      href={`/api/captures/zip?session=${session.id}&camera=${camKey}`}
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
        ) : session.isActive ? (
          <div style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', background: 'rgba(255,255,255,0.015)', borderRadius: '6px', border: '1px dashed rgba(255,255,255,0.06)' }}>
            Print is actively recording. Frames are accumulating on camera micro-SD storage. Full session sync &amp; video compilation will be available once the print completes.
          </div>
        ) : (
          <div style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', background: 'rgba(255,255,255,0.015)', borderRadius: '6px', border: '1px dashed rgba(255,255,255,0.06)' }}>
            No local frames downloaded yet. Click <strong>Sync Session</strong> above to download frames from the camera SD card.
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
                ({displaySessions.length})
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
                className="btn btn-secondary btn-small"
                onClick={() => fetchSessions(true)}
                style={{ width: 'auto', padding: '5px 12px', fontSize: '0.75rem' }}
              >
                Check Camera SD
              </button>

              {displaySessions.length > 0 && (
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
              Compiling {compilingStatus.cameraLabel || getCameraDisplayName(compilingStatus.camera)} into MP4…
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

          {displaySessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              No timelapse sessions yet. Start a print on your Prusa printer or click <strong>Check Camera SD</strong> to sync finished prints.
            </div>
          ) : (
            <>
              {selectedSession && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Selected Session Details:
                    </span>
                    <button
                      className="btn btn-ghost btn-small"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: '0.75rem' }}
                      onClick={() => setSelectedSessionId(null)}
                    >
                      ✕ Close Details
                    </button>
                  </div>
                  {renderSessionCard(selectedSession)}
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
                  const daySessions = cDay.dateStr ? displaySessions.filter(s => {
                    const dObj = parseSessionDate(s.timestamp);
                    return dObj && dObj.dateStr === cDay.dateStr;
                  }) : [];
                  const isToday = cDay.dateStr === todayDateStr;

                  return (
                    <CalendarDayCell
                      key={i}
                      cDay={cDay}
                      isToday={isToday}
                      daySessions={daySessions}
                      selectedSessionId={selectedSession?.id ?? selectedSessionId}
                      setSelectedSessionId={setSelectedSessionId}
                      getSessionDisplayName={getSessionDisplayName}
                    />
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
