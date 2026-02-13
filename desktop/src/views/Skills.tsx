import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, Sparkles, Save, ArrowLeft,
  Search, Terminal, KeyRound, CheckCircle2, XCircle,
  Package, User, Slash, Eye, CircleDot, Download,
  ExternalLink, Loader2, Globe, TrendingUp
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

type SkillInfo = {
  name: string;
  description: string;
  path: string;
  userInvocable: boolean;
  metadata: { requires?: { bins?: string[]; env?: string[] } };
  eligibility: { eligible: boolean; reasons: string[] };
  builtIn: boolean;
};

type SkillForm = {
  name: string;
  description: string;
  userInvocable: boolean;
  bins: string;
  env: string;
  content: string;
};

type GallerySkill = {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
};

type FeaturedCategory = {
  category: string;
  skills: GallerySkill[];
};

const emptyForm: SkillForm = {
  name: '',
  description: '',
  userInvocable: true,
  bins: '',
  env: '',
  content: '',
};

type Filter = 'all' | 'built-in' | 'custom';
type TopTab = 'my-skills' | 'gallery';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

// ── Main View ───────────────────────────────────────────────────────

export function SkillsView({ gateway }: Props) {
  const [topTab, setTopTab] = useState<TopTab>('my-skills');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'detail'>('list');
  const [form, setForm] = useState<SkillForm>(emptyForm);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [detailContent, setDetailContent] = useState<string>('');

  const loadSkills = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('skills.list');
      if (Array.isArray(result)) setSkills(result);
      setLoading(false);
    } catch (err) {
      console.error('failed to load skills:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const filtered = useMemo(() => {
    let list = skills;
    if (filter === 'built-in') list = list.filter(s => s.builtIn);
    if (filter === 'custom') list = list.filter(s => !s.builtIn);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, filter, search]);

  const counts = useMemo(() => ({
    all: skills.length,
    'built-in': skills.filter(s => s.builtIn).length,
    custom: skills.filter(s => !s.builtIn).length,
  }), [skills]);

  // installed skill names for gallery install state
  const installedNames = useMemo(() => new Set(skills.map(s => s.name)), [skills]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingName(null);
    setMode('create');
  };

  const openDetail = async (skill: SkillInfo) => {
    setSelectedSkill(skill);
    try {
      const result = await gateway.rpc('skills.read', { name: skill.name }) as { raw: string };
      const raw = result.raw;
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      setDetailContent(fmMatch ? fmMatch[2].trim() : raw);
    } catch {
      setDetailContent('');
    }
    setMode('detail');
  };

  const openEdit = (skill: SkillInfo) => {
    setForm({
      name: skill.name,
      description: skill.description,
      userInvocable: skill.userInvocable,
      bins: skill.metadata.requires?.bins?.join(', ') || '',
      env: skill.metadata.requires?.env?.join(', ') || '',
      content: detailContent,
    });
    setEditingName(skill.name);
    setMode('edit');
  };

  const openEditFromList = async (skill: SkillInfo) => {
    try {
      const result = await gateway.rpc('skills.read', { name: skill.name }) as { raw: string };
      const raw = result.raw;
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const body = fmMatch ? fmMatch[2].trim() : raw;
      setForm({
        name: skill.name,
        description: skill.description,
        userInvocable: skill.userInvocable,
        bins: skill.metadata.requires?.bins?.join(', ') || '',
        env: skill.metadata.requires?.env?.join(', ') || '',
        content: body,
      });
      setEditingName(skill.name);
      setSelectedSkill(skill);
      setMode('edit');
    } catch (err) {
      console.error('failed to read skill:', err);
    }
  };

  const saveSkill = async () => {
    setSaving(true);
    const bins = form.bins.split(',').map(s => s.trim()).filter(Boolean);
    const env = form.env.split(',').map(s => s.trim()).filter(Boolean);
    const metadata: Record<string, unknown> = {};
    if (bins.length || env.length) {
      metadata.requires = {} as Record<string, string[]>;
      if (bins.length) (metadata.requires as any).bins = bins;
      if (env.length) (metadata.requires as any).env = env;
    }

    try {
      await gateway.rpc('skills.create', {
        name: form.name,
        description: form.description,
        userInvocable: form.userInvocable,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        content: form.content,
      });
      setMode('list');
      setForm(emptyForm);
      setEditingName(null);
      setSelectedSkill(null);
      setTimeout(loadSkills, 100);
    } catch (err) {
      console.error('failed to save skill:', err);
    } finally {
      setSaving(false);
    }
  };

  const deleteSkill = async (name: string) => {
    try {
      await gateway.rpc('skills.delete', { name });
      if (selectedSkill?.name === name) {
        setSelectedSkill(null);
        setMode('list');
      }
      setTimeout(loadSkills, 100);
    } catch (err) {
      console.error('failed to delete skill:', err);
    }
  };

  const canSave = form.name && form.description && form.content;

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Sparkles className="w-6 h-6 opacity-40" />
        <span className="text-sm">connecting...</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32 ml-auto" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // detail view (local skills only)
  if (mode === 'detail' && selectedSkill) {
    const skill = selectedSkill;
    const hasReqs = skill.metadata.requires?.bins?.length || skill.metadata.requires?.env?.length;

    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setMode('list'); setSelectedSkill(null); }}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />skills
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            {!skill.builtIn && (
              <>
                <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={() => openEdit(skill)}>
                  <Pencil className="w-3 h-3 mr-1.5" />edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-sm">delete "{skill.name}"?</AlertDialogTitle>
                      <AlertDialogDescription className="text-xs">removes from ~/.dorabot/skills/. cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                      <AlertDialogAction className="h-7 text-xs" onClick={() => deleteSkill(skill.name)}>delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            {skill.builtIn && (
              <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={() => openEdit(skill)}>
                <Eye className="w-3 h-3 mr-1.5" />view source
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 max-w-2xl space-y-5">
            {/* header */}
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  skill.eligibility.eligible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  <Sparkles className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold leading-tight">{skill.name}</h2>
                  {skill.userInvocable && (
                    <span className="text-[11px] text-muted-foreground font-mono">/{skill.name}</span>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-2">{skill.description}</p>
            </div>

            {/* meta grid */}
            <div className="grid grid-cols-2 gap-3">
              <MetaItem
                icon={skill.eligibility.eligible ? CheckCircle2 : XCircle}
                label="status"
                value={skill.eligibility.eligible ? 'ready' : 'unavailable'}
                className={skill.eligibility.eligible ? 'text-success' : 'text-destructive'}
              />
              <MetaItem
                icon={skill.builtIn ? Package : User}
                label="source"
                value={skill.builtIn ? 'built-in' : 'custom'}
              />
              <MetaItem
                icon={Slash}
                label="invocable"
                value={skill.userInvocable ? 'yes' : 'no'}
              />
              <MetaItem
                icon={CircleDot}
                label="path"
                value={skill.path.replace(/.*\/skills\//, 'skills/')}
                mono
              />
            </div>

            {/* eligibility issues */}
            {!skill.eligibility.eligible && skill.eligibility.reasons.length > 0 && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1">
                <span className="text-[11px] font-medium text-destructive">missing requirements</span>
                {skill.eligibility.reasons.map((r, i) => (
                  <div key={i} className="text-[11px] text-destructive/80">{r}</div>
                ))}
              </div>
            )}

            {/* requirements */}
            {hasReqs && (
              <div className="space-y-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">requirements</span>
                <div className="flex flex-wrap gap-1.5">
                  {skill.metadata.requires?.bins?.map(b => (
                    <span key={b} className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary rounded-md px-2 py-1 border border-border">
                      <Terminal className="w-3 h-3 text-muted-foreground" />{b}
                    </span>
                  ))}
                  {skill.metadata.requires?.env?.map(e => (
                    <span key={e} className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary rounded-md px-2 py-1 border border-border">
                      <KeyRound className="w-3 h-3 text-muted-foreground" />{e}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* content preview */}
            {detailContent && (
              <div className="space-y-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">skill content</span>
                <pre className="text-[11px] font-mono leading-relaxed bg-secondary/50 rounded-lg p-3 border border-border overflow-x-auto whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
                  {detailContent}
                </pre>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // create / edit form
  if (mode === 'create' || mode === 'edit') {
    const isBuiltIn = mode === 'edit' && selectedSkill?.builtIn;

    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => {
            setMode(selectedSkill ? 'detail' : 'list');
            setForm(emptyForm);
          }}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />back
          </Button>
          <span className="font-semibold text-sm">{mode === 'create' ? 'new skill' : isBuiltIn ? `viewing: ${editingName}` : `editing: ${editingName}`}</span>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5 max-w-2xl">

            {/* identity section */}
            <div className="space-y-3">
              <SectionHeader>identity</SectionHeader>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">name</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-') })}
                    placeholder="my-skill"
                    className="h-8 text-xs font-mono"
                    disabled={mode === 'edit'}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">description</Label>
                  <Input
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="what this skill teaches the agent to do"
                    className="h-8 text-xs"
                    disabled={isBuiltIn}
                  />
                </div>
              </div>
            </div>

            {/* settings section */}
            <div className="space-y-3">
              <SectionHeader>settings</SectionHeader>
              <div className="flex items-center justify-between bg-secondary/30 rounded-lg px-3 py-2.5 border border-border">
                <div>
                  <div className="text-xs font-medium">user-invocable</div>
                  <div className="text-[10px] text-muted-foreground">users can trigger with /{form.name || 'name'}</div>
                </div>
                <Switch
                  checked={form.userInvocable}
                  onCheckedChange={v => setForm({ ...form, userInvocable: v })}
                  size="sm"
                  disabled={isBuiltIn}
                />
              </div>
            </div>

            {/* requirements section */}
            <div className="space-y-3">
              <SectionHeader>requirements</SectionHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Terminal className="w-3 h-3" />binaries
                  </Label>
                  <Input
                    value={form.bins}
                    onChange={e => setForm({ ...form, bins: e.target.value })}
                    placeholder="gh, curl, ffmpeg"
                    className="h-8 text-xs font-mono"
                    disabled={isBuiltIn}
                  />
                  <span className="text-[10px] text-muted-foreground">comma-separated, checked via `which`</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />env vars
                  </Label>
                  <Input
                    value={form.env}
                    onChange={e => setForm({ ...form, env: e.target.value })}
                    placeholder="GITHUB_TOKEN, API_KEY"
                    className="h-8 text-xs font-mono"
                    disabled={isBuiltIn}
                  />
                  <span className="text-[10px] text-muted-foreground">comma-separated</span>
                </div>
              </div>
            </div>

            {/* content section */}
            <div className="space-y-3">
              <SectionHeader>content</SectionHeader>
              <Textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                placeholder={"# My Skill\n\nInstructions for the agent when this skill is matched...\n\n## Examples\n\n- do this\n- then that"}
                rows={24}
                className="text-xs font-mono leading-relaxed resize-none"
                disabled={isBuiltIn}
              />
            </div>

            {!isBuiltIn && (
              <Button
                size="sm"
                className="w-full h-8 text-xs"
                onClick={saveSkill}
                disabled={!canSave || saving}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saving ? 'saving...' : mode === 'create' ? 'create skill' : 'save changes'}
              </Button>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── Main list view with top tabs ────────────────────────────────

  const builtInSkills = filtered.filter(s => s.builtIn);
  const customSkills = filtered.filter(s => !s.builtIn);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header with top tabs */}
      <div className="px-4 py-3 border-b border-border shrink-0 space-y-2.5">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-sm">Skills</h1>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{skills.length}</Badge>

          {/* top tab switcher */}
          <div className="flex items-center bg-secondary/50 rounded-md p-0.5 ml-2">
            {([
              { id: 'my-skills' as TopTab, label: 'My Skills', icon: Sparkles },
              { id: 'gallery' as TopTab, label: 'Browse', icon: Globe },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setTopTab(tab.id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] transition-colors',
                  topTab === tab.id
                    ? 'bg-background text-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <tab.icon className="w-3 h-3" />
                {tab.label}
              </button>
            ))}
          </div>

          {topTab === 'my-skills' && (
            <Button
              variant="default"
              size="sm"
              className="ml-auto h-7 text-xs px-3"
              onClick={openCreate}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />new skill
            </Button>
          )}
        </div>

        {topTab === 'my-skills' && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="search skills..."
                className="h-7 text-xs pl-7 pr-2"
              />
            </div>
            <div className="flex items-center bg-secondary/50 rounded-md p-0.5">
              {(['all', 'built-in', 'custom'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2 py-1 rounded text-[11px] transition-colors',
                    filter === f
                      ? 'bg-background text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f} <span className="text-[10px] opacity-60">{counts[f]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tab content */}
      {topTab === 'my-skills' ? (
        <ScrollArea className="flex-1 min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                <Sparkles className="w-5 h-5 opacity-50" />
              </div>
              {search ? (
                <>
                  <span className="text-sm">no skills match "{search}"</span>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSearch('')}>clear search</Button>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">no skills yet</span>
                  <span className="text-xs text-center max-w-xs">skills teach your agent new capabilities. create one or browse the gallery.</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="text-xs" onClick={openCreate}>
                      <Plus className="w-3 h-3 mr-1" />create skill
                    </Button>
                    <Button variant="default" size="sm" className="text-xs" onClick={() => setTopTab('gallery')}>
                      <Globe className="w-3 h-3 mr-1" />browse gallery
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {filter !== 'built-in' && customSkills.length > 0 && (
                <SkillSection
                  label="custom"
                  count={customSkills.length}
                  skills={customSkills}
                  onClickSkill={openDetail}
                  onEditSkill={openEditFromList}
                  onDeleteSkill={deleteSkill}
                />
              )}

              {filter !== 'custom' && builtInSkills.length > 0 && (
                <SkillSection
                  label="built-in"
                  count={builtInSkills.length}
                  skills={builtInSkills}
                  onClickSkill={openDetail}
                  onEditSkill={openEditFromList}
                  onDeleteSkill={deleteSkill}
                />
              )}
            </div>
          )}
        </ScrollArea>
      ) : (
        <GalleryView
          gateway={gateway}
          installedNames={installedNames}
          onInstalled={() => setTimeout(loadSkills, 200)}
        />
      )}
    </div>
  );
}

// ── Gallery View ────────────────────────────────────────────────────

function GalleryView({ gateway, installedNames, onInstalled }: {
  gateway: ReturnType<typeof useGateway>;
  installedNames: Set<string>;
  onInstalled: () => void;
}) {
  const [gallerySearch, setGallerySearch] = useState('');
  const [searchResults, setSearchResults] = useState<GallerySkill[]>([]);
  const [featured, setFeatured] = useState<FeaturedCategory[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installError, setInstallError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load featured on mount
  useEffect(() => {
    const loadFeatured = async () => {
      try {
        const result = await gateway.rpc('skills.gallery.featured') as FeaturedCategory[];
        if (Array.isArray(result)) setFeatured(result);
      } catch (err) {
        console.error('failed to load featured skills:', err);
      } finally {
        setLoadingFeatured(false);
      }
    };
    loadFeatured();
  }, [gateway.rpc]);

  // Debounced search
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const result = await gateway.rpc('skills.gallery.search', { query, limit: 30 }) as { skills: GallerySkill[]; count: number };
      setSearchResults(result.skills || []);
    } catch (err) {
      console.error('gallery search failed:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [gateway.rpc]);

  const onSearchChange = (value: string) => {
    setGallerySearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => doSearch(value), 400);
  };

  const installSkill = async (skill: GallerySkill) => {
    setInstalling(prev => new Set(prev).add(skill.skillId));
    setInstallError(null);
    try {
      await gateway.rpc('skills.gallery.install', { source: skill.source, skillId: skill.skillId });
      onInstalled();
    } catch (err: any) {
      setInstallError(err?.message || 'Install failed');
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(skill.skillId);
        return next;
      });
    }
  };

  const uninstallSkill = async (skill: GallerySkill) => {
    try {
      await gateway.rpc('skills.gallery.uninstall', { skillId: skill.skillId });
      onInstalled();
    } catch (err) {
      console.error('uninstall failed:', err);
    }
  };

  const isSearchMode = gallerySearch.trim().length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* search bar */}
      <div className="px-4 py-2.5 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={gallerySearch}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="search 56,000+ community skills..."
            className="h-8 text-xs pl-8 pr-2"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
          )}
        </div>
      </div>

      {/* error banner */}
      {installError && (
        <div className="mx-4 mt-2 bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 text-[11px] text-destructive flex items-center justify-between">
          <span>{installError}</span>
          <button onClick={() => setInstallError(null)} className="text-destructive/60 hover:text-destructive ml-2">
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        {isSearchMode ? (
          /* search results */
          <div className="p-4 space-y-3">
            {searching && searchResults.length === 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Search className="w-5 h-5 opacity-40" />
                <span className="text-xs">no skills found for "{gallerySearch}"</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">results</span>
                  <span className="text-[10px] text-muted-foreground">{searchResults.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {searchResults.map(skill => (
                    <GalleryCard
                      key={skill.id}
                      skill={skill}
                      installed={installedNames.has(skill.skillId)}
                      installing={installing.has(skill.skillId)}
                      onInstall={() => installSkill(skill)}
                      onUninstall={() => uninstallSkill(skill)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          /* featured categories */
          <div className="p-4 space-y-5">
            {loadingFeatured ? (
              <div className="space-y-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <div className="grid grid-cols-2 gap-2">
                      {[1, 2, 3, 4].map(j => (
                        <Skeleton key={j} className="h-24 w-full rounded-lg" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : featured.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Globe className="w-5 h-5 opacity-40" />
                <span className="text-xs">couldn't load gallery. check your connection.</span>
              </div>
            ) : (
              featured.map(cat => (
                cat.skills.length > 0 && (
                  <div key={cat.category} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{cat.category}</span>
                      <span className="text-[10px] text-muted-foreground">{cat.skills.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {cat.skills.map(skill => (
                        <GalleryCard
                          key={skill.id}
                          skill={skill}
                          installed={installedNames.has(skill.skillId)}
                          installing={installing.has(skill.skillId)}
                          onInstall={() => installSkill(skill)}
                          onUninstall={() => uninstallSkill(skill)}
                        />
                      ))}
                    </div>
                  </div>
                )
              ))
            )}

            {/* footer */}
            {!loadingFeatured && featured.length > 0 && (
              <div className="text-center py-4">
                <span className="text-[10px] text-muted-foreground">
                  powered by{' '}
                  <a
                    href="https://skills.sh"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary/70 hover:text-primary transition-colors"
                  >
                    skills.sh
                  </a>
                  {' '}/ 56,000+ skills
                </span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ── Gallery Skill Card ──────────────────────────────────────────────

function GalleryCard({ skill, installed, installing, onInstall, onUninstall }: {
  skill: GallerySkill;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const formatInstalls = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  return (
    <div className="group text-left w-full rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/30 hover:shadow-sm space-y-2">
      {/* top: name + installs */}
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold truncate">{skill.name}</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono truncate block">{skill.source}</span>
        </div>
      </div>

      {/* bottom: installs + actions */}
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Download className="w-3 h-3" />
          {formatInstalls(skill.installs)}
        </span>
        <a
          href={`https://skills.sh/${skill.source}/${skill.skillId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={e => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
        <span className="flex-1" />
        {installed ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-success font-medium flex items-center gap-0.5">
              <CheckCircle2 className="w-3 h-3" />installed
            </span>
            <button
              onClick={onUninstall}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              title="uninstall"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                installing...
              </>
            ) : (
              <>
                <Download className="w-3 h-3 mr-1" />
                install
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Shared Components (unchanged) ───────────────────────────────────

function SkillSection({ label, count, skills, onClickSkill, onEditSkill, onDeleteSkill }: {
  label: string;
  count: number;
  skills: SkillInfo[];
  onClickSkill: (s: SkillInfo) => void;
  onEditSkill: (s: SkillInfo) => void;
  onDeleteSkill: (name: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {skills.map(skill => (
          <SkillCard
            key={skill.name}
            skill={skill}
            onClick={() => onClickSkill(skill)}
            onEdit={() => onEditSkill(skill)}
            onDelete={() => onDeleteSkill(skill.name)}
          />
        ))}
      </div>
    </div>
  );
}

function SkillCard({ skill, onClick, onEdit, onDelete }: {
  skill: SkillInfo;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasReqs = skill.metadata.requires?.bins?.length || skill.metadata.requires?.env?.length;

  return (
    <button
      onClick={onClick}
      className="group text-left w-full rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/30 hover:shadow-sm space-y-2"
    >
      {/* top row: name + status */}
      <div className="flex items-start gap-2">
        <div className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors',
          skill.eligibility.eligible
            ? 'bg-primary/10 text-primary group-hover:bg-primary/15'
            : 'bg-muted text-muted-foreground'
        )}>
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold truncate">{skill.name}</span>
            <div className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              skill.eligibility.eligible ? 'bg-success' : 'bg-destructive/60'
            )} />
          </div>
          {skill.userInvocable && (
            <span className="text-[10px] text-muted-foreground font-mono">/{skill.name}</span>
          )}
        </div>
      </div>

      {/* description */}
      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{skill.description}</p>

      {/* bottom row: badges + actions */}
      <div className="flex items-center gap-1 flex-wrap">
        {hasReqs && (
          <>
            {skill.metadata.requires?.bins?.map(b => (
              <span key={b} className="text-[9px] font-mono bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">{b}</span>
            ))}
            {skill.metadata.requires?.env?.map(e => (
              <span key={e} className="text-[9px] font-mono bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">{e}</span>
            ))}
          </>
        )}
        <span className="flex-1" />
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title={skill.builtIn ? 'view' : 'edit'}
          >
            <Pencil className="w-3 h-3" />
          </button>
          {!skill.builtIn && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm">delete "{skill.name}"?</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs">removes from ~/.dorabot/skills/. cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                  <AlertDialogAction className="h-7 text-xs" onClick={onDelete}>delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </button>
  );
}

function MetaItem({ icon: Icon, label, value, className, mono }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 bg-secondary/30 rounded-lg px-3 py-2 border border-border">
      <Icon className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground', className)} />
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className={cn('text-xs truncate', mono && 'font-mono text-[11px]', className)}>{value}</div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
