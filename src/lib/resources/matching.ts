import type { PortfolioModel, Project, Resource } from '../model';
import type { ResourceGroup } from '../settings';

/**
 * Resource-name matching across projects. Names are normalised (case, punctuation, plurals,
 * synonyms, project suffixes) and compared with a token + character similarity score.
 * The result is only a *suggestion*: the user confirms, edits, merges or splits groups.
 */

const STOPWORDS = new Set(['the', 'of', 'and', 'crew', 'team', 'gang', 'nos', 'no', 'machine', 'unit', 'units', 'for']);
const SYNONYMS: Record<string, string> = {
  driver: 'operator',
  operater: 'operator',
  labourer: 'helper',
  laborer: 'helper',
  labour: 'helper',
  labor: 'helper',
  mazdoor: 'helper',
  unskilled: 'helper',
  carpenter: 'carpenter',
  engr: 'engineer',
  eng: 'engineer',
  supervisor: 'supervisor',
  foreman: 'supervisor',
  electrician: 'electrician',
  sparky: 'electrician',
};

const stem = (t: string) => {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

/** Tokens that identify a project (used to strip suffixes like "- Project B" or "(AFS_scheduled)"). */
export function projectTokens(projects: Pick<Project, 'shortName' | 'fileName' | 'displayName'>[]): Set<string> {
  const out = new Set<string>();
  for (const p of projects) {
    for (const src of [p.shortName, p.fileName.replace(/\.xer$/i, '')]) {
      const lower = src.toLowerCase();
      out.add(lower.replace(/[^a-z0-9]+/g, ''));
      for (const t of lower.split(/[^a-z0-9]+/)) if (t.length >= 2) out.add(t);
    }
  }
  return out;
}

function isProjectRef(fragment: string, tokens: Set<string>): boolean {
  const f = fragment.toLowerCase().trim();
  if (!f) return false;
  if (/^(project|proj|prj|site|package|pkg|phase)\b/.test(f)) return true;
  const parts = f.split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(
    (p) => tokens.has(p) || (p.length >= 3 && [...tokens].some((t) => t.startsWith(p))) || /^[a-z]$|^\d+$/.test(p),
  ) && parts.some((p) => tokens.has(p) || [...tokens].some((t) => p.length >= 3 && t.startsWith(p)) || /^(project|proj)$/.test(p));
}

/** Normalise a resource name into comparable tokens. */
export function normalizeTokens(name: string, tokens: Set<string> = new Set()): string[] {
  let s = name.toLowerCase().replace(/&/g, ' and ');
  // Parenthesised / bracketed qualifiers naming a project are removed.
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (_m, inner: string) => (isProjectRef(inner, tokens) ? ' ' : ` ${inner} `));
  // Suffix after a dash/colon/underscore naming a project is removed: "Excavator Operator - Project B".
  const dash = /\s+[-–—:|]\s+|_(?=[a-z])/.exec(s);
  if (dash) {
    const head = s.slice(0, dash.index);
    const tail = s.slice(dash.index + dash[0].length);
    if (isProjectRef(tail, tokens)) s = head;
  }
  // Trailing "project b" / "proj 2" without a dash
  s = s.replace(/\b(project|proj|prj)\s+[a-z0-9]+\s*$/, ' ');
  const out: string[] = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const t = SYNONYMS[raw] ?? stem(SYNONYMS[stem(raw)] ?? raw);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function normalizeName(name: string, tokens?: Set<string>): string {
  return normalizeTokens(name, tokens).join(' ');
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similarity of two normalised token lists in [0, 1]. */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  if (inter === sa.size && inter === sb.size) return 1;
  const dice = (2 * inter) / (sa.size + sb.size);
  // One name fully contained in the other ("Fabricator" ⊂ "Welder Fabricator")
  const contained = inter > 0 && (inter === sa.size || inter === sb.size) ? 0.85 : 0;
  const jw = jaroWinkler(a.join(' '), b.join(' '));
  return Math.max(dice, contained, jw >= 0.9 ? jw * 0.95 : 0);
}

export const MATCH_THRESHOLD = 0.8;

export function similarity(nameA: string, nameB: string, tokens?: Set<string>): number {
  return tokenSimilarity(normalizeTokens(nameA, tokens), normalizeTokens(nameB, tokens));
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Suggest resource groups. Only resources of the same type can match.
 * Capacity = sum of member capacities; a resource that appears in several files with identical
 * XER id and name is treated as one enterprise resource and counted once.
 */
export function suggestGroups(model: PortfolioModel, threshold = MATCH_THRESHOLD): ResourceGroup[] {
  const tokens = projectTokens(model.projects);
  const res = model.resources.filter((r) => model.assignments.some((a) => a.resourceKey === r.key));
  const norm = res.map((r) => normalizeTokens(r.name, tokens));
  const parent = res.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < res.length; i++) {
    for (let j = i + 1; j < res.length; j++) {
      if (res[i].type !== res[j].type) continue;
      if (tokenSimilarity(norm[i], norm[j]) >= threshold) parent[find(j)] = find(i);
    }
  }
  const clusters = new Map<number, number[]>();
  res.forEach((_, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });
  const groups: ResourceGroup[] = [];
  let n = 0;
  for (const idxs of clusters.values()) {
    const members = idxs.map((i) => res[i]);
    const nameIdx = idxs.reduce((best, i) => (norm[i].length < norm[best].length || (norm[i].length === norm[best].length && res[i].name.length < res[best].name.length) ? i : best), idxs[0]);
    groups.push(groupFromMembers(`g${++n}`, titleCase(norm[nameIdx].join(' ')) || res[nameIdx].name, members));
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

/** Derive capacity and cost for a set of members (used on creation and after merge/split). */
export function groupFromMembers(id: string, name: string, members: Resource[], prev?: Partial<ResourceGroup>): ResourceGroup {
  const distinct = new Map<string, Resource>();
  for (const m of members) {
    const k = m.source === 'xer' ? `xer:${m.rsrcId}:${m.name.toLowerCase()}` : m.key;
    if (!distinct.has(k)) distinct.set(k, m);
  }
  const caps = [...distinct.values()].map((m) => m.maxUnits);
  const known = caps.filter((c): c is number => c !== null);
  const allKnown = known.length === caps.length && caps.length > 0;
  const costs = members.map((m) => m.costPerHour).filter((c): c is number => c !== null);
  const avgCostHour = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : null;
  const src = members.some((m) => m.source === 'xer') ? 'xer' : 'csv';
  const derivedCap = allKnown ? known.reduce((s, c) => s + c, 0) : null;
  const userCap = prev?.capacitySource === 'user' ? prev.capacity ?? null : null;
  const userCost = prev?.costSource === 'user' ? prev.costPerUnitDay ?? null : null;
  return {
    id,
    name,
    type: members[0]?.type ?? 'labor',
    memberKeys: members.map((m) => m.key),
    capacity: userCap ?? derivedCap,
    capacitySource: userCap !== null ? 'user' : derivedCap !== null ? src : null,
    capacityHint: known.length ? known.reduce((s, c) => s + c, 0) : null,
    costPerUnitDay: userCost ?? (avgCostHour !== null ? round2(avgCostHour * 8) : null),
    costSource: userCost !== null ? 'user' : avgCostHour !== null ? src : null,
    mobilizationDays: prev?.mobilizationDays ?? 0,
    transferCostPerUnit: prev?.transferCostPerUnit ?? 0,
    hireCostPerUnitDay: prev?.hireCostPerUnitDay ?? null,
    maxHire: prev?.maxHire ?? 10,
    confirmed: false,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Group editing operations (pure)
// ---------------------------------------------------------------------------

const membersOf = (model: PortfolioModel, keys: string[]) =>
  keys.map((k) => model.resources.find((r) => r.key === k)).filter((r): r is Resource => !!r);

export function mergeGroups(model: PortfolioModel, groups: ResourceGroup[], ids: string[]): ResourceGroup[] {
  const sel = groups.filter((g) => ids.includes(g.id));
  if (sel.length < 2) return groups;
  const types = new Set(sel.map((g) => g.type));
  if (types.size > 1) throw new Error('Only resources of the same type can be merged.');
  const keys = sel.flatMap((g) => g.memberKeys);
  const merged = groupFromMembers(sel[0].id, sel[0].name, membersOf(model, keys), {
    ...sel[0],
    capacitySource: null, // re-derive: the user should re-check capacity after a merge
  });
  return [...groups.filter((g) => !ids.includes(g.id)), merged].sort((a, b) => a.name.localeCompare(b.name));
}

export function splitMember(model: PortfolioModel, groups: ResourceGroup[], groupId: string, memberKey: string): ResourceGroup[] {
  const g = groups.find((x) => x.id === groupId);
  if (!g || g.memberKeys.length < 2 || !g.memberKeys.includes(memberKey)) return groups;
  const rest = groupFromMembers(g.id, g.name, membersOf(model, g.memberKeys.filter((k) => k !== memberKey)), { ...g, capacitySource: null });
  const res = membersOf(model, [memberKey]);
  const newId = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const single = groupFromMembers(newId, res[0]?.name ?? 'Resource', res, { mobilizationDays: g.mobilizationDays, transferCostPerUnit: g.transferCostPerUnit });
  return [...groups.filter((x) => x.id !== groupId), rest, single].sort((a, b) => a.name.localeCompare(b.name));
}

export function updateGroup(groups: ResourceGroup[], id: string, patch: Partial<ResourceGroup>): ResourceGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, ...patch } : g));
}

/** Which group each resource belongs to. */
export function groupIndex(groups: ResourceGroup[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups) for (const k of g.memberKeys) m.set(k, g.id);
  return m;
}
