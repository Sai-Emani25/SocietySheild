
import React from 'react';
import { EmergencyAlert, User } from '../types';

interface AlertHistoryProps {
  alerts: EmergencyAlert[];
  members: User[];
}

const AlertHistory: React.FC<AlertHistoryProps> = ({ alerts, members }) => {
  const getMemberName = (id: string) => members.find(m => m.id === id)?.name || 'Resident Member';

  const formatResolutionTime = (start: Date, end?: Date) => {
    if (!end) return 'N/A';
    const diff = end.getTime() - start.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const downloadFile = (data: string, type: string, extension: string) => {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SocietyShield_Audit_${new Date().toISOString().split('T')[0]}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleJSONExport = () => {
    downloadFile(JSON.stringify(alerts, null, 2), 'application/json', 'json');
  };

  const handleCSVExport = () => {
    const headers = ['TriggeredBy', 'Type', 'Timestamp', 'ResolutionTime', 'Status'];
    const rows = alerts.map(a => [
      a.location, // In our app, location is set to User Name
      a.type,
      a.timestamp.toISOString(),
      a.resolvedAt ? formatResolutionTime(a.timestamp, a.resolvedAt) : 'ACTIVE',
      a.status
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csvContent, 'text/csv', 'csv');
  };

  return (
    <div className="bg-white rounded-[2rem] p-8 border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight">Audit Log History</h3>
          <p className="text-sm text-slate-500">Persistent encrypted chronology of all society dispatches</p>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={handleJSONExport} 
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg active:scale-95 transition-all"
            disabled={alerts.length === 0}
          >
            <i className="fas fa-file-code mr-2"></i> Export JSON
          </button>
          <button 
            onClick={handleCSVExport} 
            className="px-4 py-2 border-2 border-slate-900 text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 shadow-sm active:scale-95 transition-all"
            disabled={alerts.length === 0}
          >
            <i className="fas fa-file-csv mr-2"></i> Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-separate border-spacing-y-3">
          <thead>
            <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">
              <th className="pb-4 pl-6">Reporting Resident</th>
              <th className="pb-4">Classification</th>
              <th className="pb-4">Dispatch Time</th>
              <th className="pb-4">Response Time</th>
              <th className="pb-4 pr-6 text-right">Operation Status</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-24 text-center">
                  <div className="flex flex-col items-center opacity-20">
                    <i className="fas fa-clipboard-list text-5xl mb-4"></i>
                    <p className="font-black text-xs uppercase tracking-widest">No Security Dispatches Recorded</p>
                  </div>
                </td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id} className="group bg-slate-50/50 hover:bg-slate-100/80 transition-all border border-transparent hover:border-slate-200 cursor-default">
                  <td className="py-5 pl-6 rounded-l-3xl">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-slate-900 font-black border border-slate-100">
                        {alert.location.charAt(0)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-900 group-hover:text-fuchsia-600 transition-colors">
                          {alert.location}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Verified Member</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-5">
                    <div className="flex items-center space-x-2">
                       <span className={`w-2 h-2 rounded-full ${
                        alert.type === 'FIRE' ? 'bg-red-500' : 
                        alert.type === 'CRIME' ? 'bg-amber-500' : 
                        alert.type === 'DISASTER' ? 'bg-orange-500' : 'bg-slate-400'
                       }`}></span>
                       <span className="text-sm font-bold text-slate-800">{alert.type}</span>
                    </div>
                  </td>
                  <td className="py-5">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-600">
                        {alert.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {alert.timestamp.toLocaleDateString()}
                      </span>
                    </div>
                  </td>
                  <td className="py-5">
                    {alert.status === 'RESOLVED' ? (
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-green-600 flex items-center">
                          <i className="fas fa-bolt mr-1.5"></i>
                          {formatResolutionTime(alert.timestamp, alert.resolvedAt)}
                        </span>
                        <span className="text-[10px] text-slate-400">Verified Cleared</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-red-500 animate-pulse">
                        <span className="w-1 h-1 bg-current rounded-full mr-2"></span>
                        <span className="text-xs font-black uppercase tracking-widest">Active Dispatch</span>
                      </div>
                    )}
                  </td>
                  <td className="py-5 pr-6 text-right rounded-r-3xl">
                    <span className={`inline-block text-[9px] font-black px-3 py-1.5 rounded-xl border uppercase tracking-widest ${
                      alert.status === 'ACTIVE' 
                        ? 'bg-red-50 text-red-600 border-red-100' 
                        : 'bg-green-50 text-green-600 border-green-100'
                    }`}>
                      {alert.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AlertHistory;
