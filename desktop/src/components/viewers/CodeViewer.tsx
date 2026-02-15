import { useState, useEffect } from 'react';
import { ShikiHighlighter, createHighlighterCore, createJavaScriptRegexEngine } from 'react-shiki/core';
import type { HighlighterCore } from 'shiki/core';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/vitesse-dark'),
      ],
      langs: [
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/tsx'),
        import('@shikijs/langs/jsx'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/rust'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/java'),
        import('@shikijs/langs/c'),
        import('@shikijs/langs/cpp'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/xml'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/toml'),
        import('@shikijs/langs/bash'),
        import('@shikijs/langs/ruby'),
        import('@shikijs/langs/php'),
        import('@shikijs/langs/swift'),
        import('@shikijs/langs/kotlin'),
        import('@shikijs/langs/scala'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/r'),
        import('@shikijs/langs/lua'),
        import('@shikijs/langs/vim'),
        import('@shikijs/langs/markdown'),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

type Props = {
  content: string;
  filePath: string;
};

const extToLang: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', html: 'html', json: 'json', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  scala: 'scala', sql: 'sql', r: 'r', lua: 'lua', vim: 'vim',
  md: 'markdown', mdx: 'markdown',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return extToLang[ext || ''] || 'text';
}

export function CodeViewer({ content, filePath }: Props) {
  const language = getLanguage(filePath);
  const [hl, setHl] = useState<HighlighterCore | null>(null);

  useEffect(() => {
    getHighlighter().then(setHl);
  }, []);

  if (!hl) {
    return (
      <pre className="p-4 text-[13px] leading-[1.5] h-full overflow-auto text-foreground">
        <code>{content}</code>
      </pre>
    );
  }

  return (
    <div className="code-viewer">
      <ShikiHighlighter
        language={language}
        theme="vitesse-dark"
        highlighter={hl}
        showLineNumbers
        showLanguage={false}
        addDefaultStyles={false}
        style={{
          margin: 0,
          padding: '1rem',
          fontSize: '13px',
          lineHeight: '1.5',
          height: '100%',
          overflow: 'auto',
        }}
      >
        {content}
      </ShikiHighlighter>
    </div>
  );
}
