
import React, { useEffect, useState, useMemo } from 'react';

interface CameraMonitorProps {
  cameraName: string;
  streamUrl: string;
  streamKey: string;
  status?: 'ONLINE' | 'OFFLINE';
}

const CameraMonitor: React.FC<CameraMonitorProps> = ({ cameraName, streamUrl, streamKey, status = 'ONLINE' }) => {
  const [timestamp, setTimestamp] = useState(new Date().toLocaleString());
  const [signalBars, setSignalBars] = useState([true, true, true, true]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimestamp(new Date().toLocaleString());
      if (status === 'ONLINE') {
        setSignalBars(prev => prev.map(() => Math.random() > 0.05));
      } else {
        setSignalBars([false, false, false, false]);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  const embedUrl = useMemo(() => {
    try {
      if (!streamUrl || status === 'OFFLINE') return null;
      const currentOrigin = window.location.origin;

      if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
        let videoId = '';
        if (streamUrl.includes('v=')) videoId = streamUrl.split('v=')[1].split('&')[0];
        else if (streamUrl.includes('youtu.be/')) videoId = streamUrl.split('youtu.be/')[1].split('?')[0];
        else if (streamUrl.includes('/live/')) videoId = streamUrl.split('/live/')[1].split('?')[0];
        else if (streamUrl.includes('/embed/')) videoId = streamUrl.split('/embed/')[1].split('?')[0];
        
        if (videoId) {
          const params = new URLSearchParams({
            autoplay: '1', mute: '1', controls: '0', modestbranding: '1',
            showinfo: '0', rel: '0', enablejsapi: '1', origin: currentOrigin,
            widget_referrer: currentOrigin, iv_load_policy: '3', disablekb: '1', fs: '0'
          });
          return `https://www.youtube.com/embed/${videoId}?${params.toString()}&t=${refreshKey}`;
        }
      }

      if (streamUrl.includes('twitch.tv')) {
        const parts = streamUrl.split('twitch.tv/');
        const channel = parts[parts.length - 1].split('?')[0];
        const parent = window.location.hostname || 'localhost';
        return `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=true&muted=true&t=${refreshKey}`;
      }
    } catch (e) { console.error("URL Parsing Error", e); }
    return null;
  }, [streamUrl, status, refreshKey]);

  const maskedKey = streamKey.length > 8 ? `${streamKey.slice(0, 4)}••••${streamKey.slice(-4)}` : '••••••••';

  return (
    <div className="relative aspect-video bg-black rounded-[2.5rem] overflow-hidden border border-slate-800 shadow-2xl ring-1 ring-white/10 group">
      {embedUrl && status === 'ONLINE' ? (
        <iframe key={embedUrl} src={embedUrl} className="absolute inset-0 w-full h-full border-none" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" title={cameraName} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-500 p-8 text-center">
          <i className={`fas ${status === 'OFFLINE' ? 'fa-video-slash' : 'fa-satellite-dish'} text-5xl mb-4 opacity-20`}></i>
          <p className="font-mono text-xs uppercase tracking-[0.3em] font-black text-slate-400">{status === 'OFFLINE' ? 'NODE SHUTDOWN' : 'CONNECTING SECURE CHANNEL'}</p>
          <button onClick={() => setRefreshKey(prev => prev + 1)} className="mt-6 text-[10px] font-black uppercase tracking-widest text-fuchsia-400 bg-white/5 px-4 py-2 rounded-xl border border-white/5">FORCE HANDSHAKE</button>
        </div>
      )}

      {/* Cinematic Static & Grain */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.05)_50%)] bg-[length:100%_4px] opacity-20"></div>
      
      {/* HUD Layer */}
      <div className="absolute inset-0 p-8 flex flex-col justify-between z-10 pointer-events-none select-none">
        <div className="flex justify-between items-start">
          <div className="flex flex-col">
            <div className="flex items-center space-x-3">
              <span className={`text-[10px] font-black text-white px-3 py-1 rounded-full uppercase tracking-widest flex items-center shadow-2xl transition-all duration-700 ${status === 'ONLINE' ? 'bg-red-600' : 'bg-slate-800 opacity-50'}`}>
                <span className={`w-2 h-2 rounded-full mr-2 ${status === 'ONLINE' ? 'bg-white animate-pulse' : 'bg-slate-500'}`}></span>
                {status === 'ONLINE' ? 'LIVE' : 'OFF'}
              </span>
              <div className="flex items-end space-x-1 h-4">
                {signalBars.map((active, i) => (
                  <div key={i} className={`w-1 rounded-t-full transition-all duration-300 ${active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-slate-800'}`} style={{ height: `${(i + 1) * 25}%` }}></div>
                ))}
              </div>
            </div>
            <span className="text-white font-black text-4xl mt-4 tracking-tighter uppercase drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]">{cameraName}</span>
            <div className="mt-2 text-[9px] font-black text-fuchsia-400 uppercase tracking-widest flex items-center bg-black/40 px-3 py-1 rounded-full w-fit border border-fuchsia-500/20 backdrop-blur-xl">
              <i className="fas fa-key mr-2 text-[7px]"></i> {maskedKey}
            </div>
          </div>
          <div className="text-right flex flex-col items-end">
            <span className="text-white font-mono text-xs bg-black/80 px-4 py-2 rounded-2xl backdrop-blur-xl border border-white/10 mb-3 shadow-2xl">{timestamp}</span>
            <div className="bg-black/60 px-3 py-1 rounded-full text-[9px] font-black text-slate-400 border border-white/5 uppercase tracking-[0.2em] backdrop-blur-md">NODEID: SHIELD-PRO-OBS</div>
          </div>
        </div>

        <div className="flex justify-between items-end">
          <div className="flex space-x-3 pointer-events-auto">
            <button onClick={() => setRefreshKey(prev => prev + 1)} className="w-12 h-12 rounded-2xl bg-black/60 flex items-center justify-center text-white/50 border border-white/10 backdrop-blur-xl hover:text-white transition-all hover:bg-black/80"><i className="fas fa-sync-alt text-sm"></i></button>
            <div className={`w-12 h-12 rounded-2xl bg-black/60 flex items-center justify-center border border-white/10 backdrop-blur-xl transition-all ${status === 'ONLINE' ? 'text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'text-slate-700'}`}><i className="fas fa-shield-alt text-sm"></i></div>
          </div>
          <div className="bg-black/80 px-5 py-2.5 rounded-2xl border border-white/10 backdrop-blur-xl text-[10px] font-black flex items-center shadow-2xl text-white uppercase tracking-[0.1em]">
             <i className="fas fa-fingerprint mr-3 text-fuchsia-500"></i> HANDSHAKE VERIFIED
          </div>
        </div>
      </div>
      <div className="absolute inset-0 pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay"></div>
    </div>
  );
};

export default CameraMonitor;
