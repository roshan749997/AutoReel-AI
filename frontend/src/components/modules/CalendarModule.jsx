import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Youtube,
  Instagram,
  Clock,
  Globe,
  Info,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { Modal } from '../common/Modal.jsx';

export const CalendarModule = ({ posts = [], onNavigate, onReload }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Group posts by day of month
  const postsByDay = {};
  posts.forEach((post) => {
    if (!post.scheduledAt) return;
    const postDate = new Date(post.scheduledAt);
    if (postDate.getFullYear() === year && postDate.getMonth() === month) {
      const day = postDate.getDate();
      if (!postsByDay[day]) postsByDay[day] = [];
      postsByDay[day].push(post);
    }
  });

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">{monthName}</h3>
              <p className="text-xs text-slate-400">Content distribution schedule across YouTube Shorts & Instagram Reels</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={prevMonth}>
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentDate(new Date())}
              className="text-xs"
            >
              Today
            </Button>
            <Button variant="secondary" size="sm" icon={ChevronRight} onClick={nextMonth}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-px bg-slate-800/80 rounded-xl overflow-hidden border border-slate-800">
          {daysOfWeek.map((day) => (
            <div
              key={day}
              className="bg-slate-900/90 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider"
            >
              {day}
            </div>
          ))}

          {/* Empty cells before month start */}
          {Array.from({ length: firstDayIndex }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-slate-950/40 min-h-[100px] p-2" />
          ))}

          {/* Month Days */}
          {Array.from({ length: totalDays }).map((_, i) => {
            const dayNumber = i + 1;
            const dayPosts = postsByDay[dayNumber] || [];
            const isToday =
              new Date().getDate() === dayNumber &&
              new Date().getMonth() === month &&
              new Date().getFullYear() === year;

            return (
              <div
                key={dayNumber}
                className={`bg-slate-900/50 min-h-[110px] p-2 flex flex-col justify-between transition-colors hover:bg-slate-850/60 ${
                  isToday ? 'border-2 border-indigo-500/50 bg-indigo-950/10' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-bold ${
                      isToday
                        ? 'w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center'
                        : 'text-slate-400'
                    }`}
                  >
                    {dayNumber}
                  </span>
                  {dayPosts.length > 0 && (
                    <span className="text-[10px] text-slate-500 font-medium">
                      {dayPosts.length} post{dayPosts.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="space-y-1 overflow-y-auto max-h-[70px]">
                  {dayPosts.map((post) => {
                    const isYt = post.platform === 'youtube';
                    const isPublished = post.status === 'published';
                    const isFailed = post.status === 'failed';

                    return (
                      <div
                        key={post._id}
                        onClick={() => setSelectedPost(post)}
                        className={`p-1.5 rounded text-[10px] font-medium truncate cursor-pointer border flex items-center gap-1.5 transition-all ${
                          isPublished
                            ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40'
                            : isFailed
                            ? 'bg-rose-950/30 border-rose-500/30 text-rose-300 hover:bg-rose-900/40'
                            : isYt
                            ? 'bg-red-950/30 border-red-500/30 text-red-300 hover:bg-red-900/40'
                            : 'bg-pink-950/30 border-pink-500/30 text-pink-300 hover:bg-pink-900/40'
                        }`}
                        title={`${post.title} (${post.status})`}
                      >
                        {isYt ? (
                          <Youtube className="w-3 h-3 text-red-400 shrink-0" />
                        ) : (
                          <Instagram className="w-3 h-3 text-pink-400 shrink-0" />
                        )}
                        <span className="truncate">{post.title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Selected Post Modal from Calendar */}
      <Modal
        isOpen={!!selectedPost}
        onClose={() => setSelectedPost(null)}
        title="Scheduled Post Details"
      >
        {selectedPost && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider">
                  {selectedPost.platform.toUpperCase()} POST
                </span>
                <Badge variant={selectedPost.status === 'published' ? 'success' : 'info'} dot className="capitalize text-[10px]">
                  {selectedPost.status}
                </Badge>
              </div>
              <h4 className="font-semibold text-slate-100 text-sm">{selectedPost.title}</h4>
              <p className="text-slate-300 text-xs">{selectedPost.caption || 'No caption'}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-400">
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Scheduled At:</span>
                <span className="font-semibold text-slate-200">
                  {new Date(selectedPost.scheduledAt).toLocaleString()}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Timezone:</span>
                <span className="font-semibold text-slate-200">{selectedPost.timezone || 'UTC'}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSelectedPost(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setSelectedPost(null);
                  if (onNavigate) onNavigate('queue');
                }}
              >
                Go to Queue
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
