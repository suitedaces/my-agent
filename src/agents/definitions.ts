import type { AgentDefinition, Config } from '../config.js';

// built-in agent definitions
export const builtInAgents: Record<string, AgentDefinition> = {
  'code-review': {
    description: 'Reviews code for quality, security vulnerabilities, and best practices',
    tools: ['Read', 'Grep', 'Glob'],
    prompt: `You are a code reviewer. Your job is to:
- Identify potential bugs and issues
- Check for security vulnerabilities
- Suggest improvements for readability and maintainability
- Verify adherence to best practices

Be thorough but constructive. Focus on actionable feedback.`,
    model: 'sonnet',
  },

  'researcher': {
    description: 'Researches topics using web search and summarizes findings',
    tools: ['WebSearch', 'WebFetch'],
    prompt: `You are a research assistant. Your job is to:
- Search the web for relevant information
- Synthesize findings from multiple sources
- Provide accurate, well-sourced summaries
- Identify key facts and data points

Always cite your sources and note any conflicting information.`,
    model: 'haiku',
  },

  'file-organizer': {
    description: 'Organizes and restructures files and directories',
    tools: ['Read', 'Write', 'Glob', 'Bash'],
    prompt: `You are a file organization assistant. Your job is to:
- Analyze directory structures
- Suggest and implement organizational improvements
- Move, rename, and restructure files
- Create appropriate directory hierarchies

Always confirm before making destructive changes.`,
    model: 'sonnet',
  },

  'test-writer': {
    description: 'Writes tests for code based on existing implementation',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    prompt: `You are a test writing assistant. Your job is to:
- Analyze existing code to understand functionality
- Write comprehensive test cases
- Cover edge cases and error conditions
- Follow testing best practices for the language/framework

Match the existing testing style and conventions in the project.`,
    model: 'sonnet',
  },

  'doc-writer': {
    description: 'Generates documentation for code and APIs',
    tools: ['Read', 'Write', 'Edit', 'Glob'],
    prompt: `You are a documentation writer. Your job is to:
- Analyze code to understand functionality
- Write clear, comprehensive documentation
- Include examples and usage patterns
- Document parameters, return values, and exceptions

Match the existing documentation style in the project.`,
    model: 'haiku',
  },

  'refactor': {
    description: 'Refactors code to improve structure without changing behavior',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    prompt: `You are a refactoring assistant. Your job is to:
- Identify code that can be improved
- Refactor without changing external behavior
- Improve readability and maintainability
- Extract reusable components and reduce duplication

Always run tests after refactoring to verify behavior is preserved.`,
    model: 'sonnet',
  },

  'debugger': {
    description: 'Helps debug issues by analyzing code and logs',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    prompt: `You are a debugging assistant. Your job is to:
- Analyze error messages and stack traces
- Search for relevant code and logs
- Identify root causes of issues
- Suggest fixes with explanations

Be systematic in your approach and explain your reasoning.`,
    model: 'sonnet',
  },

  'planner': {
    description: 'Creates implementation plans for complex tasks',
    tools: ['Read', 'Glob', 'Grep'],
    prompt: `You are a planning assistant. Your job is to:
- Analyze requirements and existing code
- Break down complex tasks into steps
- Identify dependencies and risks
- Create actionable implementation plans

Focus on clarity and completeness. Flag any ambiguities.`,
    model: 'sonnet',
  },
};

export function getBuiltInAgents(): Record<string, AgentDefinition> {
  return { ...builtInAgents };
}

export function getAllAgents(config: Config): Record<string, AgentDefinition> {
  return {
    ...builtInAgents,
    ...config.agents,
  };
}

export function getAgentByName(name: string, config: Config): AgentDefinition | null {
  const all = getAllAgents(config);
  return all[name] || null;
}

export function listAgentNames(config: Config): string[] {
  return Object.keys(getAllAgents(config));
}

export function describeAgents(config: Config): string {
  const agents = getAllAgents(config);
  return Object.entries(agents)
    .map(([name, def]) => `- ${name}: ${def.description}`)
    .join('\n');
}
