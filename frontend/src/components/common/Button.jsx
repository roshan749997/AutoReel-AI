import React from 'react';
import { Loader2 } from 'lucide-react';

const variants = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-900/30 border border-indigo-500/40',
  secondary: 'bg-slate-800 hover:bg-slate-700/80 text-slate-200 border border-slate-700',
  danger: 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30',
  ghost: 'bg-transparent hover:bg-slate-800/60 text-slate-300 border border-transparent',
  outline: 'bg-transparent hover:bg-slate-800/40 text-slate-200 border border-slate-700',
};

const sizes = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-4.5 py-2.5 text-base',
};

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  icon: Icon,
  className = '',
  onClick,
  type = 'button',
}) => {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      onClick={onClick}
      className={`inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed ${
        variants[variant] || variants.primary
      } ${sizes[size] || sizes.md} ${className}`}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin text-current" />
      ) : Icon ? (
        <Icon className="w-4 h-4 mr-2" />
      ) : null}
      {children}
    </button>
  );
};
