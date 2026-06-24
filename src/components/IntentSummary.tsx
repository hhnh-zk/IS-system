import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, Target, AlertCircle, ArrowRight, X } from 'lucide-react';
import { IntentSummaryData } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface IntentSummaryProps {
  summary: IntentSummaryData;
  onClose: () => void;
}

export const IntentSummary: React.FC<IntentSummaryProps> = ({ summary, onClose }) => {
  return (
    <motion.div
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      className="w-80 border-l border-zinc-200 bg-zinc-50/50 h-full overflow-y-auto shrink-0 hidden lg:block"
    >
      <div className="p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600">
            <History size={18} />
            <span className="text-xs font-bold uppercase tracking-widest">Intent Summary</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-zinc-200 rounded-full transition-colors text-zinc-400"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 font-semibold text-xs uppercase tracking-wider">
            <History size={14} className="text-zinc-400" />
            Task Progress Backtrack
          </div>
          <ul className="space-y-2">
            {summary.progress.map((item, i) => (
              <li key={i} className="text-sm text-zinc-600 flex items-start gap-2 bg-white p-2 rounded-lg border border-zinc-100 shadow-sm">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Preferences */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 font-semibold text-xs uppercase tracking-wider">
            <Target size={14} className="text-zinc-400" />
            User Preference Identification
          </div>
          <div className="bg-white p-3 rounded-lg border border-zinc-100 shadow-sm">
            <p className="text-sm text-zinc-600 leading-relaxed italic">
              "{summary.preferences}"
            </p>
          </div>
        </section>

        {/* Pending Issues */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 font-semibold text-xs uppercase tracking-wider">
            <AlertCircle size={14} className="text-zinc-400" />
            Pending Issues Prompt
          </div>
          <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
            <p className="text-sm text-indigo-900 leading-relaxed font-medium mb-4">
              {summary.pendingIssues}
            </p>
            <div className="flex flex-col gap-2">
              {summary.suggestedNextSteps.map((step, i) => (
                <button 
                  key={i}
                  className="text-[11px] px-3 py-2 bg-white text-indigo-700 rounded-lg border border-indigo-100 hover:border-indigo-300 hover:shadow-sm transition-all flex items-center justify-between group"
                >
                  {step}
                  <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
};
