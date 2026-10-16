import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { DataIssue, PortfolioModel } from '../lib/model';
import { loadPortfolio, type InputFile } from '../lib/loader';
import { applyCsvImport, importAssignmentsCsv } from '../lib/resources/csvAssignments';
import { suggestGroups } from '../lib/resources/matching';
import { reconcileSettings, type ResourceGroup, type Settings } from '../lib/settings';
import { analyzePortfolio, inputSignature, type OptimizationOutput, type PortfolioAnalysis } from '../lib/pipeline';
import { optimizeInWorker } from '../worker/client';
import { DEMO_ISSUE } from './demo';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  error?: boolean;
  model?: string;
}

export interface AppState {
  model: PortfolioModel | null;
  groups: ResourceGroup[];
  groupsConfirmed: boolean;
  settings: Settings | null;
  optimization: OptimizationOutput | null;
  optStatus: 'idle' | 'running' | 'error';
  optError: string | null;
  selectedScenarioId: string | null;
  chat: ChatMessage[];
  usingDemoData: boolean;
}

const initial: AppState = {
  model: null,
  groups: [],
  groupsConfirmed: false,
  settings: null,
  optimization: null,
  optStatus: 'idle',
  optError: null,
  selectedScenarioId: null,
  chat: [],
  usingDemoData: false,
};

type Action =
  | { type: 'load'; model: PortfolioModel; demo: boolean }
  | { type: 'model'; model: PortfolioModel }
  | { type: 'groups'; groups: ResourceGroup[]; confirmed?: boolean }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'settings'; settings: Settings }
  | { type: 'opt-start' }
  | { type: 'opt-done'; out: OptimizationOutput }
  | { type: 'opt-error'; error: string }
  | { type: 'select'; id: string | null }
  | { type: 'chat'; chat: ChatMessage[] }
  | { type: 'reset' };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'load':
      return {
        ...initial,
        model: a.model,
        groups: suggestGroups(a.model),
        settings: reconcileSettings(a.model, null),
        usingDemoData: a.demo,
      };
    case 'model':
      return { ...s, model: a.model, groups: suggestGroups(a.model), groupsConfirmed: false, settings: reconcileSettings(a.model, s.settings), optimization: null };
    case 'groups':
      return { ...s, groups: a.groups, groupsConfirmed: a.confirmed ?? s.groupsConfirmed };
    case 'confirm':
      return { ...s, groupsConfirmed: a.confirmed, groups: s.groups.map((g) => ({ ...g, confirmed: a.confirmed })) };
    case 'settings':
      return { ...s, settings: a.settings };
    case 'opt-start':
      return { ...s, optStatus: 'running', optError: null };
    case 'opt-done':
      return { ...s, optStatus: 'idle', optimization: a.out };
    case 'opt-error':
      return { ...s, optStatus: 'error', optError: a.error };
    case 'select':
      return { ...s, selectedScenarioId: a.id };
    case 'chat':
      return { ...s, chat: a.chat };
    case 'reset':
      return initial;
  }
}

const STORAGE_KEY = 'p6-resource-allocator:v1';

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initial;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return { ...initial, ...parsed, optStatus: 'idle', optError: null };
  } catch {
    return initial;
  }
}

function saveState(s: AppState) {
  try {
    const { optStatus: _a, optError: _b, ...rest } = s;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    try {
      // Quota exceeded: keep inputs, drop results (they can be recomputed).
      const { optStatus: _a, optError: _b, optimization: _c, ...rest } = s;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable — the app still works for this session */
    }
  }
}

interface Store {
  state: AppState;
  analysis: PortfolioAnalysis | null;
  analysisError: string | null;
  stale: boolean;
  currency: string;
  loadFiles: (files: InputFile[], csv?: { name: string; text: string } | null, demo?: boolean) => PortfolioModel;
  importCsv: (name: string, text: string) => DataIssue[];
  setGroups: (groups: ResourceGroup[], unconfirm?: boolean) => void;
  confirmGroups: (confirmed: boolean) => void;
  setSettings: (s: Settings) => void;
  runOptimization: () => Promise<void>;
  selectScenario: (id: string | null) => void;
  setChat: (chat: ChatMessage[]) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);


export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    const t = setTimeout(() => saveState(state), 300);
    return () => clearTimeout(t);
  }, [state]);

  const { analysis, analysisError } = useMemo(() => {
    if (!state.model || !state.settings) return { analysis: null, analysisError: null };
    try {
      return { analysis: analyzePortfolio(state.model, state.groups, state.settings), analysisError: null };
    } catch (e) {
      return { analysis: null, analysisError: e instanceof Error ? e.message : String(e) };
    }
  }, [state.model, state.groups, state.settings]);

  const stale = useMemo(() => {
    if (!state.optimization || !state.model || !state.settings) return false;
    return state.optimization.inputSignature !== inputSignature(state.model, state.groups, state.settings);
  }, [state.optimization, state.model, state.groups, state.settings]);

  const loadFiles = useCallback((files: InputFile[], csv?: { name: string; text: string } | null, demo = false) => {
    let model = loadPortfolio(files);
    if (csv) model = applyCsvImport(model, importAssignmentsCsv(csv.text, model, csv.name));
    if (demo) model = { ...model, issues: [DEMO_ISSUE, ...model.issues] };
    dispatch({ type: 'load', model, demo });
    return model;
  }, []);

  const importCsv = useCallback(
    (name: string, text: string) => {
      if (!state.model) return [];
      const res = importAssignmentsCsv(text, state.model, name);
      if (res.assignments.length > 0) {
        const m = applyCsvImport(state.model, res);
        dispatch({ type: 'model', model: { ...m, issues: m.issues.filter((i) => i.code !== 'demo_resources') } });
      }
      return res.issues;
    },
    [state.model],
  );

  const runOpt = useCallback(async () => {
    if (!state.model || !state.settings) return;
    dispatch({ type: 'opt-start' });
    try {
      const out = await optimizeInWorker(state.model, state.groups, state.settings);
      dispatch({ type: 'opt-done', out });
    } catch (e) {
      dispatch({ type: 'opt-error', error: e instanceof Error ? e.message : String(e) });
    }
  }, [state.model, state.groups, state.settings]);

  const currency = state.model?.files.find((f) => f.header.length)?.header.at(-1)?.trim() || '';

  const value: Store = {
    state,
    analysis,
    analysisError,
    stale,
    currency,
    loadFiles,
    importCsv,
    setGroups: (groups, unconfirm = false) => dispatch({ type: 'groups', groups, confirmed: unconfirm ? false : undefined }),
    confirmGroups: (confirmed) => dispatch({ type: 'confirm', confirmed }),
    setSettings: (settings) => dispatch({ type: 'settings', settings }),
    runOptimization: runOpt,
    selectScenario: (id) => dispatch({ type: 'select', id }),
    setChat: (chat) => dispatch({ type: 'chat', chat }),
    reset: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      dispatch({ type: 'reset' });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
