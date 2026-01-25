
import React from 'react';
import { AlertType, AlertSeverity } from '../types';

interface CommandCenterProps {
  onTrigger: (type: AlertType, severity: AlertSeverity) => void;
  disabled?: boolean;
}

const CommandCenter: React.FC<CommandCenterProps> = ({ onTrigger, disabled }) => {
  const commands = [
    { type: AlertType.FIRE, icon: 'fa-fire', color: 'bg-red-500', label: 'Fire', sub: 'Evacuation protocol' },
    { type: AlertType.DISASTER, icon: 'fa-house-damage', color: 'bg-orange-500', label: 'Disaster', sub: 'Natural event' },
    { type: AlertType.CRIME, icon: 'fa-user-ninja', color: 'bg-amber-500', label: 'Crime', sub: 'Fight / Theft' },
    { type: AlertType.INFESTATION, icon: 'fa-bug', color: 'bg-purple-600', label: 'Infestation', sub: 'Hazard detection' },
    { type: AlertType.LOCKDOWN, icon: 'fa-door-closed', color: 'bg-blue-600', label: 'Lockdown', sub: 'Curfew active' },
  ];

  return (
    <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-xl shadow-gray-200/50">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">One-Click Dispatch</h2>
          <p className="text-sm text-gray-500">Alert 120+ neighbors instantly</p>
        </div>
        <div className="flex items-center space-x-2 text-[10px] font-bold uppercase tracking-widest text-fuchsia-600 bg-fuchsia-50 px-3 py-1 rounded-full">
          <span className="w-2 h-2 bg-fuchsia-600 rounded-full animate-pulse"></span>
          <span>Broadcasting Ready</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {commands.map((cmd) => (
          <button
            key={cmd.type}
            disabled={disabled}
            onClick={() => onTrigger(cmd.type, AlertSeverity.CRITICAL)}
            className={`group relative flex flex-col items-center justify-center p-6 rounded-2xl transition-all duration-300 hover:scale-105 active:scale-95 ${
              disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-lg shadow-sm cursor-pointer'
            } border border-gray-50 bg-white`}
          >
            <div className={`w-14 h-14 ${cmd.color} rounded-full flex items-center justify-center text-white mb-3 shadow-md group-hover:shadow-inner transition-shadow`}>
              <i className={`fas ${cmd.icon} text-xl`}></i>
            </div>
            <span className="text-sm font-bold text-gray-900">{cmd.label}</span>
            <span className="text-[10px] text-gray-400 mt-1">{cmd.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CommandCenter;
