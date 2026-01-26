
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertType, AlertSeverity, EmergencyAlert, User, Group, Camera, Complaint } from './types';
import CommandCenter from './components/ShakeSimulator';
import CameraMonitor from './components/CameraMonitor';
import AlertHistory from './components/AlertHistory';
import { getEvacuationPlan } from './services/geminiService';
import { GoogleGenAI, Modality } from "@google/genai";

// Audio Helpers
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const STORAGE_KEY = 'SOCIETY_SHIELD_ALERTS_V2';
const GROUPS_STORAGE_KEY = 'SOCIETY_SHIELD_GROUPS_V1';
const COMPLAINTS_STORAGE_KEY = 'SOCIETY_SHIELD_COMPLAINTS_V1';
const BANNED_STORAGE_KEY = 'SOCIETY_SHIELD_BANNED_V1';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [joinedGroups, setJoinedGroups] = useState<Group[]>(() => {
    try {
      const raw = localStorage.getItem(GROUPS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((g: Group) => {
        if (!Array.isArray(g.members) || g.members.length === 0) {
          const hubId = g.id;
          const trialMembers: User[] = [
            { id: hubId + '_trial1', name: 'Trial Member 1', email: '', role: 'USER', groupId: hubId },
            { id: hubId + '_trial2', name: 'Trial Member 2', email: '', role: 'USER', groupId: hubId },
            { id: hubId + '_trial3', name: 'Trial Member 3', email: '', role: 'USER', groupId: hubId },
          ];
          return { ...g, members: trialMembers };
        }
        return g;
      });
    } catch {
      return [];
    }
  });
  const [authStep, setAuthStep] = useState<'LOGIN' | 'AUTH' | 'ONBOARDING' | 'DASHBOARD'>('LOGIN');
  const [societyUsername, setSocietyUsername] = useState('');
  const [joinId, setJoinId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [showHubMenu, setShowHubMenu] = useState(false);
  const [camerasByGroup, setCamerasByGroup] = useState<Record<string, Camera[]>>({});
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [newCam, setNewCam] = useState({ name: '', url: '', key: '' });
  const [isLinking, setIsLinking] = useState(false);
  const [activeCameraIndex, setActiveCameraIndex] = useState(0);
  const [complaintsByGroup, setComplaintsByGroup] = useState<Record<string, Complaint[]>>(() => {
    try {
      const raw = localStorage.getItem(COMPLAINTS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fixed: Record<string, Complaint[]> = {};
        Object.entries(parsed).forEach(([groupId, value]) => {
          if (Array.isArray(value)) {
            fixed[groupId] = (value as any[]).map((c: any) => ({
              ...c,
              createdAt: new Date(c.createdAt),
              status: c.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
            }));
          }
        });
        return fixed;
      }
      return {};
    } catch {
      return {};
    }
  });
  const [complaintSubject, setComplaintSubject] = useState('');
  const [complaintDescription, setComplaintDescription] = useState('');
  const [expandedComplaintId, setExpandedComplaintId] = useState<string | null>(null);
  const [bannedByGroup, setBannedByGroup] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(BANNED_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fixed: Record<string, string[]> = {};
        Object.entries(parsed).forEach(([groupId, value]) => {
          if (Array.isArray(value)) {
            fixed[groupId] = (value as any[]).map((v) => String(v));
          }
        });
        return fixed;
      }
      return {};
    } catch {
      return {};
    }
  });
  
  // Persistent Alerts State (per hub)
  const [alertsByGroup, setAlertsByGroup] = useState<Record<string, EmergencyAlert[]>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fixed: Record<string, EmergencyAlert[]> = {};
        Object.entries(parsed).forEach(([groupId, value]) => {
          if (Array.isArray(value)) {
            fixed[groupId] = (value as any[]).map((a: any) => ({
              ...a,
              timestamp: new Date(a.timestamp),
              resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : undefined
            }));
          }
        });
        return fixed;
      }
      // Legacy flat array format is ignored for per-hub logs
      return {};
    } catch {
      return {};
    }
  });
  const [allAlerts, setAllAlerts] = useState<EmergencyAlert[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<EmergencyAlert[]>([]);
  const [evacuationAdvice, setEvacuationAdvice] = useState<Record<string, string>>({});
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [sirenTimeLeft, setSirenTimeLeft] = useState(300);
  const [isMuted, setIsMuted] = useState(false);
  const [pendingMonthlyReport, setPendingMonthlyReport] = useState<EmergencyAlert[] | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sirenIntervalRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const activeAlertsRef = useRef(activeAlerts);
  const isMutedRef = useRef(isMuted);
  const googleLoginInProgressRef = useRef(false);

  // Persistence Sync
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alertsByGroup));
  }, [alertsByGroup]);

  useEffect(() => {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(joinedGroups));
  }, [joinedGroups]);

  useEffect(() => {
    localStorage.setItem(COMPLAINTS_STORAGE_KEY, JSON.stringify(complaintsByGroup));
  }, [complaintsByGroup]);

  useEffect(() => {
    localStorage.setItem(BANNED_STORAGE_KEY, JSON.stringify(bannedByGroup));
  }, [bannedByGroup]);

  useEffect(() => {
    activeAlertsRef.current = activeAlerts;
  }, [activeAlerts]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Per-hub alert linkage
  useEffect(() => {
    if (!activeGroup) {
      setAllAlerts([]);
      setActiveAlerts([]);
      return;
    }
    const list = alertsByGroup[activeGroup.id] || [];
    setAllAlerts(list);
    setActiveAlerts(list.filter(a => a.status === 'ACTIVE'));
  }, [activeGroup, alertsByGroup]);

  // Per-hub camera linkage
  useEffect(() => {
    if (!activeGroup) {
      setCameras([]);
      setActiveCameraIndex(0);
      return;
    }
    const existing = camerasByGroup[activeGroup.id];
    setCameras(existing || []);
    setActiveCameraIndex(0);
  }, [activeGroup, camerasByGroup]);

  useEffect(() => {
    if (!activeGroup) return;
    setCamerasByGroup(prev => ({
      ...prev,
      [activeGroup.id]: cameras,
    }));
  }, [cameras, activeGroup]);

  // Cleanup and Monthly Report Logic (per active hub)
  useEffect(() => {
    if (!activeGroup) {
      setPendingMonthlyReport(null);
      return;
    }

    const groupId = activeGroup.id;
    const groupAlerts = alertsByGroup[groupId] || [];

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // 1. Identify older alerts for auto-deletion ( > 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // 2. Identify alerts from previous months for batch reporting
    const previousMonthAlerts = groupAlerts.filter(a => {
      const d = new Date(a.timestamp);
      return d.getMonth() !== currentMonth || d.getFullYear() !== currentYear;
    });

    if (previousMonthAlerts.length > 0) {
      setPendingMonthlyReport(previousMonthAlerts);
    } else {
      setPendingMonthlyReport(null);
    }

    // Auto-delete alerts that are strictly more than 30 days old regardless of month
    setAlertsByGroup(prev => {
      const existing = prev[groupId] || [];
      const filtered = existing.filter(a => new Date(a.timestamp) > thirtyDaysAgo);
      if (filtered.length === existing.length) return prev;
      return { ...prev, [groupId]: filtered };
    });
  }, [alertsByGroup, activeGroup]);

  const downloadReport = (alertsToExport: EmergencyAlert[], fileName: string) => {
    const data = JSON.stringify(alertsToExport, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleArchivePreviousMonth = () => {
    if (!pendingMonthlyReport || !activeGroup) return;
    const lastMonthName = new Date(pendingMonthlyReport[0].timestamp).toLocaleString('default', { month: 'long', year: 'numeric' });
    downloadReport(pendingMonthlyReport, `SocietyShield_Report_${lastMonthName.replace(' ', '_')}.json`);
    
    // Clear them from state after download for the active hub
    const reportIds = new Set(pendingMonthlyReport.map(a => a.id));
    const groupId = activeGroup.id;
    setAlertsByGroup(prev => {
      const existing = prev[groupId] || [];
      const filtered = existing.filter(a => !reportIds.has(a.id));
      return { ...prev, [groupId]: filtered };
    });
    setPendingMonthlyReport(null);
  };

  const handleGoogleLogin = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    if (!clientId) {
      setAuthStep('ONBOARDING');
      return;
    }
    if (googleLoginInProgressRef.current) return;
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      setAuthStep('ONBOARDING');
      return;
    }
    googleLoginInProgressRef.current = true;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid profile email',
      callback: async (tokenResponse: any) => {
        try {
          const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          });
          const profile = await res.json();
          const name = profile.name || profile.email || 'Resident';
          const email = profile.email || '';
          const userId = profile.sub ? `google_${profile.sub}` : `google_${Date.now()}`;
          setCurrentUser(prev => {
            const existingRole = prev?.role || 'USER';
            return { id: userId, name, email, role: existingRole };
          });
          setSocietyUsername(name);
          setAuthStep('ONBOARDING');
        } catch (e) {
          console.error('Google login failed', e);
          setAuthStep('ONBOARDING');
        } finally {
          googleLoginInProgressRef.current = false;
        }
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  };

  const registerJoinedGroup = (group: Group) => {
    setJoinedGroups(prev => {
      const exists = prev.some(g => g.id === group.id);
      if (exists) return prev;
      return [...prev, group];
    });
    setActiveGroup(group);
  };

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) { console.error(`${err.name}, ${err.message}`); }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  const speak = async (text: string) => {
    if (isMutedRef.current) return;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const ctx = initAudio();
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
      }
    } catch (e) { console.error("TTS failed", e); }
  };

  const playSystemSound = (type: 'ON' | 'OFF') => {
    const ctx = initAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    if (type === 'ON') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    }
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  };

  const stopAudioLoop = useCallback(() => {
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
    releaseWakeLock();
    setSirenTimeLeft(0);
    setIsMuted(false);
  }, []);

  useEffect(() => {
    if (activeAlerts.length === 0) {
      stopAudioLoop();
      return;
    }
    if (sirenIntervalRef.current) return;

    const ctx = initAudio();
    requestWakeLock();
    setSirenTimeLeft(300);

    const playPulse = (startTime: number, volume: number, isSquare: boolean) => {
      if (isMutedRef.current) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isSquare ? 'square' : 'sine';
      osc.frequency.setValueAtTime(isSquare ? 650 : 400, startTime);
      osc.frequency.exponentialRampToValueAtTime(isSquare ? 1300 : 200, startTime + 0.15);
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    };

    sirenIntervalRef.current = window.setInterval(() => {
      if (isMutedRef.current) {
        setSirenTimeLeft(prev => prev > 0 ? prev - 1 : 0);
        return;
      }
      const currentAlerts = activeAlertsRef.current;
      if (currentAlerts.length === 0) return;
      const volume = currentAlerts.length > 1 ? 0.5 : 0.3;
      playPulse(ctx.currentTime, volume, true);
      if (currentAlerts.length > 1) {
        playPulse(ctx.currentTime + 0.2, volume, false);
      }
      setSirenTimeLeft(prev => {
        const nextVal = prev - 1;
        if (nextVal > 60 && nextVal % 12 === 0) {
          if (currentAlerts.length > 1) {
            speak("Multiple threats detected. High alert, High Alert, High alert.");
          } else if (currentAlerts.length === 1) {
            speak(`Alert detected from ${currentAlerts[0].location}.`);
          }
        }
        if (nextVal <= 0) {
          stopAudioLoop();
          return 0;
        }
        return nextVal;
      });
    }, 1000);
    return () => { if (activeAlerts.length === 0) stopAudioLoop(); };
  }, [activeAlerts.length > 0, stopAudioLoop]);

  const triggerAlert = useCallback(async (type: AlertType, severity: AlertSeverity) => {
    if (!currentUser || !activeGroup) return;
    playSystemSound('ON');
    setIsMuted(false);
    const newAlert: EmergencyAlert = {
      id: Math.random().toString(36).substr(2, 9),
      type, severity,
      location: currentUser.name,
      timestamp: new Date(),
      status: 'ACTIVE',
      description: `Emergency ${type.toLowerCase()} broadcast.`,
      triggeredBy: currentUser.id
    };
    const groupId = activeGroup.id;
    setAlertsByGroup(prev => {
      const existing = prev[groupId] || [];
      return { ...prev, [groupId]: [newAlert, ...existing] };
    });
    const advice = await getEvacuationPlan(type, currentUser.name);
    setEvacuationAdvice(prev => ({ ...prev, [newAlert.id]: advice }));
    if (activeAlertsRef.current.length === 0) {
      speak(`Alert detected from ${currentUser.name}.`);
    } else {
      speak("Multiple threats detected. High alert, High Alert, High alert.");
    }
  }, [currentUser, activeGroup]);

  const handleNotified = () => {
    setIsMuted(true);
    playSystemSound('OFF');
  };

  const resolveAlert = (id: string) => {
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const groupAlerts = alertsByGroup[groupId] || [];
    const alertToResolve = groupAlerts.find(a => a.id === id);
    if (!alertToResolve) return;
    if (alertToResolve.triggeredBy !== currentUser?.id) return;
    playSystemSound('OFF');
    setAlertsByGroup(prev => {
      const existing = prev[groupId] || [];
      const updated = existing.map(a => a.id === id ? { ...a, status: 'RESOLVED', resolvedAt: new Date() } : a);
      return { ...prev, [groupId]: updated };
    });
    const remainingAlerts = groupAlerts.filter(a => a.id !== id && a.status === 'ACTIVE');
    if (remainingAlerts.length > 0) {
      speak("Threat level decreased.");
    } else {
      speak("System normalized. All threats resolved.");
      stopAudioLoop();
    }
  };

  const handleAddCamera = () => {
    if (!newCam.name || !newCam.url || !newCam.key) return;
    setIsLinking(true);
    setTimeout(() => {
      const cam: Camera = { 
        id: Math.random().toString(36).substr(2, 5), 
        name: newCam.name, 
        streamUrl: newCam.url, 
        streamKey: newCam.key,
        status: 'ONLINE' 
      };
      setCameras(prev => [...prev, cam]);
      setNewCam({ name: '', url: '', key: '' });
      setIsLinking(false);
      setShowAdminPanel(false);
    }, 1200);
  };

  const formatTime = (seconds: number) => {
    if (seconds <= 0) return "TIME EXPIRED";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSwitchHub = (groupId: string) => {
    const found = joinedGroups.find(g => g.id === groupId);
    if (!found) return;
    setActiveGroup(found);
  };

  const handleLeaveHub = (groupId: string) => {
    setJoinedGroups(prev => {
      const updated = prev.filter(g => g.id !== groupId);
      if (activeGroup && activeGroup.id === groupId) {
        const nextActive = updated[0] || null;
        setActiveGroup(nextActive);
        if (!nextActive) {
          setAuthStep('ONBOARDING');
        }
      }
      return updated;
    });
  };

  const handleEnterHub = (groupId: string) => {
    const found = joinedGroups.find(g => g.id === groupId);
    if (!found) return;
    if (!currentUser) {
      const name = societyUsername || 'Resident';
      const user: User = { id: 'u_' + Date.now(), name, email: '', role: 'USER' };
      setCurrentUser(user);
    }
    setActiveGroup(found);
    setAuthStep('DASHBOARD');
  };

  const handleManageHubs = () => {
    if (currentUser) {
      setSocietyUsername(currentUser.name);
    }
    setAuthStep('ONBOARDING');
  };

  const currentComplaints: Complaint[] = activeGroup ? (complaintsByGroup[activeGroup.id] || []) : [];
  const isActiveHubAdmin = !!(currentUser && activeGroup && currentUser.id === activeGroup.adminId);
  const currentMembers: User[] = activeGroup ? (activeGroup.members || []) : [];
  const isCurrentUserBanned = !!(
    currentUser &&
    activeGroup &&
    (bannedByGroup[activeGroup.id] || []).includes(currentUser.id)
  );

  const handleSubmitComplaint = () => {
    if (!currentUser || !activeGroup) return;
    const subject = complaintSubject.trim();
    const description = complaintDescription.trim();
    if (!subject || !description) return;

    const complaint: Complaint = {
      id: 'C-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      subject,
      description,
      createdAt: new Date(),
      createdBy: currentUser.id,
      reporterName: currentUser.name,
      groupId: activeGroup.id,
      status: 'OPEN',
    };

    setComplaintsByGroup(prev => {
      const existing = prev[activeGroup.id] || [];
      return { ...prev, [activeGroup.id]: [complaint, ...existing] };
    });

    setComplaintSubject('');
    setComplaintDescription('');
  };

  const handleMarkComplaintRead = (id: string) => {
    if (!activeGroup) return;
    setComplaintsByGroup(prev => {
      const existing = prev[activeGroup.id] || [];
      const updated = existing.filter(c => c.id !== id);
      return { ...prev, [activeGroup.id]: updated };
    });
  };

  const handleToggleBanUser = (userId: string) => {
    if (!activeGroup || !isActiveHubAdmin) return;
    if (userId === currentUser?.id) return;
    setBannedByGroup(prev => {
      const existing = prev[activeGroup.id] || [];
      const isBanned = existing.includes(userId);
      const updated = isBanned ? existing.filter(id => id !== userId) : [...existing, userId];
      return { ...prev, [activeGroup.id]: updated };
    });
  };

  if (authStep === 'LOGIN') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-900 rounded-[2.5rem] p-10 shadow-2xl border border-slate-800 space-y-8">
          <div className="w-20 h-20 bg-fuchsia-600 rounded-3xl mx-auto flex items-center justify-center shadow-lg shadow-fuchsia-500/20"><i className="fas fa-shield-alt text-white text-4xl"></i></div>
          <h1 className="text-3xl font-black text-white tracking-tight">SocietyShield</h1>
          <button onClick={() => setAuthStep('AUTH')} className="w-full bg-white text-slate-950 h-14 rounded-2xl font-bold flex items-center justify-center space-x-3 transition-transform active:scale-95">
	         <span>Get Started</span>
          </button>
        </div>
      </div>
    );
  }

  if (authStep === 'AUTH') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 rounded-[2.5rem] p-10 shadow-2xl border border-slate-800 space-y-8 text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-3xl mx-auto flex items-center justify-center text-fuchsia-400">
            <i className="fas fa-user-shield text-2xl"></i>
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Secure your Hub</h2>
            <p className="text-slate-400 text-xs uppercase font-bold tracking-[0.2em] mt-3">Sign in to save hubs & alerts</p>
          </div>
          <button onClick={handleGoogleLogin} className="w-full bg-white text-slate-950 h-12 rounded-2xl font-bold flex items-center justify-center space-x-3 transition-transform active:scale-95">
            <i className="fab fa-google text-lg"></i>
            <span>Continue with Google</span>
          </button>
          <button onClick={() => setAuthStep('ONBOARDING')} className="w-full text-[11px] text-slate-400 mt-2 underline-offset-4 hover:underline">
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (authStep === 'ONBOARDING') {
    if (joinedGroups.length > 0) {
      const sorted = [...joinedGroups].sort((a, b) => a.name.localeCompare(b.name));
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-[2fr,1.4fr] gap-8">
            <div className="bg-slate-900 rounded-[2.5rem] p-8 border border-slate-800 flex flex-col">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">Your Hubs</h2>
                  <p className="text-slate-400 text-[10px] uppercase font-bold tracking-[0.2em] mt-2">Tap a hub to enter</p>
                </div>
              </div>
              <div className="space-y-3 overflow-y-auto pr-1 max-h-[420px]">
                {sorted.map(g => {
                  const isAdmin = currentUser?.id === g.adminId;
                  return (
                    <button
                      key={g.id}
                      onClick={() => handleEnterHub(g.id)}
                      className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 transition-colors px-4 py-3 rounded-2xl text-left"
                      type="button"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-xs font-black text-slate-100">
                          {g.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-black text-white tracking-tight">{g.name}</div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{g.id}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${isAdmin ? 'bg-fuchsia-600/20 text-fuchsia-300' : 'bg-slate-700 text-slate-300'}`}>
                          {isAdmin ? 'Admin' : 'Member'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLeaveHub(g.id);
                          }}
                          className="text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-slate-600 text-slate-300 hover:bg-red-900/40 hover:border-red-500 hover:text-red-200"
                        >
                          Leave
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-900 rounded-[2.5rem] p-8 border border-slate-800 text-center">
                <h2 className="text-2xl font-black text-white mb-2 tracking-tight">Resident Identity</h2>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-[0.2em] mb-6">Identifies all alerts you trigger</p>
                <input value={societyUsername} onChange={(e) => setSocietyUsername(e.target.value)} placeholder="Full Name (e.g., Alex Johnson)" className="w-full bg-slate-800 border border-slate-700 h-14 rounded-2xl px-6 text-white font-bold text-center focus:border-fuchsia-500 outline-none transition-all" />
              </div>
              <div className="bg-slate-900 rounded-[2.5rem] p-8 border border-slate-800 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-[0.2em]">Add Another Hub</h3>
                <div className={`space-y-3 ${!societyUsername && 'opacity-50 pointer-events-none'}`}>
                  <input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Network ID" className="w-full bg-slate-800 border border-slate-700 h-12 rounded-2xl px-4 text-white text-center text-sm" />
                  <button
                    onClick={() => {
                      const user: User = currentUser || { id: 'u_' + Date.now(), name: societyUsername, email: '', role: 'USER' };
                      const group: Group = { id: joinId || 'SHIELD-01', name: 'Skyline Community', adminId: 'a1', members: [] };
                      setCurrentUser(user);
                      registerJoinedGroup(group);
                      setAuthStep('DASHBOARD');
                    }}
                    className="w-full bg-blue-600 text-white h-11 rounded-2xl font-bold text-sm"
                  >
                    Join Network
                  </button>
                </div>
                <div className={`border-t border-slate-800 pt-4 mt-2 space-y-3 ${!societyUsername && 'opacity-50 pointer-events-none'}`}>
                  <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="New Hub Name" className="w-full bg-slate-800 border border-slate-700 h-12 rounded-2xl px-4 text-white text-center text-sm" />
                  <button
                    onClick={() => {
                      const user: User = currentUser || { id: 'u_' + Date.now(), name: societyUsername, email: '', role: 'ADMIN' };
                      const hubId = 'HUB-' + Math.floor(Math.random() * 999);
                      const trialMembers: User[] = [
                        { id: hubId + '_trial1', name: 'Trial Member 1', email: '', role: 'USER', groupId: hubId },
                        { id: hubId + '_trial2', name: 'Trial Member 2', email: '', role: 'USER', groupId: hubId },
                        { id: hubId + '_trial3', name: 'Trial Member 3', email: '', role: 'USER', groupId: hubId },
                      ];
                      const group: Group = {
                        id: hubId,
                        name: newGroupName || 'Sentinel Society',
                        adminId: user.id,
                        members: [user, ...trialMembers],
                      };

                      // Seed a trial complaint so the admin can test the ban feature
                      const trialSource = trialMembers[0];
                      const trialComplaint: Complaint = {
                        id: 'C-TRIAL-' + Math.random().toString(36).substr(2, 5).toUpperCase(),
                        subject: 'Trial resident complaint',
                        description: 'Auto-created trial complaint to help you test the ban feature. You can safely ignore this entry.',
                        createdAt: new Date(),
                        createdBy: trialSource.id,
                        reporterName: trialSource.name,
                        groupId: group.id,
                        status: 'OPEN',
                      };
                      setComplaintsByGroup(prev => {
                        const existing = prev[group.id] || [];
                        return { ...prev, [group.id]: [trialComplaint, ...existing] };
                      });

                      setCurrentUser(user);
                      registerJoinedGroup(group);
                      setAuthStep('DASHBOARD');
                    }}
                    className="w-full bg-fuchsia-600 text-white h-11 rounded-2xl font-bold text-sm"
                  >
                    Create Hub
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-4xl w-full space-y-8">
          <div className="bg-slate-900 rounded-[2.5rem] p-8 border border-slate-800 text-center">
             <h2 className="text-2xl font-black text-white mb-2 tracking-tight">Resident Identity</h2>
             <p className="text-slate-400 text-[10px] uppercase font-bold tracking-[0.2em] mb-6">Identifies all alerts you trigger</p>
             <input value={societyUsername} onChange={(e) => setSocietyUsername(e.target.value)} placeholder="Full Name (e.g., Alex Johnson)" className="w-full max-w-lg bg-slate-800 border border-slate-700 h-16 rounded-2xl px-8 text-white font-bold text-center focus:border-fuchsia-500 outline-none transition-all" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className={`bg-slate-900 rounded-[2.5rem] p-10 border border-slate-800 space-y-6 ${!societyUsername && 'opacity-50 pointer-events-none'}`}>
              <h2 className="text-2xl font-black text-white">Join Sector</h2>
              <input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Network ID" className="w-full bg-slate-800 border border-slate-700 h-14 rounded-2xl px-6 text-white text-center" />
              <button
                onClick={() => {
                  const user: User = { id: 'u_' + Date.now(), name: societyUsername, email: '', role: 'USER' };
                  const group: Group = { id: joinId || 'SHIELD-01', name: 'Skyline Community', adminId: 'a1', members: [] };
                  setCurrentUser(user);
                  registerJoinedGroup(group);
                  setAuthStep('DASHBOARD');
                }}
                className="w-full bg-blue-600 text-white h-14 rounded-2xl font-bold"
              >
                Join Network
              </button>
            </div>
            <div className={`bg-slate-900 rounded-[2.5rem] p-10 border border-fuchsia-500/20 space-y-6 ${!societyUsername && 'opacity-50 pointer-events-none'}`}>
              <h2 className="text-2xl font-black text-white">New Hub</h2>
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Society Name" className="w-full bg-slate-800 border border-slate-700 h-14 rounded-2xl px-6 text-white text-center" />
              <button
                onClick={() => {
                  const user: User = { id: 'u_' + Date.now(), name: societyUsername, email: '', role: 'ADMIN' };
                  const hubId = 'HUB-' + Math.floor(Math.random() * 999);
                  const trialMembers: User[] = [
                    { id: hubId + '_trial1', name: 'Trial Member 1', email: '', role: 'USER', groupId: hubId },
                    { id: hubId + '_trial2', name: 'Trial Member 2', email: '', role: 'USER', groupId: hubId },
                    { id: hubId + '_trial3', name: 'Trial Member 3', email: '', role: 'USER', groupId: hubId },
                  ];
                  const group: Group = {
                    id: hubId,
                    name: newGroupName || 'Sentinel Society',
                    adminId: user.id,
                    members: [user, ...trialMembers],
                  };

                  const trialSource = trialMembers[0];
                  const trialComplaint: Complaint = {
                    id: 'C-TRIAL-' + Math.random().toString(36).substr(2, 5).toUpperCase(),
                    subject: 'Trial resident complaint',
                    description: 'Auto-created trial complaint to help you test the ban feature. You can safely ignore this entry.',
                    createdAt: new Date(),
                    createdBy: trialSource.id,
                    reporterName: trialSource.name,
                    groupId: group.id,
                    status: 'OPEN',
                  };
                  setComplaintsByGroup(prev => {
                    const existing = prev[group.id] || [];
                    return { ...prev, [group.id]: [trialComplaint, ...existing] };
                  });

                  setCurrentUser(user);
                  registerJoinedGroup(group);
                  setAuthStep('DASHBOARD');
                }}
                className="w-full bg-fuchsia-600 text-white h-14 rounded-2xl font-bold"
              >
                Create Hub
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="bg-slate-900 text-white px-8 py-2 text-[10px] flex justify-between items-center font-bold uppercase tracking-widest">
        <span>{currentUser?.name} | {activeGroup?.name}</span>
        <div className="flex items-center space-x-6">
          <span className="opacity-50">NODE: {activeGroup?.id}</span>
          <button onClick={() => setAuthStep('LOGIN')} className="hover:text-red-400">Sign Out</button>
        </div>
      </div>

      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg"><i className="fas fa-shield-alt text-white"></i></div>
          <span className="text-xl font-black tracking-tight">Society<span className="text-fuchsia-600">Shield</span></span>
        </div>
        <div className="relative flex items-center space-x-3">
          {activeGroup && (
            <button
              onClick={() => setShowHubMenu(prev => !prev)}
              className="text-xs font-bold px-4 py-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition-all flex items-center shadow-sm"
            >
              <i className="fas fa-layer-group mr-2 text-slate-500"></i>
              <span className="mr-2 truncate max-w-[140px]">{activeGroup.name}</span>
              <i className={`fas fa-chevron-${showHubMenu ? 'up' : 'down'} text-[10px] text-slate-400`}></i>
            </button>
          )}
          {joinedGroups.length > 0 && (
            <button onClick={handleManageHubs} className="hidden md:inline-flex text-xs font-bold px-4 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-all items-center">
              <span className="mr-1">Manage</span>
              <i className="fas fa-pen text-[11px]"></i>
            </button>
          )}
          <button onClick={() => setShowAdminPanel(!showAdminPanel)} className="text-xs font-bold px-4 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-all">
            <i className="fas fa-satellite mr-2"></i> OBS PROVISIONING
          </button>
          {showHubMenu && joinedGroups.length > 0 && (
            <div className="absolute right-0 top-12 mt-1 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 bg-slate-50">Switch Hub</div>
              <div className="max-h-64 overflow-y-auto py-1">
                {joinedGroups.map(g => {
                  const isActive = activeGroup?.id === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => {
                        handleSwitchHub(g.id);
                        setShowHubMenu(false);
                      }}
                      disabled={isActive}
                      className={`w-full flex items-center justify-between px-4 py-2 text-xs border-b border-slate-50 last:border-b-0 ${
                        isActive ? 'bg-slate-900 text-white cursor-default' : 'bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-black truncate max-w-[150px]">{g.name}</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{g.id}</span>
                      </div>
                      {isActive && <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Active</span>}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  setShowHubMenu(false);
                  handleManageHubs();
                }}
                className="w-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-600 bg-fuchsia-50 hover:bg-fuchsia-100 border-t border-fuchsia-100"
              >
                View / Add Hubs
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {currentUser && joinedGroups.length > 0 && (
          <div className="bg-slate-900 text-white rounded-[2.5rem] p-6 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Your Hubs</h3>
              <p className="text-xs text-slate-300 mt-1">Switch, leave, or manage the societies you are connected to.</p>
              <button
                onClick={handleManageHubs}
                className="mt-3 inline-flex items-center px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-white text-slate-900 hover:bg-slate-100"
              >
                <i className="fas fa-layer-group mr-2"></i>
                View / Add Hubs
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              {joinedGroups.map((g) => {
                const isActive = activeGroup?.id === g.id;
                const canDelete = currentUser.role === 'ADMIN' && g.adminId === currentUser.id;
                return (
                  <div key={g.id} className="flex items-center space-x-2 bg-slate-800 rounded-2xl px-4 py-2 text-xs font-bold uppercase tracking-widest border border-slate-700">
                    <span className="text-slate-200">{g.name}</span>
                    <span className="text-[9px] text-slate-500">{g.id}</span>
                    <button
                      onClick={() => handleSwitchHub(g.id)}
                      disabled={isActive}
                      className={`ml-2 px-3 py-1 rounded-full text-[9px] font-black ${isActive ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40 cursor-default' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
                    >
                      Switch
                    </button>
                    <button
                      onClick={() => handleLeaveHub(g.id)}
                      className="px-3 py-1 rounded-full text-[9px] font-black bg-slate-900 text-slate-300 hover:text-red-300 hover:bg-red-900/40"
                    >
                      Leave
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => handleLeaveHub(g.id)}
                        className="px-3 py-1 rounded-full text-[9px] font-black bg-red-600 text-white hover:bg-red-500"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {pendingMonthlyReport && (
          <div className="bg-fuchsia-600 text-white p-6 rounded-[2rem] flex items-center justify-between animate-pulse shadow-xl shadow-fuchsia-500/30">
            <div className="flex items-center space-x-4">
               <i className="fas fa-calendar-check text-2xl"></i>
               <div>
                  <h4 className="font-black text-sm uppercase tracking-widest">New Monthly Archive Ready</h4>
                  <p className="text-[10px] font-bold opacity-80 uppercase">Download report to clear previous logs and maintain performance.</p>
               </div>
            </div>
            <button onClick={handleArchivePreviousMonth} className="bg-white text-fuchsia-600 px-8 py-3 rounded-xl font-black text-[10px] uppercase shadow-lg active:scale-95 transition-transform">Download & Clear Logs</button>
          </div>
        )}

        {isCurrentUserBanned && (
          <div className="bg-amber-100 border border-amber-200 text-amber-800 text-xs font-bold px-4 py-3 rounded-2xl flex items-center space-x-2">
            <i className="fas fa-ban"></i>
            <span>
              Your profile has been restricted from triggering emergency alerts by the hub admin.
            </span>
          </div>
        )}

        <CommandCenter onTrigger={triggerAlert} disabled={activeAlerts.length >= 8 || isCurrentUserBanned} />

        <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Live Sensor Feed</h3>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Resident Stream Active</p>
            </div>
            {cameras.length > 0 && (
              <div className="flex space-x-2">
                {cameras.map((c, idx) => (
                  <button key={c.id} onClick={() => setActiveCameraIndex(idx)} className={`w-10 h-10 rounded-xl text-[10px] font-black border-2 transition-all ${activeCameraIndex === idx ? 'bg-fuchsia-600 border-fuchsia-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-400'}`}>
                    {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-full">
            {cameras.length > 0 ? (
              <CameraMonitor cameraName={cameras[activeCameraIndex]?.name} streamUrl={cameras[activeCameraIndex]?.streamUrl} streamKey={cameras[activeCameraIndex]?.streamKey} status={cameras[activeCameraIndex]?.status} />
            ) : (
              <div className="aspect-video bg-slate-900 rounded-[2rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center p-12 text-center">
                 <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 text-slate-600 animate-pulse"><i className="fas fa-video-slash text-2xl"></i></div>
                 <h3 className="text-xl font-black text-white uppercase tracking-tighter tracking-widest text-sm mb-4">No Cameras Linked</h3>
                 <button onClick={() => setShowAdminPanel(true)} className="bg-white text-slate-950 px-8 py-3 rounded-2xl font-black text-xs hover:bg-slate-100 shadow-2xl">LINK OBS NODE</button>
              </div>
            )}
          </div>
        </div>

        {activeAlerts.length > 0 && (
          <div className="space-y-6">
            <div className={`border-2 p-6 rounded-[2rem] flex items-center justify-between transition-all ${activeAlerts.length > 1 ? 'bg-red-600 border-red-600 text-white shadow-red-500/50 shadow-2xl' : 'bg-red-50 border-red-200 text-red-600'}`}>
               <div className="flex items-center space-x-4">
                 <i className={`fas fa-exclamation-triangle text-2xl animate-bounce ${activeAlerts.length > 1 ? 'text-white' : 'text-red-600'}`}></i>
                 <div>
                    <h4 className="font-black text-lg uppercase tracking-tight leading-none">
                      {activeAlerts.length > 1 ? 'MULTIPLE THREATS DETECTED' : 'SYSTEM EMERGENCY'}
                    </h4>
                    <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${activeAlerts.length > 1 ? 'text-white/80' : 'opacity-75'}`}>
                      {isMuted ? 'AUDIO NOTIFIED / SILENCED' : `ALARM CLOCK: ${formatTime(sirenTimeLeft)}`}
                    </p>
                 </div>
               </div>
               {!isMuted && (
                 <button onClick={handleNotified} className={`px-10 py-3 rounded-xl font-black text-xs uppercase shadow-lg transition-transform active:scale-95 ${activeAlerts.length > 1 ? 'bg-white text-red-600' : 'bg-red-600 text-white shadow-red-600/20'}`}>
                   NOTIFIED (SILENCE)
                 </button>
               )}
            </div>
            
            <div className="grid grid-cols-1 gap-6">
              {activeAlerts.map(alert => (
                <div key={alert.id} className="bg-slate-900 rounded-[2.5rem] p-8 border-2 border-red-500 shadow-2xl relative overflow-hidden animate-in slide-in-from-top-6">
                  <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center space-x-3">
                        <span className="bg-red-600 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tighter">DISPATCH #{alert.id.toUpperCase()}</span>
                        <span className="text-white/40 text-[10px] font-bold uppercase tracking-widest">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <h2 className="text-4xl font-black text-white tracking-tighter uppercase leading-none">
                        {alert.type} <span className="text-red-500">FROM {alert.location.toUpperCase()}</span>
                      </h2>
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
                        <p className="text-slate-100 text-lg font-light italic leading-snug tracking-tight">"{evacuationAdvice[alert.id] || 'Synthesizing localized guidance...'}"</p>
                      </div>
                    </div>
                    <div className="flex flex-col space-y-3 w-full md:w-64">
                      {alert.triggeredBy === currentUser?.id ? (
                        <button onClick={() => resolveAlert(alert.id)} className="w-full py-5 bg-white text-slate-950 font-black rounded-2xl hover:bg-slate-100 shadow-2xl text-sm uppercase transition-transform active:scale-95">RESOLVE ALERT</button>
                      ) : (
                        <div className="w-full py-5 bg-slate-800/50 border border-white/10 text-white/30 font-black rounded-2xl text-center text-[10px] uppercase tracking-widest cursor-not-allowed">RESTRICTED TO {alert.location.split(' ')[0].toUpperCase()}</div>
                      )}
                    </div>
                  </div>
                  <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[repeating-linear-gradient(45deg,transparent,transparent_40px,#ff0000_40px,#ff0000_80px)] animate-pulse"></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showAdminPanel && (
          <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
            <div className="bg-white rounded-[3rem] p-10 max-w-4xl w-full shadow-2xl border border-slate-200">
              <div className="flex justify-between mb-8 items-start">
                 <div>
                    <h3 className="text-3xl font-black tracking-tight text-slate-900 uppercase">Hub Provisioning</h3>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-2">OBS Server Authentication</p>
                 </div>
                 <button onClick={() => setShowAdminPanel(false)} className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900"><i className="fas fa-times"></i></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <input value={newCam.name} onChange={e => setNewCam({...newCam, name: e.target.value})} placeholder="Node Name" className="w-full bg-slate-50 border p-5 rounded-2xl text-sm font-bold" />
                  <input value={newCam.url} onChange={e => setNewCam({...newCam, url: e.target.value})} placeholder="Stream URL" className="w-full bg-slate-50 border p-5 rounded-2xl text-sm font-mono" />
                  <input type="password" value={newCam.key} onChange={e => setNewCam({...newCam, key: e.target.value})} placeholder="Secret Key" className="w-full bg-slate-950 text-fuchsia-400 border border-slate-800 p-5 rounded-2xl text-sm font-mono" />
                  <button onClick={handleAddCamera} disabled={isLinking} className="w-full bg-slate-900 text-white p-6 rounded-2xl font-black text-sm hover:bg-slate-800 shadow-xl transition-all">
                    {isLinking ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-plug mr-2"></i>}
                    AUTHENTICATE NODE
                  </button>
                </div>
                <div className="bg-slate-50 rounded-[2rem] p-8 border border-slate-100 overflow-y-auto max-h-[400px]">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Linked Nodes ({cameras.length})</p>
                  {cameras.length === 0 ? ( <div className="py-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest opacity-40">Empty</div> ) : cameras.map((c) => (
                    <div key={c.id} className="p-4 rounded-2xl bg-white border border-slate-200 mb-4 flex justify-between items-center shadow-sm">
                      <span className="text-sm font-black text-slate-900">{c.name}</span>
                      <button onClick={() => setCameras(prev => prev.map(cam => cam.id === c.id ? { ...cam, status: cam.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE' } : cam))} className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.status === 'ONLINE' ? 'text-green-600' : 'text-red-600'}`}><i className={`fas ${c.status === 'ONLINE' ? 'fa-play' : 'fa-power-off'}`}></i></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm space-y-4">
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">File a Complaint</h3>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                Non-emergency issues for society admins
              </p>
            </div>
            <input
              value={complaintSubject}
              onChange={(e) => setComplaintSubject(e.target.value)}
              placeholder="Subject (e.g., Noise after 11PM)"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            />
            <textarea
              value={complaintDescription}
              onChange={(e) => setComplaintDescription(e.target.value)}
              placeholder="Describe the issue with as much detail as possible..."
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm h-32 resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            />
            <button
              onClick={handleSubmitComplaint}
              disabled={!complaintSubject.trim() || !complaintDescription.trim() || !currentUser || !activeGroup}
              className="w-full bg-slate-900 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
            >
              Submit Complaint
            </button>
          </div>

          <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">
                  {isActiveHubAdmin ? 'Resident Complaints Inbox' : 'Your Filed Complaints'}
                </h3>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">This hub only</p>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {currentComplaints.length} total • {currentUser ? (isActiveHubAdmin ? 'Admin View' : 'Resident View') : 'Guest'}
              </span>
            </div>
            {currentComplaints.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                No complaints filed yet
              </div>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {(isActiveHubAdmin
                  ? currentComplaints
                  : currentComplaints.filter(c => c.createdBy === currentUser?.id)
                ).map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex flex-col space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-900 truncate mr-2">{c.subject}</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          Unread
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                          {c.createdAt.toLocaleDateString()} • {c.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          onClick={() => setExpandedComplaintId(prev => (prev === c.id ? null : c.id))}
                          className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-100"
                        >
                          {expandedComplaintId === c.id ? 'Hide' : 'Read'}
                        </button>
                      </div>
                    </div>
                    <p className={`text-xs text-slate-600 ${expandedComplaintId === c.id ? '' : 'line-clamp-2'}`}>
                      {c.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        Reported by {c.reporterName}
                      </span>
                      {isActiveHubAdmin && (
                        <button
                          onClick={() => handleMarkComplaintRead(c.id)}
                          className="text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-100"
                        >
                          Mark as Read
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isActiveHubAdmin && (
            <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Hub Members</h3>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Manage alert permissions</p>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {currentMembers.length} member{currentMembers.length === 1 ? '' : 's'}
                </span>
              </div>
              {currentMembers.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                  No members registered
                </div>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {currentMembers.map((m) => {
                    const isMemberBanned = !!(
                      activeGroup &&
                      (bannedByGroup[activeGroup.id] || []).includes(m.id)
                    );
                    const isAdminMember = m.id === activeGroup?.adminId;
                    const canBan = !isAdminMember && m.id !== currentUser?.id;
                    return (
                      <div
                        key={m.id}
                        className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-900">{m.name}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                            {isAdminMember ? 'Admin' : 'Member'}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            isMemberBanned
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {isMemberBanned ? 'Alerts Blocked' : 'Alerts Allowed'}
                          </span>
                          {canBan && (
                            <button
                              onClick={() => handleToggleBanUser(m.id)}
                              className="text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-red-200 text-red-600 hover:bg-red-50"
                            >
                              {isMemberBanned ? 'Unban' : 'Ban'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <AlertHistory alerts={allAlerts} members={[]} />
      </main>
    </div>
  );
};

export default App;
