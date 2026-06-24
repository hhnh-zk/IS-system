import React, { useState, useRef, useEffect } from 'react';
import { Send, Plus, PauseCircle, PlayCircle, Info, Sparkles } from 'lucide-react';
import { Message, IntentSummaryData, ChatSession } from './types';
import { generateChatResponse, generateIntentSummary, checkInterruption, logEvent } from './services/ai';
import { ChatMessage } from './components/ChatMessage';
import { IntentSummary } from './components/IntentSummary';
import { motion, AnimatePresence } from 'motion/react';
// zk
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInterrupted, setIsInterrupted] = useState(false);
  const [interruptionTimer, setInterruptionTimer] = useState(0);
  const [summary, setSummary] = useState<IntentSummaryData | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [participantId, setParticipantId] = useState('');
  const [groupId, setGroupId] = useState<'1' | '2' | ''>('');
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(true);
  const [hasInterrupted, setHasInterrupted] = useState(false);
  const [isConditionMet, setIsConditionMet] = useState(false);
  const [isInterruptionSuccess, setIsInterruptionSuccess] = useState(false);
  const isInterruptionTriggered = useRef(false);
  const isCheckingCondition = useRef(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Derived experiment settings
  const interruptionDuration = 180;
  const isISGroup = (groupId === '2');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Interruption timer logic
  useEffect(() => {
    let interval: any;
    if (isInterrupted && interruptionTimer > 0) {
      interval = setInterval(() => {
        setInterruptionTimer(prev => prev - 1);
      }, 1000);
    } else if (isInterrupted && interruptionTimer === 0) {
      setIsInterrupted(false);
      setIsInterruptionSuccess(true);
      // Log the successful return to chat
      logEvent(participantId, groupId, "Interruption Ended", true);
      // Only show summary if the group is an IS group
      if (isISGroup) {
        setShowSummary(true);
      }
    }
    return () => clearInterval(interval);
  }, [isInterrupted, interruptionTimer, isISGroup]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    // Check for interruption first!
    if (isConditionMet && !hasInterrupted && !isInterrupted) {
      setHasInterrupted(true);
      simulateInterruption();
      return;
    }

    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const responseData = await generateChatResponse([...messages, userMessage], participantId, groupId, isInterruptionSuccess);
      setIsInterruptionSuccess(false);
      const assistantMessage: Message = {
        id: responseData.id || (Date.now() + 1).toString(),
        role: 'model',
        content: responseData.text,
        timestamp: responseData.timestamp || Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error("Chat Error:", err);
      setError(err.message || "Failed to send message. Please check your network or API configuration.");
    } finally {
      setIsLoading(false);
    }
  };

  const simulateInterruption = async () => {
    // Allow interruption at any time if there's at least one message
    if (messages.length < 1 || isInterruptionTriggered.current) return;
    
    isInterruptionTriggered.current = true;
    console.log("Simulating interruption...");
    
    // Show the interruption UI IMMEDIATELY to prevent "freezing" feeling
    setInterruptionTimer(interruptionDuration);
    setIsInterrupted(true);
    setShowSummary(false);
    
    // Generate summary in the background only for Group 2 (IS group)
    if (isISGroup) {
      try {
        console.log("Triggering intent summary generation...");
        const summaryData = await generateIntentSummary(messages, participantId, groupId);
        console.log("Intent summary generated and saved to DB.");
        setSummary(summaryData);
      } catch (error) {
        console.error("Summary Error:", error);
      }
    } else {
      console.log("Group 1: Skipping intent summary generation.");
    }
  };

  const handleInputInteraction = (currentInput: string) => {
    // This is now mostly handled by the useEffect, but we keep it for immediate response on typing
    if (isConditionMet && !hasInterrupted && !isInterrupted && currentInput.trim().length > 0) {
      console.log("Interruption triggered by typing interaction");
      setHasInterrupted(true);
      simulateInterruption();
    }
  };

  // Trigger interruption when conditions are met AND user has typed something
  useEffect(() => {
    if (isConditionMet && !hasInterrupted && !isInterrupted && input.trim().length > 0) {
      console.log("Interruption triggered by state change (isConditionMet + non-empty input)");
      setHasInterrupted(true);
      simulateInterruption();
    }
  }, [input, isConditionMet, hasInterrupted, isInterrupted]);

  // Auto-interruption logic: Check conditions
  useEffect(() => {
    const checkConditions = async () => {
      if (messages.length > 0 && !hasInterrupted && !isLoading && !isInterrupted && !isConditionMet && !isCheckingCondition.current) {
        const userMessages = messages.filter(m => m.role === 'user');
        // Condition: Turn count >= 3
        if (userMessages.length < 3) return;

        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'model') {
          isCheckingCondition.current = true;
          console.log("Checking interruption conditions with full history...");
          try {
            const shouldInterruption = await checkInterruption(messages);
            console.log("Interruption check result:", shouldInterruption);
            if (shouldInterruption) {
              setIsConditionMet(true);
            }
          } catch (err) {
            console.error("Error checking interruption:", err);
          } finally {
            isCheckingCondition.current = false;
          }
        }
      }
    };

    checkConditions();
  }, [messages, hasInterrupted, isLoading, isInterrupted, isConditionMet]);

  return (
    <div className="flex flex-col h-screen bg-white text-zinc-900 font-sans overflow-hidden">
      {/* Entry Modal */}
      <AnimatePresence>
        {isEntryModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 space-y-6"
            >
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Info size={24} />
                </div>
                <h2 className="text-xl font-bold">Cognitive Continuity Experiment</h2>
                <p className="text-zinc-500 text-sm">
                  Welcome to the experiment. Please fill in the information below to start.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Participant ID</label>
                  <input 
                    type="text" 
                    value={participantId}
                    onChange={(e) => setParticipantId(e.target.value)}
                    placeholder="Participant ID (e.g., S01)"
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Experimental Group</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: '1', label: 'Group 1: History' },
                      { id: '2', label: 'Group 2: IS' },
                    ].map((group) => (
                      <button
                        key={group.id}
                        onClick={() => setGroupId(group.id as any)}
                        className={`py-2 px-3 rounded-lg border text-sm transition-all ${
                          groupId === group.id 
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                            : 'bg-white border-zinc-200 text-zinc-600 hover:border-indigo-300'
                        }`}
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                </div>

                  <button 
                  disabled={!participantId.trim() || !groupId}
                  onClick={() => setIsEntryModalOpen(false)}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-200 mt-2"
                >
                  Start Experiment
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Interruption Overlay */}
      <AnimatePresence>
        {isInterrupted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black"
          >
            <img 
              src="https://picsum.photos/seed/landscape/1920/1080" 
              alt="Landscape" 
              className="absolute inset-0 w-full h-full object-cover opacity-60"
              referrerPolicy="no-referrer"
            />
            <div className="relative z-10 text-center space-y-6 p-8">
              <div className="inline-flex items-center gap-3 px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white">
                <PauseCircle className="animate-pulse" size={20} />
                <span className="text-sm font-medium tracking-widest uppercase">Interruption Detected</span>
              </div>
              <h2 className="text-4xl md:text-6xl font-bold text-white tracking-tight">
                Please take a short break
              </h2>
              <div className="text-6xl font-mono text-indigo-400 font-bold">
                {interruptionTimer}s
              </div>
              <p className="text-white/60 text-lg max-w-md mx-auto">
                The interruption is disrupting your cognitive flow. The system is preparing an intent summary to help you recover quickly in {interruptionTimer} seconds.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="h-14 border-b border-zinc-200 flex items-center justify-between px-4 shrink-0 bg-white z-20">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">Cognitive Continuity Lab</span>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors">
            <Info size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <main className="flex-1 flex flex-col relative bg-white">
          <div className="flex-1 overflow-y-auto scroll-smooth">
            <div className="flex flex-col min-h-full">
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6 max-w-2xl mx-auto">
                  <div className="space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight">Intent Summary Experiment Platform</h1>
                    <p className="text-zinc-500 leading-relaxed">
                      This experiment aims to study how "Intent Summaries" help users quickly recover cognitive continuity after being interrupted by the environment.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 w-full max-w-md">
                    {[
                      "Plan a 5-day trip to Japan with a budget of 8000 RMB (excluding airfare)"
                    ].map((suggestion, i) => (
                      <button 
                        key={i}
                        onClick={() => setInput(suggestion)}
                        className="p-3 text-sm text-left border border-zinc-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/30 transition-all text-zinc-600"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col pb-32">
                  {messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                  ))}
                  {isLoading && !isInterrupted && (
                    <div className="p-6 max-w-4xl mx-auto w-full flex gap-4 animate-pulse">
                      <div className="w-8 h-8 bg-zinc-100 rounded shrink-0" />
                      <div className="flex-1 space-y-3">
                        <div className="h-2 bg-zinc-100 rounded w-1/4" />
                        <div className="h-4 bg-zinc-100 rounded w-3/4" />
                        <div className="h-4 bg-zinc-100 rounded w-1/2" />
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="p-4 mx-4 mb-4 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm flex items-center gap-2">
                      <Info size={16} />
                      <span>{error}</span>
                      <button 
                        onClick={() => setError(null)}
                        className="ml-auto text-red-400 hover:text-red-600"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area (Floating or Fixed) */}
          <div className="shrink-0 border-t border-zinc-200 bg-white p-4">
            <div className="max-w-4xl mx-auto">
              <form 
                onSubmit={handleSend}
                className="relative flex items-end gap-2 bg-zinc-50 border border-zinc-200 rounded-2xl p-2 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400 transition-all shadow-sm"
              >
                <button type="button" className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors">
                  <Plus size={20} />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    handleInputInteraction(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message..."
                  className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2 text-sm max-h-40 min-h-[40px]"
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading || isInterrupted}
                  className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all shadow-sm"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </div>
        </main>

        {/* Sidebar Summary */}
        <AnimatePresence>
          {showSummary && summary && (
            <IntentSummary 
              summary={summary} 
              onClose={() => setShowSummary(false)} 
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
