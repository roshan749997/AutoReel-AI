import React from 'react';

export const Card = ({ children, className = '', hover = false, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`bg-slate-900/70 backdrop-blur-sm border border-slate-800/80 rounded-xl p-5 transition-all duration-200 ${
        hover ? 'hover:border-slate-700 hover:shadow-lg hover:shadow-slate-950/50 cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};

export const CardHeader = ({ title, subtitle, action, className = '' }) => {
  return (
    <div className={`flex items-start justify-between pb-4 border-b border-slate-800/60 mb-4 ${className}`}>
      <div>
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
};
