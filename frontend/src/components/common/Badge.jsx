import React from 'react';

const variants = {
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  info: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const dotVariants = {
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error: 'bg-rose-400',
  info: 'bg-indigo-400',
  neutral: 'bg-slate-400',
  purple: 'bg-purple-400',
};

export const Badge = ({ children, variant = 'neutral', dot = false, className = '' }) => {
  const variantClass = variants[variant] || variants.neutral;
  const dotClass = dotVariants[variant] || dotVariants.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${variantClass} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />}
      {children}
    </span>
  );
};
