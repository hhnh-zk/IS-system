import React from 'react';
import Markdown from 'react-markdown';
import { User, Bot } from 'lucide-react';
import { Message } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={cn(
      "flex w-full gap-4 p-4 md:p-6 transition-colors",
      isUser ? "bg-white" : "bg-zinc-50/50 border-y border-zinc-100"
    )}>
      <div className="max-w-4xl mx-auto flex gap-4 w-full">
        <div className={cn(
          "w-8 h-8 rounded shrink-0 flex items-center justify-center",
          isUser ? "bg-zinc-100 text-zinc-600" : "bg-indigo-600 text-white"
        )}>
          {isUser ? <User size={18} /> : <Bot size={18} />}
        </div>
        <div className="flex-1 space-y-2 overflow-hidden">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            {isUser ? "You" : "Assistant"}
          </div>
          <div className="prose prose-zinc prose-sm max-w-none text-zinc-800 leading-relaxed">
            <Markdown>{message.content}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
};
