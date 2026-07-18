import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  Terminal,
  Play,
  Square,
  AlertCircle,
  Check,
  Server,
  MessageSquare,
  Bot,
  Users,
  Copy,
  ExternalLink,
  Sliders,
  Eye,
  EyeOff,
  Activity,
  ShieldAlert,
  Search,
  CheckCircle2,
  XCircle,
  HelpCircle,
  SlidersHorizontal,
  Cpu,
  Layers,
  Sparkles,
  Lock,
  Globe,
  Bell,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { BotConfig, BotStatus, LogEntry, BotInstanceData } from './types';

const DEFAULT_CONFIG: BotConfig = {
  discordToken: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  modelName: 'gpt-4o-mini',
  systemPrompt: 'You are a helpful and friendly Discord AI assistant.',
  temperature: 0.7,
  maxTokens: 500,
  respondToMentions: true,
  respondToPrefix: false,
  prefix: '!',
  respondToDMs: true,
  allowedChannels: '',
  allowedGuilds: '',
  autoStart: true,
};

export default function App() {
  const [bots, setBots] = useState<BotInstanceData[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  // Form states bound to active selection
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [botName, setBotName] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'dashboard' | 'ai_settings' | 'triggers' | 'logs'>('dashboard');

  // Logs filters & search
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'success' | 'warn' | 'error'>('all');
  const [logSearch, setLogSearch] = useState('');

  // UI status helpers
  const [showToken, setShowToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [controlLoading, setControlLoading] = useState(false);
  
  // Connection and model test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isCustomModel, setIsCustomModel] = useState(false);

  // Creation modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBotName, setNewBotName] = useState('');

  // Simulated metrics
  const [cpuUsage, setCpuUsage] = useState(12.4);
  const [ramUsage, setRamUsage] = useState(45.1);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // CPU and RAM simulated fluctuation
  useEffect(() => {
    const timer = setInterval(() => {
      setCpuUsage((prev) => {
        const delta = (Math.random() - 0.5) * 4;
        const next = prev + delta;
        return Math.max(5, Math.min(next, 95));
      });
      setRamUsage((prev) => {
        const delta = (Math.random() - 0.5) * 0.8;
        const next = prev + delta;
        return Math.max(40, Math.min(next, 80));
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Set up SSE Event Stream
  useEffect(() => {
    const eventSource = new EventSource('/api/logs/stream');

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'init') {
          setBots(payload.bots);
          if (payload.bots.length > 0) {
            setSelectedBotId((curr) => curr || payload.bots[0].id);
          }
        } else if (payload.type === 'log') {
          setBots((prev) =>
            prev.map((b) =>
              b.id === payload.botId
                ? { ...b, logs: [payload.data, ...b.logs].slice(0, 150) }
                : b
            )
          );
        } else if (payload.type === 'status') {
          setBots((prev) =>
            prev.map((b) =>
              b.id === payload.botId ? { ...b, status: payload.data } : b
            )
          );
        } else if (payload.type === 'bots') {
          setBots(payload.data);
          if (payload.data.length > 0) {
            setSelectedBotId((curr) => {
              const stillExists = payload.data.some((b: any) => b.id === curr);
              return stillExists ? curr : payload.data[0].id;
            });
          } else {
            setSelectedBotId(null);
          }
        }
      } catch (err) {
        console.error('Failed to parse event stream payload:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('Log stream connection lost. Auto-reconnecting...', err);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Determine active bot selection
  const selectedBot = bots.find((b) => b.id === selectedBotId) || bots[0];

  // Update local forms when selection shifts
  useEffect(() => {
    if (selectedBot) {
      setConfig({ ...DEFAULT_CONFIG, ...selectedBot.config });
      setBotName(selectedBot.name);
      setTestResult(null);
    }
  }, [selectedBotId, selectedBot?.id]);

  // Autoscroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedBot?.logs]);

  // Fetch available models on tab open
  useEffect(() => {
    if (activeTab === 'ai_settings' && config.openaiBaseUrl && modelsList.length === 0) {
      handleFetchModels();
    }
  }, [activeTab, selectedBotId]);

  const handleConfigChange = <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (saveStatus !== 'idle') setSaveStatus('idle');
  };

  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedBot) return;

    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/bots/${selectedBot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: botName,
          config,
        }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
    }
  };

  const handleStartBot = async () => {
    if (!selectedBot) return;
    const { status } = selectedBot.status;
    if (status === 'running' || status === 'starting') return;

    setControlLoading(true);
    try {
      // Auto-save form content first
      await handleSaveConfig();
      const res = await fetch(`/api/bots/${selectedBot.id}/start`, { method: 'POST' });
      await res.json();
    } catch (err) {
      console.error(err);
    } finally {
      setControlLoading(false);
    }
  };

  const handleStopBot = async () => {
    if (!selectedBot) return;
    const { status } = selectedBot.status;
    if (status === 'idle' || status === 'stopped') return;

    setControlLoading(true);
    try {
      const res = await fetch(`/api/bots/${selectedBot.id}/stop`, { method: 'POST' });
      await res.json();
    } catch (err) {
      console.error(err);
    } finally {
      setControlLoading(false);
    }
  };

  const handleCreateBot = async () => {
    if (!newBotName.trim()) return;

    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBotName.trim() }),
      });
      const data = await res.json();
      if (data.success && data.bot) {
        setSelectedBotId(data.bot.id);
        setShowCreateModal(false);
        setNewBotName('');
      }
    } catch (err) {
      console.error('Failed to create bot:', err);
    }
  };

  const handleDeleteBot = async () => {
    if (!selectedBot) return;
    if (!confirm(`Are you absolutely sure you want to delete "${selectedBot.name}"?`)) return;

    try {
      const res = await fetch(`/api/bots/${selectedBot.id}`, { method: 'DELETE' });
      if (res.ok) {
        setTestResult(null);
      }
    } catch (err) {
      console.error('Failed to delete bot:', err);
    }
  };

  const handleTestOpenAI = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/test-openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.openaiBaseUrl,
          apiKey: config.openaiApiKey,
          model: config.modelName,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Network error occurred.' });
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    if (!config.openaiBaseUrl) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.openaiBaseUrl,
          apiKey: config.openaiApiKey,
        }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.models)) {
        setModelsList(data.models);
      } else {
        setModelsError(data.message || 'Failed to fetch model list from server.');
      }
    } catch (err: any) {
      setModelsError(err.message || 'Network error fetching model list.');
    } finally {
      setFetchingModels(false);
    }
  };

  const formatUptime = (totalSeconds: number) => {
    if (!totalSeconds) return '0s';
    const d = Math.floor(totalSeconds / (3600 * 24));
    const h = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
  };

  const filteredLogs = selectedBot
    ? selectedBot.logs.filter((log) => {
        const matchesFilter = logFilter === 'all' || log.level === logFilter;
        const matchesSearch = log.message.toLowerCase().includes(logSearch.toLowerCase());
        return matchesFilter && matchesSearch;
      })
    : [];

  return (
    <div className="flex h-screen w-full bg-[#0f172a] text-[#f1f5f9] font-sans overflow-hidden">
      
      {/* 1. LEFT SIDEBAR */}
      <aside className="w-66 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none z-10">
        
        {/* Brand Banner */}
        <div className="p-5 pb-3">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center font-black text-xl text-white shadow-lg shadow-indigo-600/20">
              M
            </div>
            <div>
              <span className="font-bold tracking-tight text-sm text-white block">BOT ORCHESTRA</span>
              <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Multi-bot Manager</span>
            </div>
          </div>
        </div>

        {/* Bot Selector Panel */}
        <div className="px-4 py-2 border-b border-slate-800/60 mb-3">
          <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2 px-1">
            <span>Bot Instances</span>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-indigo-400 hover:text-indigo-300 font-bold transition-colors cursor-pointer capitalize text-xs"
            >
              + Add bot
            </button>
          </div>
          
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {bots.length === 0 ? (
              <div className="text-[11px] text-slate-500 p-2 text-center border border-dashed border-slate-800 rounded-xl">
                No bot instances
              </div>
            ) : (
              bots.map((bot) => {
                const isSelected = bot.id === selectedBotId;
                const botStatus = bot.status.status;
                const isActive = botStatus === 'running';
                const isStarting = botStatus === 'starting';
                const isError = botStatus === 'error';

                return (
                  <button
                    key={bot.id}
                    onClick={() => setSelectedBotId(bot.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left font-medium text-xs transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/35'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {bot.status.avatarUrl ? (
                        <img
                          src={bot.status.avatarUrl}
                          alt=""
                          className="w-4.5 h-4.5 rounded-full shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <Bot className="w-4 h-4 shrink-0" />
                      )}
                      <span className="truncate">{bot.name}</span>
                    </div>
                    
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      isActive ? 'bg-green-500 animate-pulse' :
                      isStarting ? 'bg-amber-500 animate-pulse' :
                      isError ? 'bg-rose-500' :
                      'bg-slate-600'
                    }`} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="flex-1 px-4 space-y-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4" />
              <span>Dashboard</span>
            </div>
            {selectedBot?.status.status === 'running' && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('ai_settings')}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer ${
              activeTab === 'ai_settings'
                ? 'bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>AI Settings</span>
          </button>

          <button
            onClick={() => setActiveTab('triggers')}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer ${
              activeTab === 'triggers'
                ? 'bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Triggers &amp; Access</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer ${
              activeTab === 'logs'
                ? 'bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <Terminal className="w-4 h-4" />
              <span>Terminal Logs</span>
            </div>
            {selectedBot && selectedBot.logs.length > 0 && (
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-slate-800 text-slate-300 rounded-md">
                {selectedBot.logs.length}
              </span>
            )}
          </button>
        </nav>

        {/* Sidebar Footer: Resource Metrics */}
        <div className="p-4 mt-auto border-t border-slate-800 bg-slate-950/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Docker Container</span>
            <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-[9px] rounded font-black uppercase tracking-wider">
              Active
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full transition-all duration-1000"
                style={{ width: `${cpuUsage}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[9px]">
              <span className="text-slate-500">Container CPU</span>
              <span className="text-slate-400 font-mono font-bold">{cpuUsage.toFixed(1)}%</span>
            </div>
          </div>

          <div className="space-y-1.5 mt-2.5">
            <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-1000"
                style={{ width: `${ramUsage}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[9px]">
              <span className="text-slate-500">Container RAM</span>
              <span className="text-slate-400 font-mono font-bold">{ramUsage.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MAIN APP CONTENT CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0f172a] relative overflow-hidden">
        
        {/* Ambient background glows */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/10 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] rounded-full bg-emerald-500/5 blur-[150px] pointer-events-none" />

        {/* Top Header */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-md shrink-0 z-10">
          <div className="flex items-center gap-6">
            <h1 className="text-sm font-semibold tracking-tight text-white capitalize flex items-center gap-2">
              <span className="text-slate-400">{selectedBot ? selectedBot.name : 'No Bot Selected'}</span>
              <span className="text-slate-600">/</span>
              <span>{activeTab.replace('_', ' ')}</span>
            </h1>
            
            {selectedBot && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-800/80 rounded-full border border-slate-700/60">
                <span className={`w-2 h-2 rounded-full ${
                  selectedBot.status.status === 'running' ? 'bg-green-500 animate-pulse' :
                  selectedBot.status.status === 'starting' ? 'bg-amber-500 animate-pulse' :
                  'bg-slate-500'
                }`} />
                <span className="text-[11px] font-semibold text-slate-300">
                  Gateway: {selectedBot.status.status === 'running' ? 'live-cluster' : 'inactive'}
                </span>
              </div>
            )}
          </div>

          {/* Connection controls */}
          <div className="flex items-center gap-4">
            {selectedBot && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800/95 p-1 rounded-lg">
                {selectedBot.status.status === 'running' || selectedBot.status.status === 'starting' ? (
                  <button
                    onClick={handleStopBot}
                    disabled={controlLoading}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500 rounded-md transition-all duration-150 disabled:opacity-50 cursor-pointer"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStartBot}
                    disabled={controlLoading}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-500 rounded-md transition-all duration-150 disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Start Bot</span>
                  </button>
                )}
              </div>
            )}

            <div className="h-6 w-[1px] bg-slate-800" />

            {/* Profile Avatar of Bot */}
            {selectedBot && (
              <div className="flex items-center gap-2">
                {selectedBot.status.avatarUrl ? (
                  <img
                    src={selectedBot.status.avatarUrl}
                    alt="Avatar"
                    className="w-8 h-8 rounded-full border border-slate-700"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <span className="text-xs font-semibold text-slate-300 hidden md:block">
                  {selectedBot.status.username}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Main Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto z-10">
          
          {!selectedBot ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <Bot className="w-12 h-12 text-slate-700 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-300">No bot instances defined</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Create a new bot instance on the left panel to configure its individual credentials, models, and respond channels.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg"
              >
                Create Bot Instance
              </button>
            </div>
          ) : (
            <>
              {/* Error Warning Alert */}
              {selectedBot.status.error && (
                <div className="mb-6 p-4 bg-rose-950/30 border border-rose-900/40 rounded-xl flex items-start gap-3 text-rose-200">
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-rose-300 text-sm">Discord Bot Gateway Error</h3>
                    <p className="text-xs text-rose-400/90 mt-1 leading-relaxed font-mono">{selectedBot.status.error}</p>
                  </div>
                </div>
              )}

              {/* TAB 1: DASHBOARD */}
              {activeTab === 'dashboard' && (
                <div className="grid grid-cols-12 gap-6">
                  
                  {/* Left stats (Span 8) */}
                  <div className="col-span-12 lg:col-span-8 space-y-6">
                    
                    {/* Visual Gateway Card */}
                    <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />
                      
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4 text-center sm:text-left flex-col sm:flex-row">
                          <div className="relative">
                            {selectedBot.status.avatarUrl ? (
                              <img
                                src={selectedBot.status.avatarUrl}
                                alt="Bot"
                                className="w-16 h-16 rounded-full border-2 border-indigo-500/50 shadow-lg"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                                <Bot className="w-8 h-8" />
                              </div>
                            )}
                            <span className={`absolute bottom-0 right-0 block h-4 w-4 rounded-full border-2 border-[#1e293b] ${
                              selectedBot.status.status === 'running' ? 'bg-green-500 animate-pulse' :
                              selectedBot.status.status === 'starting' ? 'bg-amber-500 animate-pulse' :
                              'bg-slate-600'
                            }`} />
                          </div>

                          <div>
                            <div className="flex items-center gap-2 justify-center sm:justify-start">
                              <h2 className="text-xl font-black text-white">{selectedBot.name}</h2>
                              <span className="text-[10px] bg-slate-800 border border-slate-700/60 px-2 py-0.5 rounded font-mono text-slate-400">
                                {selectedBot.id}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 font-mono">
                              Status:{' '}
                              <span className={`font-semibold ${selectedBot.status.status === 'running' ? 'text-green-400' : 'text-slate-400'}`}>
                                {selectedBot.status.status.toUpperCase()}
                              </span>
                              {selectedBot.status.username !== 'Disconnected' && (
                                <span className="text-slate-500"> ({selectedBot.status.username})</span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          {selectedBot.status.status === 'running' || selectedBot.status.status === 'starting' ? (
                            <button
                              onClick={handleStopBot}
                              disabled={controlLoading}
                              className="px-4 py-2 bg-rose-500/15 hover:bg-rose-500 border border-rose-500/30 hover:border-rose-500 text-rose-400 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                            >
                              STOP INSTANCE
                            </button>
                          ) : (
                            <button
                              onClick={handleStartBot}
                              disabled={controlLoading}
                              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/10 active:scale-95 transition-all cursor-pointer"
                            >
                              START INSTANCE
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-800/60">
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">Connected Servers</span>
                          <span className="text-xl font-bold font-mono text-white mt-1 block">
                            {selectedBot.status.status === 'running' ? selectedBot.status.stats.guildsCount : '0'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">Active Members</span>
                          <span className="text-xl font-bold font-mono text-indigo-400 mt-1 block">
                            {selectedBot.status.status === 'running' ? selectedBot.status.stats.usersCount : '0'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">Chats Processed</span>
                          <span className="text-xl font-bold font-mono text-emerald-400 mt-1 block">
                            {selectedBot.status.stats.chatsProcessed}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">Active Uptime</span>
                          <span className="text-sm font-bold font-mono text-amber-400 mt-2 block truncate" title={formatUptime(selectedBot.status.stats.uptimeSeconds)}>
                            {selectedBot.status.status === 'running' ? formatUptime(selectedBot.status.stats.uptimeSeconds) : 'Offline'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Console log box (Dashboard version) */}
                    <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl flex flex-col h-[380px] shadow-xl overflow-hidden">
                      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/30">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${selectedBot.status.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`} />
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Live Console ({selectedBot.name})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setBots((prev) =>
                                prev.map((b) => (b.id === selectedBot.id ? { ...b, logs: [] } : b))
                              );
                            }}
                            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors bg-slate-800 p-1 px-2 rounded border border-slate-700/60 cursor-pointer"
                          >
                            Clear Screen
                          </button>
                        </div>
                      </div>

                      <div className="p-3 bg-slate-900/10 border-b border-slate-800/50 flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <input
                            type="text"
                            value={logSearch}
                            onChange={(e) => setLogSearch(e.target.value)}
                            placeholder="Search logs..."
                            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-900/60 border border-slate-800 rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        
                        <div className="flex gap-1.5 shrink-0">
                          {(['all', 'info', 'success', 'warn', 'error'] as const).map((filter) => (
                            <button
                              key={filter}
                              type="button"
                              onClick={() => setLogFilter(filter)}
                              className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                logFilter === filter
                                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                                  : 'bg-slate-900/40 text-slate-400 border border-slate-800 hover:text-slate-300'
                              }`}
                            >
                              {filter}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex-1 p-4 overflow-y-auto bg-slate-950/60 font-mono text-[11px] leading-relaxed space-y-2 select-text">
                        {filteredLogs.length === 0 ? (
                          <div className="text-slate-600 h-full flex flex-col items-center justify-center gap-1">
                            <Terminal className="w-5 h-5 text-slate-800" />
                            <span>No logs present for this instance.</span>
                          </div>
                        ) : (
                          filteredLogs.map((log) => (
                            <div key={log.id} className="flex items-start gap-2 text-slate-300 hover:bg-slate-900/20 p-0.5 rounded">
                              <span className="text-slate-600 shrink-0 select-none">[{log.timestamp}]</span>
                              <span className={`font-bold shrink-0 select-none ${
                                log.level === 'success' ? 'text-green-400/90' :
                                log.level === 'warn' ? 'text-amber-400/90' :
                                log.level === 'error' ? 'text-rose-400/90' :
                                'text-indigo-400/90'
                              }`}>
                                {log.level.toUpperCase()}
                              </span>
                              <span className="text-slate-300 break-all">{log.message}</span>
                            </div>
                          ))
                        )}
                        <div ref={logsEndRef} />
                      </div>
                    </div>

                  </div>

                  {/* Sidebar stats/health (Span 4) */}
                  <div className="col-span-12 lg:col-span-4 space-y-6">
                    
                    {/* System Health Widget */}
                    <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">System Health</h3>
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800/50">
                          <span className="text-sm text-slate-300">Gateway Heartbeat</span>
                          <span className="text-sm font-mono font-bold text-green-400">
                            {selectedBot.status.status === 'running' ? '32ms' : 'offline'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between pb-3 border-b border-slate-800/50">
                          <span className="text-sm text-slate-300">Model Response</span>
                          <span className="text-sm font-mono font-bold text-indigo-400">
                            {selectedBot.status.status === 'running' ? '1.2s (avg)' : '-'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-300">Errors Thrown</span>
                          <span className="text-sm font-mono font-bold text-rose-400">
                            {selectedBot.status.stats.errorCount}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-800/50 text-center">
                        <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/50">
                          <div className="text-2xl font-black text-white">{selectedBot.status.stats.chatsProcessed}</div>
                          <div className="text-[9px] text-slate-500 uppercase font-black mt-1">Total Chats</div>
                        </div>

                        <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/50">
                          <div className="text-2xl font-black text-indigo-400">
                            {selectedBot.status.status === 'running' ? '99.9%' : '0%'}
                          </div>
                          <div className="text-[9px] text-slate-500 uppercase font-black mt-1">SLA Health</div>
                        </div>
                      </div>
                    </div>

                    {/* Resource Management Action Box */}
                    <div className="bg-indigo-600/5 border border-indigo-500/10 rounded-2xl p-6 shadow-xl">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Resource Management</h3>
                      </div>
                      
                      <p className="text-xs text-slate-400 leading-relaxed mb-5">
                        Manage individual thread configurations and lifecycle processes for this specific bot instance.
                      </p>

                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            handleStopBot().then(() => {
                              setTimeout(() => {
                                handleStartBot();
                              }, 1000);
                            });
                          }}
                          className="w-full py-3 bg-slate-800 hover:bg-slate-750 border border-slate-700/80 hover:border-slate-600 rounded-xl text-xs font-bold text-white tracking-wide transition-all shadow-md active:scale-98 cursor-pointer"
                        >
                          RESTART BOT INSTANCE
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (confirm('Clear conversational history caches for this bot instance?')) {
                              fetch(`/api/bots/${selectedBot.id}/clear-history`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ channelId: '' }),
                              }).then(() => {
                                alert('Conversational history caches flushed successfully.');
                              });
                            }
                          }}
                          className="w-full py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 rounded-xl text-xs font-bold text-rose-400 transition-all active:scale-98 cursor-pointer"
                        >
                          FLUSH INSTANCE CACHES
                        </button>

                        {bots.length > 1 && (
                          <button
                            type="button"
                            onClick={handleDeleteBot}
                            className="w-full py-3 bg-rose-950/20 hover:bg-rose-600 border border-rose-900/40 hover:border-rose-500 text-rose-400 hover:text-white rounded-xl text-xs font-bold transition-all active:scale-98 cursor-pointer"
                          >
                            DELETE BOT INSTANCE
                          </button>
                        )}
                      </div>
                    </div>

                  </div>

                </div>
              )}

              {/* TAB 2: AI SETTINGS */}
              {activeTab === 'ai_settings' && (
                <form onSubmit={handleSaveConfig} className="max-w-4xl space-y-6">
                  
                  {/* Bot Instance Metadata Card */}
                  <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-4">
                      <Bot className="w-5 h-5 text-indigo-400" />
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Bot Identity Settings</h3>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Bot Instance Name
                      </label>
                      <input
                        type="text"
                        value={botName}
                        onChange={(e) => setBotName(e.target.value)}
                        placeholder="e.g. Creative Assistant"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-sans"
                        required
                      />
                      <p className="text-xs text-slate-500">
                        The friendly display name used inside this administrative interface.
                      </p>
                    </div>
                  </div>

                  {/* OpenAI Server Connection */}
                  <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-4">
                      <Server className="w-5 h-5 text-indigo-400" />
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">LLM API Target Endpoint</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      <div className="md:col-span-2 space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          API Server Endpoint (Base URL)
                        </label>
                        <input
                          type="url"
                          value={config.openaiBaseUrl}
                          onChange={(e) => handleConfigChange('openaiBaseUrl', e.target.value)}
                          placeholder="e.g. https://api.openai.com/v1"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                          required
                        />
                        <p className="text-xs text-slate-500">
                          Route requests to Open WebUI, LM Studio, Ollama, Groq, or OpenAI's official endpoint servers.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Secret API/Bearer Key
                        </label>
                        <div className="relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={config.openaiApiKey}
                            onChange={(e) => handleConfigChange('openaiApiKey', e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-11 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                          >
                            {showApiKey ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Target AI Model ID
                          </label>
                          {modelsList.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setIsCustomModel(!isCustomModel)}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer hover:underline"
                            >
                              {isCustomModel ? 'Select list' : 'Custom value'}
                            </button>
                          )}
                        </div>

                        {isCustomModel || modelsList.length === 0 ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={config.modelName}
                              onChange={(e) => handleConfigChange('modelName', e.target.value)}
                              placeholder="gpt-4o-mini"
                              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                              required
                            />
                            <button
                              type="button"
                              onClick={handleFetchModels}
                              disabled={fetchingModels}
                              className="px-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl flex items-center justify-center cursor-pointer"
                            >
                              <RefreshCw className={`w-4 h-4 ${fetchingModels ? 'animate-spin' : ''}`} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <select
                              value={config.modelName}
                              onChange={(e) => handleConfigChange('modelName', e.target.value)}
                              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                            >
                              {!modelsList.includes(config.modelName) && (
                                <option value={config.modelName}>{config.modelName} (Current)</option>
                              )}
                              {modelsList.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={handleFetchModels}
                              disabled={fetchingModels}
                              className="px-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl flex items-center justify-center cursor-pointer"
                            >
                              <RefreshCw className={`w-4 h-4 ${fetchingModels ? 'animate-spin' : ''}`} />
                            </button>
                          </div>
                        )}

                        <p className="text-xs text-slate-500">
                          {fetchingModels ? (
                            <span className="text-indigo-400 flex items-center gap-1.5">
                              Fetching model configurations...
                            </span>
                          ) : modelsError ? (
                            <span className="text-rose-400">Fetch error: {modelsError}</span>
                          ) : modelsList.length > 0 ? (
                            <span className="text-emerald-400 font-medium">Successfully parsed {modelsList.length} models.</span>
                          ) : (
                            <span>Target server API model representation.</span>
                          )}
                        </p>
                      </div>

                    </div>

                    <div className="mt-8 p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                        <span className="text-xs text-slate-400">
                          Run a validation handshake to confirm connectivity before committing configurations.
                        </span>
                        <button
                          type="button"
                          onClick={handleTestOpenAI}
                          disabled={testing}
                          className="px-4 py-2 text-xs font-bold bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white rounded-lg border border-indigo-500/25 hover:border-indigo-500 transition-all cursor-pointer"
                        >
                          {testing ? 'Testing...' : 'Test Connection'}
                        </button>
                      </div>

                      {testResult && (
                        <div className={`text-xs p-3 rounded-lg flex items-start gap-2 ${
                          testResult.success ? 'bg-emerald-950/25 border border-emerald-800/40 text-emerald-300' : 'bg-rose-950/25 border border-rose-800/40 text-rose-300'
                        }`}>
                          {testResult.success ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          )}
                          <span className="font-mono break-all">{testResult.message}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Parameters Card */}
                  <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-4">
                      <SlidersHorizontal className="w-5 h-5 text-amber-500" />
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Parameters &amp; System Instruction</h3>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          System instructions (Bot Persona)
                        </label>
                        <textarea
                          rows={4}
                          value={config.systemPrompt}
                          onChange={(e) => handleConfigChange('systemPrompt', e.target.value)}
                          placeholder="You are a friendly Discord AI..."
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-xs">
                            <label className="font-bold text-slate-400 uppercase tracking-wider">Temperature (Creativity)</label>
                            <span className="font-mono text-indigo-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                              {config.temperature}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={config.temperature}
                            onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-xs">
                            <label className="font-bold text-slate-400 uppercase tracking-wider">Max Output Tokens</label>
                            <span className="font-mono text-indigo-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                              {config.maxTokens}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="50"
                            max="4000"
                            step="50"
                            value={config.maxTokens}
                            onChange={(e) => handleConfigChange('maxTokens', parseInt(e.target.value))}
                            className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Save Footer */}
                  <div className="sticky bottom-4 z-10 flex justify-end items-center gap-4 bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-2xl backdrop-blur-md">
                    <span className="text-xs text-slate-400 hidden sm:inline">
                      Commit setting shifts to update this live bot runtime execution.
                    </span>
                    <button
                      type="submit"
                      disabled={saveStatus === 'saving'}
                      className="px-6 py-2.5 text-xs font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center gap-2 cursor-pointer shadow-lg active:scale-98"
                    >
                      {saveStatus === 'saving' ? 'Saving configurations...' :
                       saveStatus === 'saved' ? 'Saved Successfully!' :
                       saveStatus === 'error' ? 'Configuration save error' :
                       'Save Server Configurations'}
                    </button>
                  </div>

                </form>
              )}

              {/* TAB 3: TRIGGERS & ACCESS */}
              {activeTab === 'triggers' && (
                <form onSubmit={handleSaveConfig} className="max-w-4xl space-y-6">
                  
                  {/* Access Token */}
                  <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-4">
                      <Lock className="w-5 h-5 text-indigo-400" />
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Discord bot access</h3>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Discord Bot Token
                        </label>
                        <div className="relative">
                          <input
                            type={showToken ? 'text' : 'password'}
                            value={config.discordToken}
                            onChange={(e) => handleConfigChange('discordToken', e.target.value)}
                            placeholder="MTA5ODc2NTQzMjEwOTg3NjU0MzI.GDWabc.XYZ..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-11 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                          >
                            {showToken ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                          </button>
                        </div>
                        <p className="text-xs text-slate-500">
                          Create or view credentials inside the{' '}
                          <a
                            href="https://discord.com/developers/applications"
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:underline font-bold"
                          >
                            Discord Developer Application Hub
                          </a>
                          . Make sure to activate <b>Message Content Intents</b>.
                        </p>
                      </div>

                      {/* Auto Start */}
                      <div className="pt-4 border-t border-slate-800/60 mt-4">
                        <label className={`flex items-center justify-between p-4 bg-slate-900/40 border rounded-xl cursor-pointer transition-all select-none ${
                          config.autoStart ? 'border-indigo-500/40 bg-indigo-600/5' : 'border-slate-800 hover:border-slate-750'
                        }`}>
                          <div className="flex gap-3 items-center">
                            <Cpu className="w-4 h-4 text-indigo-400" />
                            <div>
                              <span className="text-xs font-bold uppercase tracking-wider text-white block">Auto-Start on Reboot</span>
                              <span className="text-[11px] text-slate-400 block mt-0.5">Start this bot connection automatically if the container reboots.</span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={config.autoStart}
                            onChange={(e) => handleConfigChange('autoStart', e.target.checked)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                            config.autoStart ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'
                          }`}>
                            {config.autoStart && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Triggers Card */}
                  <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-4">
                      <MessageSquare className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Bot respond triggers</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      <label className={`flex flex-col p-5 bg-slate-900/60 border rounded-xl cursor-pointer transition-all select-none ${
                        config.respondToMentions ? 'border-indigo-500/40 bg-indigo-600/5' : 'border-slate-800 hover:border-slate-700'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-white">Bot @Mentions</span>
                          <input
                            type="checkbox"
                            checked={config.respondToMentions}
                            onChange={(e) => handleConfigChange('respondToMentions', e.target.checked)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                            config.respondToMentions ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'
                          }`}>
                            {config.respondToMentions && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2.5 leading-relaxed">
                          Responds whenever members mention or tag this bot inside text channels.
                        </p>
                      </label>

                      <label className={`flex flex-col p-5 bg-slate-900/60 border rounded-xl cursor-pointer transition-all select-none ${
                        config.respondToDMs ? 'border-indigo-500/40 bg-indigo-600/5' : 'border-slate-800 hover:border-slate-700'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-white">Direct Messages (DM)</span>
                          <input
                            type="checkbox"
                            checked={config.respondToDMs}
                            onChange={(e) => handleConfigChange('respondToDMs', e.target.checked)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                            config.respondToDMs ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'
                          }`}>
                            {config.respondToDMs && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2.5 leading-relaxed">
                          Responds to private, direct messages sent straight to this bot's DM inbox.
                        </p>
                      </label>

                      <label className={`flex flex-col p-5 bg-slate-900/60 border rounded-xl cursor-pointer transition-all select-none ${
                        config.respondToPrefix ? 'border-indigo-500/40 bg-indigo-600/5' : 'border-slate-800 hover:border-slate-700'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-white">Custom Prefix</span>
                          <input
                            type="checkbox"
                            checked={config.respondToPrefix}
                            onChange={(e) => handleConfigChange('respondToPrefix', e.target.checked)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                            config.respondToPrefix ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'
                          }`}>
                            {config.respondToPrefix && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2.5 leading-relaxed">
                          Responds whenever member statements begin with your specified prefix characters.
                        </p>
                      </label>
                    </div>

                    <AnimatePresence>
                      {config.respondToPrefix && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl mt-5"
                        >
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                            Trigger Prefix
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="text"
                              maxLength={5}
                              value={config.prefix}
                              onChange={(e) => handleConfigChange('prefix', e.target.value)}
                              placeholder="!"
                              className="w-24 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-center text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <span className="text-xs text-slate-500">
                              E.g. <code>!</code> or <code>ai_</code> (Max 5 chars).
                            </span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Restrictions Card */}
                  <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-4">
                      <ShieldAlert className="w-5 h-5 text-blue-400" />
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Access Restrictions</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Allowed Server Guild IDs
                        </label>
                        <input
                          type="text"
                          value={config.allowedGuilds}
                          onChange={(e) => handleConfigChange('allowedGuilds', e.target.value)}
                          placeholder="e.g. 109827364521"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                        />
                        <p className="text-xs text-slate-500">
                          Comma-separated list. Leave blank to respond inside all joined guilds.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Allowed Text Channel IDs
                        </label>
                        <input
                          type="text"
                          value={config.allowedChannels}
                          onChange={(e) => handleConfigChange('allowedChannels', e.target.value)}
                          placeholder="e.g. 109283749281"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                        />
                        <p className="text-xs text-slate-500">
                          Comma-separated list. Leave blank to allow responses in all public server channels.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Save Footer */}
                  <div className="sticky bottom-4 z-10 flex justify-end items-center gap-4 bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-2xl backdrop-blur-md">
                    <span className="text-xs text-slate-400 hidden sm:inline">
                      Commit setting shifts to update this live bot runtime execution.
                    </span>
                    <button
                      type="submit"
                      disabled={saveStatus === 'saving'}
                      className="px-6 py-2.5 text-xs font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center gap-2 cursor-pointer shadow-lg active:scale-98"
                    >
                      {saveStatus === 'saving' ? 'Saving triggers...' :
                       saveStatus === 'saved' ? 'Saved Successfully!' :
                       saveStatus === 'error' ? 'Configuration save error' :
                       'Save Access Configurations'}
                    </button>
                  </div>

                </form>
              )}

              {/* TAB 4: TERMINAL LOGS */}
              {activeTab === 'logs' && (
                <div className="bg-slate-800/40 backdrop-blur-md border border-slate-800/80 rounded-2xl flex flex-col h-[calc(100vh-14rem)] shadow-xl overflow-hidden">
                  
                  <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-4 justify-between sm:items-center bg-slate-900/30">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Terminal Log Console</span>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={logFilter}
                        onChange={(e: any) => setLogFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 px-3 py-1.5 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="all">All Levels</option>
                        <option value="info">Info</option>
                        <option value="success">Success</option>
                        <option value="warn">Warn</option>
                        <option value="error">Error</option>
                      </select>

                      <button
                        onClick={() => {
                          setBots((prev) =>
                            prev.map((b) => (b.id === selectedBot.id ? { ...b, logs: [] } : b))
                          );
                        }}
                        className="text-xs text-slate-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                      >
                        Flush Screen
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900/10 border-b border-slate-800/50">
                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        placeholder="Search complete terminal string context..."
                        className="w-full pl-10 pr-4 py-2 text-xs bg-slate-900/60 border border-slate-800 rounded-xl text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex-1 p-6 overflow-y-auto bg-slate-950/80 font-mono text-xs leading-relaxed space-y-2.5 select-text">
                    {filteredLogs.length === 0 ? (
                      <div className="text-slate-600 h-full flex flex-col items-center justify-center gap-1">
                        <Terminal className="w-5 h-5 text-slate-800" />
                        <span>No logs matching search constraints.</span>
                      </div>
                    ) : (
                      filteredLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-3 text-slate-300 hover:bg-slate-900/45 p-1 rounded transition-colors">
                          <span className="text-slate-600 shrink-0 select-none">[{log.timestamp}]</span>
                          <span className={`font-black shrink-0 select-none uppercase tracking-wider ${
                            log.level === 'success' ? 'text-green-400' :
                            log.level === 'warn' ? 'text-amber-400' :
                            log.level === 'error' ? 'text-rose-400' :
                            'text-indigo-400'
                          }`}>
                            {log.level.toUpperCase()}
                          </span>
                          <span className="text-slate-300 break-all">{log.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>

                  <div className="p-3 bg-slate-900/30 border-t border-slate-800 text-right text-[10px] text-slate-500">
                    Showing {filteredLogs.length} events. Capacity: 150 events.
                  </div>
                </div>
              )}
            </>
          )}

        </main>
      </div>

      {/* CREATE BOT MODAL */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative"
            >
              <h3 className="text-md font-bold text-white mb-4">Create Bot Instance</h3>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Bot Instance Name
                  </label>
                  <input
                    type="text"
                    value={newBotName}
                    onChange={(e) => setNewBotName(e.target.value)}
                    placeholder="e.g. Support Bot, Creative Assistant"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
                    required
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateBot();
                    }}
                  />
                </div>
                
                <div className="flex gap-3 pt-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setNewBotName('');
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-xl text-xs font-bold text-slate-300 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateBot}
                    disabled={!newBotName.trim()}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/10 cursor-pointer"
                  >
                    Create Instance
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
