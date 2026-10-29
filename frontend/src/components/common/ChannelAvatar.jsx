import React, { useState, useEffect } from 'react';
import { Youtube, Instagram } from 'lucide-react';

export function getChannelInitials(name = '') {
  if (!name) return 'CH';
  // Strip emojis
  const clean = name.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
  const words = clean.split(/[\s_\-.]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    const word = words[0];
    const capitals = word.match(/[A-Z]/g);
    if (capitals && capitals.length >= 2) {
      return (capitals[0] + capitals[1]).toUpperCase();
    }
    return word.slice(0, 2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const IG_GRADIENTS = [
  'from-amber-500 via-rose-500 to-purple-600',
  'from-fuchsia-600 via-pink-600 to-amber-400',
  'from-purple-600 via-pink-500 to-orange-400',
  'from-rose-500 via-purple-600 to-indigo-600',
  'from-pink-500 via-red-500 to-yellow-500',
];

const YT_GRADIENTS = [
  'from-red-600 via-rose-600 to-amber-500',
  'from-red-700 via-red-600 to-orange-500',
  'from-rose-600 via-red-600 to-red-800',
  'from-red-600 to-rose-700',
];

function getGradient(name = '', isYt = false) {
  const list = isYt ? YT_GRADIENTS : IG_GRADIENTS;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % list.length;
  return list[index];
}

const SIZE_MAP = {
  xs: { box: 'w-6 h-6', text: 'text-[9px]', badge: 'w-3 h-3', badgeIcon: 'w-1.5 h-1.5' },
  sm: { box: 'w-8 h-8', text: 'text-xs', badge: 'w-3.5 h-3.5', badgeIcon: 'w-2 h-2' },
  md: { box: 'w-10 h-10', text: 'text-xs', badge: 'w-4 h-4', badgeIcon: 'w-2 h-2' },
  lg: { box: 'w-11 h-11', text: 'text-sm', badge: 'w-5 h-5', badgeIcon: 'w-2.5 h-2.5' },
  xl: { box: 'w-14 h-14', text: 'text-base', badge: 'w-5.5 h-5.5', badgeIcon: 'w-3 h-3' },
};

export function ChannelAvatar({
  account,
  name,
  platform,
  profilePictureUrl,
  size = 'lg',
  showBadge = true,
  className = '',
}) {
  const actualName = name || account?.accountName || account?.username || 'Channel';
  const actualPlatform = platform || account?.platform || 'youtube';
  const actualUrl = profilePictureUrl || account?.profilePictureUrl;

  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
  }, [actualUrl]);

  const isYt = actualPlatform === 'youtube';
  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.lg;
  const initials = getChannelInitials(actualName);
  const gradient = getGradient(actualName, isYt);

  const shouldShowImg = Boolean(actualUrl) && !hasError;

  return (
    <div className={`relative shrink-0 ${sizeConfig.box} ${className}`}>
      {shouldShowImg ? (
        <img
          src={actualUrl}
          alt={actualName}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true);
            setIsLoaded(false);
          }}
          className={`w-full h-full rounded-full border border-slate-200/90 object-cover shadow-2xs transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}

      {/* Fallback Gradient Badge with Initials (shown while loading or on error/missing URL) */}
      {(!shouldShowImg || !isLoaded) && (
        <div
          className={`absolute inset-0 rounded-full flex items-center justify-center font-bold text-white shadow-2xs bg-gradient-to-tr ${gradient} ${sizeConfig.text} select-none tracking-tight ring-1 ring-white/20`}
          title={actualName}
        >
          {initials}
        </div>
      )}

      {/* Platform Emblem Badge */}
      {showBadge && (
        <div
          className={`absolute -bottom-1 -right-1 ${sizeConfig.badge} rounded-full flex items-center justify-center text-white shadow-xs border-2 border-white ${
            isYt ? 'bg-red-600' : 'bg-gradient-to-tr from-amber-500 to-pink-600'
          }`}
          title={isYt ? 'YouTube' : 'Instagram'}
        >
          {isYt ? (
            <Youtube className={sizeConfig.badgeIcon} />
          ) : (
            <Instagram className={sizeConfig.badgeIcon} />
          )}
        </div>
      )}
    </div>
  );
}

export default ChannelAvatar;
