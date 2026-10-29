import React from 'react';

const variants = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
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
