
import React from 'react';

interface DashboardCardProps {
  title: string;
  value: string | number;
  icon: string;
  trend?: string;
  trendDirection?: 'up' | 'down';
  color: string;
}

const DashboardCard: React.FC<DashboardCardProps> = ({ title, value, icon, trend, trendDirection, color }) => {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">{title}</p>
          <h3 className="text-2xl font-bold mt-1 text-gray-900">{value}</h3>
          {trend && (
            <p className={`text-xs mt-2 font-semibold ${trendDirection === 'down' ? 'text-green-500' : 'text-red-500'}`}>
              <i className={`fas fa-arrow-${trendDirection === 'down' ? 'down' : 'up'} mr-1`}></i>
              {trend}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${color} text-white`}>
          <i className={`fas ${icon} text-xl`}></i>
        </div>
      </div>
    </div>
  );
};

export default DashboardCard;
