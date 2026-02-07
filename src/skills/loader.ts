import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import type { Config } from '../config.js';

export type SkillMetadata = {
  openclaw?: {
    emoji?: string;
    primaryEnv?: string;
    requires?: {
      bins?: string[];
      env?: string[];
      config?: string[];
    };
  };
};

export type Skill = {
  name: string;
  description: string;
  content: string;
  path: string;
  userInvocable: boolean;
  metadata: SkillMetadata;
};

export type SkillEligibility = {
  eligible: boolean;
  reasons: string[];
};

function checkBinaryExists(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkEnvVar(env: string): boolean {
  return !!process.env[env];
}

export function checkSkillEligibility(skill: Skill, config: Config): SkillEligibility {
  const reasons: string[] = [];
  const requires = skill.metadata.openclaw?.requires;

  // check if explicitly disabled
  if (config.skills.disabled.includes(skill.name)) {
    return { eligible: false, reasons: ['Explicitly disabled in config'] };
  }

  // check enabled list (if specified, only those are allowed)
  if (config.skills.enabled.length > 0 && !config.skills.enabled.includes(skill.name)) {
    return { eligible: false, reasons: ['Not in enabled list'] };
  }

  if (!requires) {
    return { eligible: true, reasons: [] };
  }

  // check required binaries
  if (requires.bins) {
    for (const bin of requires.bins) {
      if (!checkBinaryExists(bin)) {
        reasons.push(`Missing binary: ${bin}`);
      }
    }
  }

  // check required env vars
  if (requires.env) {
    for (const env of requires.env) {
      if (!checkEnvVar(env)) {
        reasons.push(`Missing env var: ${env}`);
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export function loadSkill(skillPath: string): Skill | null {
  const skillMdPath = skillPath.endsWith('.md')
    ? skillPath
    : join(skillPath, 'SKILL.md');

  if (!existsSync(skillMdPath)) {
    return null;
  }

  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const { data, content: body } = matter(content);

    const name = data.name || basename(dirname(skillMdPath));
    const description = data.description || '';
    const userInvocable = data['user-invocable'] !== false;
    const metadata: SkillMetadata = data.metadata || {};

    return {
      name,
      description,
      content: body.trim(),
      path: skillMdPath,
      userInvocable,
      metadata,
    };
  } catch (err) {
    console.error(`Failed to load skill from ${skillMdPath}:`, err);
    return null;
  }
}

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      const skill = loadSkill(entryPath);
      if (skill) skills.push(skill);
    } else if (entry.endsWith('.md') && entry !== 'README.md') {
      const skill = loadSkill(entryPath);
      if (skill) skills.push(skill);
    }
  }

  return skills;
}

export function loadAllSkills(config: Config): Skill[] {
  const allSkills: Skill[] = [];
  const seen = new Set<string>();

  for (const dir of config.skills.dirs) {
    const skills = loadSkillsFromDir(dir);
    for (const skill of skills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        allSkills.push(skill);
      }
    }
  }

  return allSkills;
}

export function getEligibleSkills(config: Config): Skill[] {
  const allSkills = loadAllSkills(config);
  return allSkills.filter(skill => checkSkillEligibility(skill, config).eligible);
}

export function findSkillByName(name: string, config: Config): Skill | null {
  const skills = loadAllSkills(config);
  return skills.find(s => s.name === name) || null;
}

export function matchSkillToPrompt(prompt: string, skills: Skill[]): Skill | null {
  // simple keyword matching - could be enhanced with embeddings
  const promptLower = prompt.toLowerCase();

  // exact name match first
  for (const skill of skills) {
    if (promptLower.includes(skill.name.toLowerCase())) {
      return skill;
    }
  }

  // check for keywords in description
  for (const skill of skills) {
    const descWords = skill.description.toLowerCase().split(/\s+/);
    const matches = descWords.filter(w => w.length > 3 && promptLower.includes(w));
    if (matches.length >= 2) {
      return skill;
    }
  }

  return null;
}
